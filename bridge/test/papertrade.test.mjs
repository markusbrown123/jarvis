// node --test bridge/test/ — paper trading: costs, entries, exits, the control, learning.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-paper-'))
const pt = await import('../hub/papertrade.mjs')

const HOUR = 3600_000
const token = (o = {}) => ({
  address: 'TOKEN1', symbol: 'TKN', url: '', priceUsd: 1, liq: 80000, volH1: 20000,
  m5: 1, h1: 12, h24: 30, buysH1: 300, sellsH1: 200, ageH: 30, mcap: 500000, ...o,
})

/** Market data under the test's control. */
function market({ trending = [], rows = [], perps = [], candles = {} } = {}) {
  const m = { trending, rows, perps, candles }
  pt.feeds.trending = async () => m.trending
  pt.feeds.tokens = async (addrs) => m.rows.filter((r) => addrs.includes(r.address))
  pt.feeds.perpMarket = async () => m.perps
  pt.feeds.candles = async (coin) => m.candles[coin] ?? { closes: [], highs: [], lows: [] }
  return m
}

const fresh = (rand = () => 0.99) => {
  pt._reset({ rand })
  const s = pt.state()
  s.paused = false
  s.lastSignalAt = 0
  for (const st of Object.values(s.strategies)) {
    Object.assign(st, { cash: pt.START_USD, positions: [], closed: [], cooldown: {}, peak: pt.START_USD, maxDd: 0 })
  }
  return s
}

test('normalizes DexScreener pairs to the most liquid pair per token', () => {
  const rows = pt.normalizePairs([
    { baseToken: { address: 'A', symbol: 'AAA' }, priceUsd: '0.5', liquidity: { usd: 1000 }, txns: { h1: { buys: 5, sells: 1 } }, priceChange: { h1: 3 } },
    { baseToken: { address: 'A', symbol: 'AAA' }, priceUsd: '0.51', liquidity: { usd: 90000 }, volume: { h1: 4000 }, pairCreatedAt: Date.now() - 10 * HOUR },
    { baseToken: { address: 'B' }, priceUsd: null },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].priceUsd, 0.51)
  assert.equal(rows[0].liq, 90000)
  assert.ok(Math.abs(rows[0].ageH - 10) < 0.01)
})

test('the steady filter takes a healthy climber and rejects a dump', () => {
  const q = pt.state().strategies['meme-steady'].params
  assert.equal(pt.passes(token(), q), true)
  // The real example from DexScreener: 27k sells to 915 buys.
  assert.equal(pt.passes(token({ buysH1: 21, sellsH1: 1177, h1: -0.8 }), q), false)
  assert.equal(pt.passes(token({ liq: 9000 }), q), false)
})

test('a memecoin round trip at a flat price loses its costs', async () => {
  const s = fresh()
  const m = market({ trending: ['TOKEN1'], rows: [token()] })
  await pt.tick()
  const st = s.strategies['meme-steady']
  assert.equal(st.positions.length, 1, 'opened')
  assert.equal(st.cash, pt.START_USD - 10)
  // Flat price, time runs out.
  st.positions[0].openedAt -= 7 * HOUR
  m.trending = []
  await pt.tick()
  assert.equal(st.positions.length, 0)
  const t = st.closed[0]
  assert.match(t.reason, /time limit/)
  // ~2% fees + ~2% slippage + $0.30 network on $10.
  assert.ok(t.pnlUsd < -0.6 && t.pnlUsd > -0.8, `round trip cost ${t.pnlUsd}`)
})

test('take profit, stop loss and a pulled pool close positions', async () => {
  const s = fresh()
  const m = market({ trending: ['TOKEN1'], rows: [token()] })
  await pt.tick()
  const st = s.strategies['meme-steady']
  m.rows = [token({ priceUsd: 1.3 })]
  await pt.tick()
  assert.match(st.closed.at(-1).reason, /take profit/)
  assert.ok(st.closed.at(-1).pnlUsd > 1.5)

  // Cooldown: the same token is not bought straight back.
  await pt.tick()
  assert.equal(st.positions.length, 0)

  m.trending = ['TOKEN2']
  m.rows = [token({ address: 'TOKEN2' })]
  await pt.tick()
  m.rows = [token({ address: 'TOKEN2', priceUsd: 0.8 })]
  await pt.tick()
  assert.match(st.closed.at(-1).reason, /stop loss/)

  m.trending = ['TOKEN3']
  m.rows = [token({ address: 'TOKEN3' })]
  await pt.tick()
  m.rows = [token({ address: 'TOKEN3', liq: 5000 })]
  await pt.tick()
  assert.match(st.closed.at(-1).reason, /liquidity pulled/)
})

test('the random control trades when chance says so, and only then', async () => {
  const s = fresh(() => 0.99)
  market({ trending: ['TOKEN1'], rows: [token({ buysH1: 1, sellsH1: 50, h1: -40 })] })
  await pt.tick()
  assert.equal(s.strategies['meme-random'].positions.length, 0)
  assert.equal(s.strategies['meme-steady'].positions.length, 0, 'the dump is filtered out')
  fresh(() => 0.01)
  await pt.tick()
  assert.equal(pt.state().strategies['meme-random'].positions.length, 1)
})

test('pausing stops new trades but still manages the open ones', async () => {
  const s = fresh()
  const m = market({ trending: ['TOKEN1'], rows: [token()] })
  await pt.tick()
  pt.setPaused(true)
  m.trending = ['TOKEN9']
  m.rows = [token(), token({ address: 'TOKEN9' })]
  await pt.tick()
  const st = s.strategies['meme-steady']
  assert.equal(st.positions.length, 1)
  m.rows = [token({ priceUsd: 0.5 }), token({ address: 'TOKEN9' })]
  await pt.tick()
  assert.equal(st.positions.length, 0, 'stop still fired while paused')
  pt.setPaused(false)
})

test('trend and breakout signals', () => {
  const q = { fast: 3, slow: 6 }
  const down = Array.from({ length: 20 }, (_, i) => 100 - i)
  const up = Array.from({ length: 30 }, (_, i) => 100 + i)
  assert.equal(pt.trendSignal(up, q), 0, 'an old trend is not a fresh signal')
  const cross = [...down, 100, 112]
  const sig = pt.trendSignal(cross, q)
  assert.equal(sig, 1)
  assert.equal(pt.trendNow(cross, q), 1)
  const flat = Array.from({ length: 30 }, () => 100)
  assert.equal(pt.breakoutSignal({ closes: [...flat, 105], highs: [...flat.map(() => 101), 106], lows: [...flat.map(() => 99), 100] }, { lookback: 24 }), 1)
  assert.equal(pt.breakoutSignal({ closes: [...flat, 100], highs: [...flat.map(() => 101), 101], lows: [...flat.map(() => 99), 99] }, { lookback: 24 }), 0)
})

test('a perp position pays fees and funding, and its stop fires', async () => {
  const s = fresh()
  const flat = Array.from({ length: 40 }, () => 100)
  const btc = { coin: 'BTC', mid: 106, funding: 0.0001, vlm: 1e9, maxLev: 40 }
  const m = market({ perps: [btc], candles: { BTC: { closes: [...flat, 106], highs: [...flat.map(() => 101), 107], lows: [...flat.map(() => 99), 100] } } })
  await pt.tick()
  const st = s.strategies['perp-breakout']
  assert.equal(st.positions.length, 1)
  const p = st.positions[0]
  assert.equal(p.side, 'long')
  assert.ok(Math.abs(p.margin - 16) < 0.05, `margin ${p.margin}`)
  p.fundAt -= 2 * HOUR
  m.perps = [{ ...btc, mid: 102.5 }]
  await pt.tick()
  assert.equal(st.positions.length, 0)
  const t = st.closed.at(-1)
  assert.match(t.reason, /stop loss/)
  // 2x on a -3.3% move: about -6.6% of margin, plus fees and two hours of funding.
  assert.ok(t.pnlPct < -6.5 && t.pnlPct > -8, `pnl ${t.pnlPct}%`)
})

test('learning: losers retire, the best gets a variation, settings stay in bounds', () => {
  const s = fresh()
  const loser = s.strategies['meme-momentum']
  loser.cash = 20
  loser.closed = Array.from({ length: 16 }, () => ({ pnlUsd: -1, fees: 0.5 }))
  const winner = s.strategies['meme-steady']
  winner.cash = 52
  winner.closed = Array.from({ length: 12 }, () => ({ pnlUsd: 1, fees: 0.5 }))
  const changes = pt.evolve()
  assert.equal(loser.active, false)
  assert.ok(changes.some((c) => /started meme-steady-v2/.test(c)), changes.join('; '))
  const child = s.strategies['meme-steady-v2']
  assert.equal(child.cash, pt.START_USD)
  assert.equal(child.parent, 'meme-steady')
  assert.ok(s.strategies['meme-random'].active, 'the control is never retired')

  const wild = pt.clampParams('trend', 'perp', { fast: 500, slow: 2, lev: 50, sl: 0 })
  assert.equal(wild.lev, 5)
  assert.equal(wild.sl, 1)
  assert.ok(wild.slow > wild.fast)
})

test('nothing is ready for real money on day one, and the summary says so', () => {
  fresh()
  assert.match(pt.summary(), /No strategy is ready for real money/)
  assert.match(pt.summary(), /pretend money only/)
  const st = pt.addStrategy({ id: 'Meme Fresh Launch', market: 'meme', kind: 'filter', params: { minAgeH: 0.5, minLiq: 15000 } })
  assert.equal(st.id, 'meme-fresh-launch')
  assert.equal(st.params.minLiq, 15000)
  assert.throws(() => pt.addStrategy({ market: 'meme', kind: 'breakout' }))
  pt.retireStrategy('meme-fresh-launch', 'test')
  assert.equal(pt.state().strategies['meme-fresh-launch'].active, false)
})
