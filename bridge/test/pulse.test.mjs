// node --test bridge/test/ — the Pulse board: columns, follow-ups, trends, and paper trades off it.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-pulse-'))
const pulse = await import('../hub/pulse.mjs')
const pt = await import('../hub/papertrade.mjs')

const HOUR = 3600_000
const MIN = 60000

/** A GeckoTerminal pool, as new_pools returns it. */
const gtPool = ({ address = 'POOL1', name = 'TKN / SOL', dex = 'pumpswap', px = 1, fdv = 300000, liq = 40000, ageMin = 30, buys = 400, sells = 200, buyers = 150, sellers = 80, h1 = 20, vol = 50000 } = {}) => ({
  id: `solana_${address}`,
  type: 'pool',
  attributes: {
    address, name, base_token_price_usd: String(px), fdv_usd: String(fdv), market_cap_usd: null, reserve_in_usd: String(liq),
    pool_created_at: new Date(Date.now() - ageMin * MIN).toISOString(),
    price_change_percentage: { m5: '2', h1: String(h1) },
    transactions: { h1: { buys, sells, buyers, sellers } },
    volume_usd: { h1: String(vol) },
  },
  relationships: { dex: { data: { id: dex, type: 'dex' } } },
})

test('pools sort into Axiom\'s three columns', () => {
  assert.equal(pulse.parsePool(gtPool({ dex: 'pump-fun', fdv: 8000 }), 'sol').stage, 'new')
  assert.equal(pulse.parsePool(gtPool({ dex: 'pump-fun', fdv: 52000 }), 'sol').stage, 'stretch')
  assert.equal(pulse.parsePool(gtPool({ dex: 'four-meme', fdv: 5000 }), 'bnb').stage, 'new')
  assert.equal(pulse.parsePool(gtPool({ dex: 'pumpswap' }), 'sol').stage, 'migrated')
  const r = pulse.parsePool(gtPool(), 'sol')
  assert.equal(r.key, 'sol:POOL1')
  assert.equal(r.symbol, 'TKN')
  assert.equal(r.buyersH1, 150)
  assert.equal(pulse.parsePool(gtPool({ px: 0 }), 'sol'), null)
  assert.deepEqual(Object.keys(pulse.CHAINS), ['sol', 'robinhood', 'ely', 'bnb', 'base', 'eth', 'hype', 'arc', 'ink'])
})

test('what a launch did after it was spotted is recorded at 1h and 6h', () => {
  pulse._reset()
  const t0 = Date.now()
  pulse.upsert(pulse.parsePool(gtPool({ px: 1 }), 'sol'), t0)
  pulse.upsert(pulse.parsePool(gtPool({ px: 3 }), 'sol'), t0 + 20 * MIN)
  pulse.upsert(pulse.parsePool(gtPool({ px: 1.5 }), 'sol'), t0 + 61 * MIN)
  let r = pulse.rows()['sol:POOL1']
  assert.equal(r.outcome.h1.change, 50)
  assert.equal(r.outcome.h1.peak, 200, 'it tripled on the way')
  assert.equal(r.outcome.h6, undefined)
  pulse.upsert(pulse.parsePool(gtPool({ px: 0.1 }), 'sol'), t0 + 6 * HOUR + MIN)
  r = pulse.rows()['sol:POOL1']
  assert.equal(r.outcome.h1.change, 50, 'an outcome, once recorded, stays')
  assert.ok(Math.abs(r.outcome.h6.change + 90) < 1e-9)
  assert.equal(r.first.buyersH1, 150, 'what it looked like when found is kept')
})

test('polling reads every chain, follows the liquid ones, and survives a chain failing', async () => {
  pulse._reset()
  const asked = []
  pulse.feeds.gap = 0
  pulse.feeds.retryAfter = 0
  pulse.feeds.newPools = async (chain) => {
    asked.push(chain)
    if (chain === 'arc') throw new Error('GeckoTerminal answered 429')
    if (chain !== 'sol') return []
    return [pulse.parsePool(gtPool({ address: 'LIQUID' }), 'sol'), pulse.parsePool(gtPool({ address: 'DUST', liq: 50 }), 'sol')]
  }
  const followed = []
  pulse.feeds.pools = async (chain, addrs) => {
    followed.push(...addrs)
    return addrs.map((a) => pulse.parsePool(gtPool({ address: a, px: 2 }), chain))
  }
  await pulse.poll()
  assert.equal(asked.length, 9)
  assert.deepEqual(followed, ['LIQUID'], 'dust pools are not followed')
  assert.equal(pulse.rows()['sol:LIQUID'].px, 2)
  assert.match(pulse.state().errors.arc, /429/)
  assert.match(pulse.summary(), /Spotted in the last hour: 2/)
  assert.match(pulse.summary(), /arc: GeckoTerminal answered 429/)
})

test('trends group launches by column, chain and what they looked like', () => {
  pulse._reset()
  const t0 = Date.now() - 2 * HOUR
  for (let i = 0; i < 6; i++) {
    pulse.upsert(pulse.parsePool(gtPool({ address: `W${i}`, buys: 600, sells: 100, px: 1 }), 'sol'), t0)
    pulse.upsert(pulse.parsePool(gtPool({ address: `W${i}`, px: 2.5 }), 'sol'), t0 + 61 * MIN)
    pulse.upsert(pulse.parsePool(gtPool({ address: `L${i}`, buys: 50, sells: 400, px: 1 }), 'base'), t0)
    pulse.upsert(pulse.parsePool(gtPool({ address: `L${i}`, px: 0.1 }), 'base'), t0 + 61 * MIN)
  }
  const t = pulse.trends('h1').join('\n')
  assert.match(t, /Solana: 6 followed, median \+150%, 100% up, 100% doubled/)
  assert.match(t, /Base: 6 followed, median -90%, 0% up, 0% doubled at some point, 100% died/)
  assert.match(t, /More sells than buys when found: 6 followed, median -90%/)
})

test('pulse paper strategies trade off the board, skip Ethereum gas, and take profit', async () => {
  pulse._reset()
  pt._reset({ rand: () => 0.99 })
  const s = pt.state()
  s.lastSignalAt = Date.now()
  pt.feeds.trending = async () => []
  pt.feeds.tokens = async () => []
  pt.feeds.perpMarket = async () => []
  pt.feeds.candles = async () => ({ closes: [], highs: [], lows: [] })

  const at = Date.now()
  pulse.upsert(pulse.parsePool(gtPool({ address: 'GOOD', px: 1 }), 'sol'), at)
  pulse.upsert(pulse.parsePool(gtPool({ address: 'GASSY', px: 1, vol: 999999 }), 'eth'), at)
  await pt.tick()
  const st = s.strategies['pulse-migrated']
  assert.equal(st.positions.length, 1)
  assert.equal(st.positions[0].key, 'sol:GOOD', 'Ethereum skipped: its gas would eat a $10 trade')
  assert.match(st.positions[0].why, /Migrated/)

  pulse.upsert(pulse.parsePool(gtPool({ address: 'GOOD', px: 1.6 }), 'sol'), Date.now() + 1000)
  await pt.tick()
  assert.equal(st.positions.length, 0)
  assert.match(st.closed.at(-1).reason, /take profit/)
  assert.ok(st.closed.at(-1).pnlUsd > 4)
  assert.match(pt.summary(), /Pulse launches on 9 chains/)

  const custom = pt.addStrategy({ id: 'pulse-bnb', market: 'pulse', kind: 'filter', params: { chains: 'bnb,nowhere', stage: 'bogus' } })
  assert.equal(custom.params.chains, 'bnb')
  assert.equal(custom.params.stage, 'any')
})

test('fake pools are never shown, followed, counted or traded', async () => {
  pulse._reset()
  // The real one from the first live run on Base.
  const scam = pulse.parsePool(gtPool({ address: 'SCAM', dex: 'uniswap-v4-base', fdv: 484.7e6, liq: 72.7e6, h1: 14542037, buyers: 2, sellers: 1, vol: 9e9 }), 'base')
  assert.equal(pulse.suspicious(scam), true)
  assert.equal(pulse.suspicious(pulse.parsePool(gtPool(), 'sol')), false)
  pulse.upsert(scam)
  pulse.upsert(pulse.parsePool(gtPool({ address: 'REAL' }), 'sol'))
  assert.deepEqual(pulse.candidates().map((r) => r.key), ['sol:REAL'])
  assert.doesNotMatch(pulse.summary(), /SCAM|TKN \(Base/)
  const followed = []
  pulse.feeds.newPools = async () => []
  pulse.feeds.pools = async (chain, addrs) => (followed.push(...addrs), [])
  await pulse.poll()
  assert.deepEqual(followed, ['REAL'])
})
