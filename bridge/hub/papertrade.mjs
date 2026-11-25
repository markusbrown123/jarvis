/**
 * Paper trading: JARVIS learning to trade with pretend money before any real
 * money moves.
 *
 * Three markets, the ones Markus wants to trade:
 * - Solana memecoins, the kind traded on Axiom: trending and boosted tokens
 *   from DexScreener, priced with Axiom-like costs (about 1% fee each way,
 *   slippage, and a network fee per transaction).
 * - Hyperliquid perps: the most-traded coins, from Hyperliquid's public data,
 *   with its taker fee and hourly funding.
 * - The Pulse: brand-new launches on every chain Axiom's Pulse shows
 *   (pulse.mjs), with Axiom's fee, the bigger slippage of a new pool, and
 *   each chain's own network fee.
 *
 * Several strategies run side by side, each with its own $40 book, so what
 * works shows up as a scoreboard rather than a feeling. Each market has a
 * random strategy too, trading at random under the same costs: a strategy
 * that can't beat it has found nothing. Every trade is kept with why it was
 * taken. Once a day the losers are retired and the best one gets a variation
 * tried beside it, so the set keeps learning; JARVIS can add his own ideas
 * (paper_strategy).
 *
 * Nothing here can move money: no keys, no wallet, no orders, only public
 * price data. When a strategy has made money after costs for long enough,
 * it goes on Needs for Markus to decide on a small live test.
 * JARVIS_NO_PAPER=1 turns it off.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import * as pulse from './pulse.mjs'

export const START_USD = 40
const TICK = 2 * 60000
/** Perp signals come from hourly candles, so there is no point reading them more often. */
const SIGNAL_EVERY = 15 * 60000
const DAY = 24 * 3600_000
const HOUR = 3600_000
const COOLDOWN = 6 * HOUR
const MAX_CLOSED = 500
const PROJECT = 'finance'

const DEX = 'https://api.dexscreener.com'
const HL = 'https://api.hyperliquid.xyz/info'

/**
 * What a trade costs, per side. Estimates, deliberately not flattering: on a
 * $10 memecoin position a round trip costs roughly 7%, which is the bar any
 * memecoin strategy has to clear before it has made a cent.
 */
export const COSTS = {
  meme: { feePct: 1, slippagePct: 1, networkUsd: 0.15 },
  perp: { feePct: 0.045, slippagePct: 0.02 },
  /** Network fee per chain comes from pulse.CHAINS. */
  pulse: { feePct: 1, slippagePct: 2 },
}

/** Most open positions per book, and the share of the book each one takes. */
const LIMITS = { meme: { open: 3, share: 0.25, min: 5 }, perp: { open: 2, share: 0.4, min: 3 }, pulse: { open: 3, share: 0.25, min: 5 } }

/** Valid kinds per market, and their default settings. */
const KINDS = {
  meme: {
    filter: { minLiq: 50000, minAgeH: 6, minBuyRatio: 1.0, minVolH1: 5000, h1Min: 5, h1Max: 40, m5Min: 0, h24Min: -100, tp: 25, sl: 12, maxHoldH: 6 },
    random: { minLiq: 25000, chance: 0.15, tp: 25, sl: 12, maxHoldH: 6 },
  },
  perp: {
    trend: { fast: 20, slow: 50, lev: 2, tp: 6, sl: 3, maxHoldH: 48 },
    breakout: { lookback: 24, lev: 2, tp: 9, sl: 3, maxHoldH: 48 },
    random: { lev: 2, chance: 0.25, tp: 6, sl: 3, maxHoldH: 48 },
  },
  pulse: {
    filter: { stage: 'migrated', chains: 'all', minLiq: 20000, minBuyRatio: 1.2, minBuyers: 50, minAgeMin: 5, maxAgeMin: 180, tp: 50, sl: 20, maxHoldH: 4 },
    random: { minLiq: 5000, chance: 0.15, tp: 50, sl: 20, maxHoldH: 3 },
  },
}

/** The strategies it starts with. */
export const SEED = [
  { id: 'meme-steady', market: 'meme', kind: 'filter', note: 'Established tokens climbing steadily, more buyers than sellers.', params: {} },
  { id: 'meme-momentum', market: 'meme', kind: 'filter', note: 'Younger tokens running hard with buyers piling in.', params: { minLiq: 25000, minAgeH: 1, minBuyRatio: 1.2, h1Min: 15, h1Max: 120, tp: 40, sl: 15, maxHoldH: 3 } },
  { id: 'meme-dip', market: 'meme', kind: 'filter', note: 'Buying a sharp dip in a token that is still up on the day.', params: { minAgeH: 24, minBuyRatio: 0.9, h1Min: -25, h1Max: -8, h24Min: 0, tp: 20, sl: 12, maxHoldH: 8 } },
  { id: 'meme-random', market: 'meme', kind: 'random', note: 'Control: random liquid trending tokens. Beat this or there is no edge.', params: {} },
  { id: 'perp-trend', market: 'perp', kind: 'trend', note: 'Follows a fresh 20/50 hour moving-average cross, 2x.', params: {} },
  { id: 'perp-breakout', market: 'perp', kind: 'breakout', note: 'Trades a break of the last day\'s high or low, 2x.', params: {} },
  { id: 'perp-random', market: 'perp', kind: 'random', note: 'Control: random coin, random side, same stops.', params: {} },
  { id: 'pulse-migrated', market: 'pulse', kind: 'filter', note: 'Pulse: just graduated to a real exchange, still drawing buyers.', params: {} },
  { id: 'pulse-stretch', market: 'pulse', kind: 'filter', note: 'Pulse: final stretch before graduating, buyers outnumbering sellers.', params: { stage: 'stretch', minLiq: 8000, minBuyRatio: 1.3, minBuyers: 40, minAgeMin: 2, maxAgeMin: 120, tp: 60, sl: 25, maxHoldH: 2 } },
  { id: 'pulse-random', market: 'pulse', kind: 'random', note: 'Control: random liquid launches off the Pulse.', params: {} },
]

/** Every setting stays in a sane range, whoever sets it. */
const BOUNDS = {
  minLiq: [10000, 1e7], minAgeH: [0, 720], minBuyRatio: [0.3, 5], minVolH1: [0, 1e7],
  h1Min: [-90, 500], h1Max: [-90, 1000], m5Min: [-50, 100], h24Min: [-100, 10000],
  tp: [2, 500], sl: [1, 60], maxHoldH: [0.25, 168], chance: [0.01, 1],
  fast: [3, 100], slow: [5, 300], lookback: [4, 200], lev: [1, 5],
  minBuyers: [0, 10000], minAgeMin: [0, 1440], maxAgeMin: [1, 2880],
}
const INTEGER = new Set(['fast', 'slow', 'lookback'])

let random = Math.random
const now = () => Date.now()
const r2 = (x) => Math.round(x * 100) / 100
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0)
const usd = (x) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`
const signed = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
const k = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}m` : `$${Math.round(x / 1000)}k`)

export function clampParams(kind, market, params) {
  const out = { ...KINDS[market][kind], ...params }
  for (const [key, v] of Object.entries(out)) {
    const b = BOUNDS[key]
    if (!b || typeof v !== 'number' || !Number.isFinite(v)) continue
    out[key] = Math.min(b[1], Math.max(b[0], INTEGER.has(key) ? Math.round(v) : r2(v)))
  }
  if (out.h1Max != null && out.h1Max < out.h1Min) out.h1Max = out.h1Min
  if (out.slow != null && out.slow <= out.fast) out.slow = Math.min(BOUNDS.slow[1], out.fast + 5)
  if (out.maxAgeMin != null && out.maxAgeMin < out.minAgeMin) out.maxAgeMin = out.minAgeMin + 1
  if (out.stage != null && !['any', 'new', 'stretch', 'migrated'].includes(out.stage)) out.stage = 'any'
  if (out.chains != null && out.chains !== 'all') {
    const ok = String(out.chains).split(',').map((c) => c.trim()).filter((c) => pulse.CHAINS[c])
    out.chains = ok.length ? ok.join(',') : 'all'
  }
  return out
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const dir = () => join(hub.DATA_DIR, 'paper')
const file = () => join(dir(), 'state.json')
let S = null

function blank() {
  return { version: 1, startedAt: now(), paused: false, strategies: {}, lastSignalAt: 0, lastDailyAt: now(), lastTickAt: 0, ticks: 0, errors: {}, notified: {} }
}

function newStrategy({ id, market, kind, params = {}, note = '', parent = null }) {
  return {
    id, market, kind, note, parent,
    params: clampParams(kind, market, params),
    active: true, createdAt: now(),
    cash: START_USD, positions: [], closed: [], peak: START_USD, maxDd: 0, cooldown: {}, missed: {},
  }
}

export function state() {
  if (S) return S
  try {
    S = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    S = blank()
  }
  for (const seed of SEED) S.strategies[seed.id] ??= newStrategy(seed)
  return S
}

function save() {
  mkdirSync(dir(), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(S), { mode: 0o600 })
  renameSync(tmp, file())
}

// ---------------------------------------------------------------------------
// Market data (public, no keys). Replaceable in tests.
// ---------------------------------------------------------------------------

async function getJson(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : { accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return res.json()
}

/** DexScreener pairs → one row per token, its most liquid pair. */
export function normalizePairs(pairs, at = now()) {
  const best = new Map()
  for (const p of pairs ?? []) {
    const addr = p?.baseToken?.address
    const price = Number(p?.priceUsd)
    if (!addr || !(price > 0)) continue
    const liq = Number(p?.liquidity?.usd ?? 0)
    if ((best.get(addr)?.liq ?? -1) >= liq) continue
    best.set(addr, {
      address: addr,
      symbol: p.baseToken.symbol ?? addr.slice(0, 6),
      url: p.url ?? '',
      priceUsd: price,
      liq,
      volH1: Number(p?.volume?.h1 ?? 0),
      m5: Number(p?.priceChange?.m5 ?? 0),
      h1: Number(p?.priceChange?.h1 ?? 0),
      h24: Number(p?.priceChange?.h24 ?? 0),
      buysH1: Number(p?.txns?.h1?.buys ?? 0),
      sellsH1: Number(p?.txns?.h1?.sells ?? 0),
      ageH: p?.pairCreatedAt ? (at - p.pairCreatedAt) / HOUR : 0,
      mcap: Number(p?.marketCap ?? p?.fdv ?? 0),
    })
  }
  return [...best.values()]
}

export const feeds = {
  /** Solana tokens people are paying to promote or have just listed. */
  async trending() {
    const [boosts, profiles] = await Promise.all([
      getJson(`${DEX}/token-boosts/top/v1`).catch(() => []),
      getJson(`${DEX}/token-profiles/latest/v1`).catch(() => []),
    ])
    const addrs = [...(boosts ?? []), ...(profiles ?? [])].filter((x) => x?.chainId === 'solana' && x.tokenAddress).map((x) => x.tokenAddress)
    return [...new Set(addrs)].slice(0, 60)
  },
  async tokens(addresses) {
    const pairs = []
    for (let i = 0; i < addresses.length; i += 30) pairs.push(...(await getJson(`${DEX}/tokens/v1/solana/${addresses.slice(i, i + 30).join(',')}`)))
    return normalizePairs(pairs)
  },
  async perpMarket() {
    const [meta, ctxs] = await getJson(HL, { type: 'metaAndAssetCtxs' })
    return meta.universe
      .map((u, i) => ({ coin: u.name, mid: Number(ctxs[i]?.midPx ?? ctxs[i]?.markPx), funding: Number(ctxs[i]?.funding ?? 0), vlm: Number(ctxs[i]?.dayNtlVlm ?? 0), maxLev: u.maxLeverage, delisted: Boolean(u.isDelisted) }))
      .filter((m) => m.mid > 0 && !m.delisted)
  },
  async candles(coin, hours) {
    const end = now()
    const c = await getJson(HL, { type: 'candleSnapshot', req: { coin, interval: '1h', startTime: end - hours * HOUR, endTime: end } })
    const done = c.filter((x) => x.T < end) // the candle still forming would repaint
    return { closes: done.map((x) => +x.c), highs: done.map((x) => +x.h), lows: done.map((x) => +x.l) }
  },
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

function markValue(p) {
  if (p.market !== 'perp') {
    const C = p.costs ?? COSTS.meme
    return Math.max(0, p.qty * p.lastPx * (1 - C.slippagePct / 100) * (1 - C.feePct / 100) - C.networkUsd)
  }
  const closeFee = p.size * p.lastPx * (COSTS.perp.feePct / 100)
  return Math.max(0, p.margin + p.size * (p.lastPx - p.entryEff) * p.dir - p.funding - closeFee)
}

export const equity = (st) => st.cash + st.positions.reduce((a, p) => a + markValue(p), 0)

function record(st, p, exitPx, back, fees, reason) {
  st.positions = st.positions.filter((x) => x !== p)
  st.cash += back
  const pnlUsd = back - p.cost
  st.closed.push({
    symbol: p.symbol, side: p.side, entryPx: p.entryPx, exitPx,
    openedAt: p.openedAt, closedAt: now(), heldMin: Math.round((now() - p.openedAt) / 60000),
    pnlUsd: r2(pnlUsd), pnlPct: r2((pnlUsd / p.cost) * 100), fees: r2(fees), reason, why: p.why,
  })
  if (st.closed.length > MAX_CLOSED) st.closed.splice(0, st.closed.length - MAX_CLOSED)
  st.cooldown[p.key ?? p.address ?? p.symbol] = now()
}

/** What a $-sized spot buy would cost. Pulse adds the chain's own network fee. */
function spotCosts(market, chain) {
  if (market === 'meme') return COSTS.meme
  return { ...COSTS.pulse, networkUsd: pulse.CHAINS[chain]?.gasUsd ?? 0.1 }
}

const spotSize = (st) => Math.min(st.cash, Math.max(LIMITS[st.market].min, equity(st) * LIMITS[st.market].share))

/** Buy a token: memecoins on Solana, or a launch off the Pulse. */
function openSpot(st, c, why, extra = {}) {
  const C = spotCosts(st.market, c.chain)
  const spend = spotSize(st)
  if (spend < LIMITS[st.market].min) return null
  const fee = spend * (C.feePct / 100) + C.networkUsd
  const entryEff = c.priceUsd * (1 + C.slippagePct / 100)
  st.cash -= spend
  const p = {
    market: st.market, symbol: c.symbol, address: c.address, url: c.url, side: 'long', dir: 1, costs: C,
    entryPx: c.priceUsd, lastPx: c.priceUsd, qty: (spend - fee) / entryEff, cost: spend, fees: fee,
    openedAt: now(), seenAt: now(), entryLiq: c.liq, why, ...extra,
  }
  st.positions.push(p)
  return p
}

const openMeme = (st, c, why) => openSpot(st, c, why)

function closeSpot(st, p, px, reason) {
  const C = p.costs ?? COSTS.meme
  const gross = p.qty * px * (1 - C.slippagePct / 100)
  const fee = gross * (C.feePct / 100) + C.networkUsd
  record(st, p, px, Math.max(0, gross - fee), p.fees + fee, reason)
}

function openPerp(st, m, d, why) {
  const P = COSTS.perp
  const lev = Math.min(st.params.lev, m.maxLev ?? st.params.lev)
  const margin = Math.min(st.cash / (1 + lev * (P.feePct / 100)), equity(st) * LIMITS.perp.share)
  if (margin < LIMITS.perp.min) return null
  const notional = margin * lev
  const entryEff = m.mid * (1 + d * (P.slippagePct / 100))
  const fee = notional * (P.feePct / 100)
  st.cash -= margin + fee
  const p = {
    market: 'perp', symbol: m.coin, side: d > 0 ? 'long' : 'short', dir: d, lev,
    entryPx: m.mid, entryEff, lastPx: m.mid, size: notional / entryEff, margin, cost: margin + fee, fees: fee,
    funding: 0, fundAt: now(), openedAt: now(), why,
  }
  st.positions.push(p)
  return p
}

function closePerp(st, p, px, reason) {
  const P = COSTS.perp
  const exitEff = px * (1 - p.dir * (P.slippagePct / 100))
  const fee = p.size * exitEff * (P.feePct / 100)
  const pnl = p.size * (exitEff - p.entryEff) * p.dir - fee - p.funding
  record(st, p, px, Math.max(0, p.margin + pnl), p.fees + fee, reason)
}

/** Take profit, stop loss, time limit: the same three rules for every position. */
function exitReason(st, p) {
  const move = pct(p.lastPx, p.entryPx) * p.dir
  if (move >= st.params.tp) return `take profit (${signed(move)})`
  if (move <= -st.params.sl) return `stop loss (${signed(move)})`
  if (now() - p.openedAt >= st.params.maxHoldH * HOUR) return `time limit (${signed(move)})`
  return null
}

function trackDrawdown(st) {
  const eq = equity(st)
  st.peak = Math.max(st.peak, eq)
  st.maxDd = Math.max(st.maxDd, r2(((st.peak - eq) / st.peak) * 100))
}

const cooling = (st, key) => now() - (st.cooldown[key] ?? 0) < COOLDOWN
const active = (market) => Object.values(state().strategies).filter((s) => s.market === market && s.active)

// ---------------------------------------------------------------------------
// Memecoins
// ---------------------------------------------------------------------------

export function passes(c, q) {
  const ratio = c.sellsH1 ? c.buysH1 / c.sellsH1 : c.buysH1 > 0 ? 9 : 0
  return (
    c.liq >= q.minLiq && c.ageH >= q.minAgeH && ratio >= q.minBuyRatio && c.volH1 >= q.minVolH1 &&
    c.h1 >= q.h1Min && c.h1 <= q.h1Max && c.m5 >= q.m5Min && c.h24 >= q.h24Min
  )
}

const memeWhy = (c) => {
  const ratio = c.sellsH1 ? (c.buysH1 / c.sellsH1).toFixed(1) : '∞'
  return `1h ${signed(c.h1)}, 5m ${signed(c.m5)}, 24h ${signed(c.h24)}, buys/sells ${ratio}, liquidity ${k(c.liq)}, 1h volume ${k(c.volH1)}, ${Math.round(c.ageH)}h old`
}

async function memeStep({ entries }) {
  const books = active('meme')
  const held = [...new Set(books.flatMap((s) => s.positions.map((p) => p.address)))]
  const trending = entries ? await feeds.trending() : []
  const rows = await feeds.tokens([...new Set([...held, ...trending])])
  const by = new Map(rows.map((r) => [r.address, r]))
  const candidates = rows.filter((r) => trending.includes(r.address))

  for (const st of books) {
    for (const p of [...st.positions]) {
      const r = by.get(p.address)
      if (!r) {
        // Gone from the data: delisted or drained. Assume the worst after half an hour.
        if (now() - p.seenAt > 30 * 60000) closeSpot(st, p, p.lastPx * 0.5, 'vanished from the market data (assumed rug)')
        continue
      }
      p.lastPx = r.priceUsd
      p.seenAt = now()
      if (p.entryLiq && r.liq < p.entryLiq * 0.3) {
        closeSpot(st, p, r.priceUsd * 0.7, `liquidity pulled (${k(p.entryLiq)} → ${k(r.liq)})`)
        continue
      }
      const why = exitReason(st, p)
      if (why) closeSpot(st, p, r.priceUsd, why)
    }
    trackDrawdown(st)
    if (!entries || st.positions.length >= LIMITS.meme.open) continue

    const open = new Set(st.positions.map((p) => p.address))
    const fresh = candidates.filter((c) => !open.has(c.address) && !cooling(st, c.address))
    let pick = null
    if (st.kind === 'random') {
      const pool = fresh.filter((c) => c.liq >= st.params.minLiq)
      if (pool.length && random() < st.params.chance) pick = pool[Math.floor(random() * pool.length)]
    } else {
      pick = fresh.filter((c) => passes(c, st.params)).sort((a, b) => b.volH1 - a.volH1)[0] ?? null
    }
    if (pick) openMeme(st, pick, memeWhy(pick))
  }
}

// ---------------------------------------------------------------------------
// The Pulse: new launches on every chain Axiom shows
// ---------------------------------------------------------------------------

const buyRatio = (r) => (r.sellsH1 ? r.buysH1 / r.sellsH1 : r.buysH1 > 0 ? 9 : 0)

export function pulsePasses(r, q, at = now()) {
  const ageMin = (at - r.createdAt) / 60000
  return (
    (q.stage === 'any' || r.stage === q.stage) &&
    (q.chains === 'all' || q.chains.split(',').includes(r.chain)) &&
    r.liq >= q.minLiq && buyRatio(r) >= q.minBuyRatio && r.buyersH1 >= q.minBuyers &&
    ageMin >= q.minAgeMin && ageMin <= q.maxAgeMin
  )
}

/** A chain whose network fee would eat the trade is not worth trading at this size. */
const affordable = (st, r) => 2 * (pulse.CHAINS[r.chain]?.gasUsd ?? 0.1) <= spotSize(st) * 0.05

const pulseWhy = (r) =>
  `${pulse.STAGES[r.stage]} on ${pulse.CHAINS[r.chain]?.name ?? r.chain} (${r.dex}), ${Math.round((now() - r.createdAt) / 60000)} min old, mcap ${k(r.fdv)}, liquidity ${k(r.liq)}, 1h ${signed(r.h1)}, ${r.buyersH1} buyers / ${r.sellersH1} sellers`

async function pulseStep({ entries }) {
  const books = active('pulse')
  pulse.hold(books.flatMap((s) => s.positions.map((p) => p.key)))
  const board = pulse.rows()
  const fresh = entries ? pulse.candidates() : []

  for (const st of books) {
    for (const p of [...st.positions]) {
      const r = board[p.key]
      if (!r) {
        if (now() - p.seenAt > 45 * 60000) closeSpot(st, p, p.lastPx * 0.5, 'vanished from the Pulse data (assumed rug)')
        continue
      }
      if (r.updatedAt <= p.seenAt) continue // no new reading yet
      p.lastPx = r.px
      p.seenAt = r.updatedAt
      if (p.entryLiq && r.liq < p.entryLiq * 0.3) {
        closeSpot(st, p, r.px * 0.7, `liquidity pulled (${k(p.entryLiq)} → ${k(r.liq)})`)
        continue
      }
      const why = exitReason(st, p)
      if (why) closeSpot(st, p, r.px, why)
    }
    trackDrawdown(st)
    if (!entries || st.positions.length >= LIMITS.pulse.open) continue

    const open = new Set(st.positions.map((p) => p.key))
    const pool = fresh.filter((r) => !open.has(r.key) && !cooling(st, r.key) && affordable(st, r))
    let pick = null
    if (st.kind === 'random') {
      const liquid = pool.filter((r) => r.liq >= st.params.minLiq)
      if (liquid.length && random() < st.params.chance) pick = liquid[Math.floor(random() * liquid.length)]
    } else {
      pick = pool.filter((r) => pulsePasses(r, st.params)).sort((a, b) => b.volH1 - a.volH1)[0] ?? null
    }
    if (pick) openSpot(st, { ...pick, priceUsd: pick.px }, pulseWhy(pick), { key: pick.key, chain: pick.chain, address: undefined, seenAt: pick.updatedAt })
  }
}

// ---------------------------------------------------------------------------
// Hyperliquid perps
// ---------------------------------------------------------------------------

export function ema(xs, n) {
  const a = 2 / (n + 1)
  const out = []
  let e = xs[0]
  for (const x of xs) out.push((e = x * a + e * (1 - a)))
  return out
}

/** 1 long, -1 short, 0 nothing. Only a cross in the last two candles counts as fresh. */
export function trendSignal(closes, q) {
  if (closes.length < q.slow + 3) return 0
  const f = ema(closes, q.fast)
  const s = ema(closes, q.slow)
  const L = closes.length - 1
  const side = (i) => (f[i] > s[i] ? 1 : -1)
  const d = side(L)
  if (side(L - 2) === d) return 0
  return (d > 0 && closes[L] > f[L]) || (d < 0 && closes[L] < f[L]) ? d : 0
}

export function trendNow(closes, q) {
  if (closes.length < q.slow) return 0
  const f = ema(closes, q.fast)
  const s = ema(closes, q.slow)
  return f.at(-1) > s.at(-1) ? 1 : -1
}

export function breakoutSignal(c, q) {
  const L = c.closes.length - 1
  if (L < q.lookback + 1) return 0
  const hi = Math.max(...c.highs.slice(L - q.lookback, L))
  const lo = Math.min(...c.lows.slice(L - q.lookback, L))
  if (c.closes[L] > hi) return 1
  if (c.closes[L] < lo) return -1
  return 0
}

async function perpStep({ entries }) {
  const books = active('perp')
  const market = await feeds.perpMarket()
  const by = new Map(market.map((m) => [m.coin, m]))
  const signals = entries && now() - state().lastSignalAt >= SIGNAL_EVERY
  const top = [...market].sort((a, b) => b.vlm - a.vlm).slice(0, 8)
  const candles = new Map()
  if (signals) {
    const need = Math.max(...books.map((s) => (s.kind === 'trend' ? s.params.slow + 10 : s.kind === 'breakout' ? s.params.lookback + 5 : 0)), 60)
    const coins = new Set([...top.map((m) => m.coin), ...books.flatMap((s) => s.positions.map((p) => p.symbol))])
    for (const coin of coins) candles.set(coin, await feeds.candles(coin, need))
    state().lastSignalAt = now()
  }

  for (const st of books) {
    for (const p of [...st.positions]) {
      const m = by.get(p.symbol)
      if (!m) continue
      const hours = (now() - p.fundAt) / HOUR
      p.funding += p.size * p.lastPx * m.funding * hours * p.dir // longs pay positive funding
      p.fundAt = now()
      p.lastPx = m.mid
      if (markValue(p) <= p.margin * 0.1) {
        closePerp(st, p, m.mid, `liquidated (${signed(pct(m.mid, p.entryPx) * p.dir)} at ${p.lev}x)`)
        continue
      }
      let why = exitReason(st, p)
      const c = candles.get(p.symbol)
      if (!why && c && st.kind === 'trend' && trendNow(c.closes, st.params) === -p.dir) why = 'trend turned'
      if (why) closePerp(st, p, m.mid, why)
    }
    trackDrawdown(st)
    if (!signals || st.positions.length >= LIMITS.perp.open) continue

    const open = new Set(st.positions.map((p) => p.symbol))
    const fresh = top.filter((m) => !open.has(m.coin) && !cooling(st, m.coin))
    if (st.kind === 'random') {
      if (fresh.length && random() < st.params.chance) {
        const m = fresh[Math.floor(random() * fresh.length)]
        openPerp(st, m, random() < 0.5 ? 1 : -1, 'random entry (control)')
      }
      continue
    }
    for (const m of fresh) {
      const c = candles.get(m.coin)
      if (!c) continue
      const d = st.kind === 'trend' ? trendSignal(c.closes, st.params) : breakoutSignal(c, st.params)
      if (!d) continue
      const why = st.kind === 'trend'
        ? `${st.params.fast}/${st.params.slow}h average crossed ${d > 0 ? 'up' : 'down'}`
        : `broke the ${st.params.lookback}h ${d > 0 ? 'high' : 'low'}`
      openPerp(st, m, d, `${why}; funding ${(m.funding * 100).toFixed(4)}%/h`)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Learning: retire what loses, try variations of what wins
// ---------------------------------------------------------------------------

function retire(st, why) {
  st.active = false
  st.retiredAt = now()
  st.retiredWhy = why
}

function mutate(params, kind, market) {
  const out = {}
  for (const [key, v] of Object.entries(params)) out[key] = typeof v === 'number' && BOUNDS[key] && key !== 'lev' ? v * (1 + (random() * 2 - 1) * 0.2) : v
  return clampParams(kind, market, out)
}

export function evolve() {
  const s = state()
  const changes = []
  for (const market of ['meme', 'perp', 'pulse']) {
    for (const st of active(market)) {
      if (st.kind === 'random' || st.positions.length) continue
      const eq = equity(st)
      if (eq < LIMITS[market].min) {
        retire(st, 'out of money')
        changes.push(`retired ${st.id}: out of money`)
      } else if (st.closed.length >= 15 && eq < START_USD * 0.7) {
        retire(st, `down ${signed(pct(eq, START_USD))} after ${st.closed.length} trades`)
        changes.push(`retired ${st.id}: ${st.retiredWhy}`)
      }
    }
    const live = active(market).filter((x) => x.kind !== 'random')
    if (live.length >= 5) continue
    const best = live.filter((x) => x.closed.length >= 10 && equity(x) > START_USD).sort((a, b) => equity(b) - equity(a))[0]
    if (!best) continue
    const root = best.id.replace(/-v\d+$/, '')
    const n = Object.keys(s.strategies).filter((id) => id.startsWith(`${root}-v`)).length + 2
    const id = `${root}-v${n}`
    s.strategies[id] = newStrategy({ id, market, kind: best.kind, params: mutate(best.params, best.kind, market), parent: best.id, note: `A variation of ${best.id}, which was up ${signed(pct(equity(best), START_USD))}.` })
    changes.push(`started ${id}, a variation of ${best.id}`)
  }
  return changes
}

/**
 * The bar for a live test: two weeks, forty trades, up at least 10% after
 * every cost, ahead of the random control, and never more than a third down
 * from its best. Clearing it means "worth a small test", not "will make money".
 */
export function readyForLive(st) {
  if (st.kind === 'random') return false
  const control = Object.values(state().strategies).find((x) => x.market === st.market && x.kind === 'random')
  const ret = pct(equity(st), START_USD)
  const controlRet = control ? pct(equity(control), START_USD) : 0
  return now() - st.createdAt >= 14 * DAY && st.closed.length >= 40 && ret >= 10 && ret > controlRet && st.maxDd < 35
}

function daily() {
  const s = state()
  if (now() - s.lastDailyAt < DAY) return
  s.lastDailyAt = now()
  const changes = evolve()
  hub.activity({ source: 'jarvis', project: PROJECT, title: 'Paper trading: the day', detail: [...changes, '', summary()].join('\n'), level: 'info' })
  for (const st of Object.values(s.strategies)) {
    if (!st.active || !readyForLive(st) || s.notified[st.id]) continue
    s.notified[st.id] = now()
    hub.upsertItem({
      id: `paper:ready:${st.id}`,
      source: 'jarvis',
      project: PROJECT,
      title: `Paper strategy ${st.id} is up ${signed(pct(equity(st), START_USD))} — try it with real money?`,
      why: `${st.closed.length} paper trades over ${Math.round((now() - st.createdAt) / DAY)} days, after fees and slippage, ahead of the random control. Worst drop ${st.maxDd.toFixed(0)}%.`,
      instructions: 'Nothing has been traded for real. If you want a live test, say how much (e.g. $40) and on which venue; a live test needs a separate wallet or API key holding only that amount, which you set up yourself.',
      priority: 'P2',
      state: 'open',
    })
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

let inFlight = false

export async function tick() {
  if (inFlight) return
  inFlight = true
  const s = state()
  try {
    const entries = !s.paused
    for (const [name, step] of [['meme', memeStep], ['perp', perpStep], ['pulse', pulseStep]]) {
      try {
        await step({ entries })
        delete s.errors[name]
      } catch (e) {
        s.errors[name] = `${new Date().toISOString()} ${e?.message ?? e}`
      }
    }
    daily()
    s.ticks++
    s.lastTickAt = now()
  } finally {
    save()
    inFlight = false
  }
}

export function start() {
  if (process.env.JARVIS_NO_PAPER === '1') return
  state()
  setTimeout(() => void tick(), 20000).unref()
  setInterval(() => void tick(), TICK).unref()
}

// ---------------------------------------------------------------------------
// What JARVIS says about it (hub tools)
// ---------------------------------------------------------------------------

function line(st) {
  const eq = equity(st)
  const n = st.closed.length
  const wins = st.closed.filter((t) => t.pnlUsd > 0).length
  const fees = st.closed.reduce((a, t) => a + t.fees, 0) + st.positions.reduce((a, p) => a + p.fees, 0)
  return `- ${st.id}: ${usd(eq)} (${signed(pct(eq, START_USD))}), ${n} closed${n ? `, ${Math.round((wins / n) * 100)}% won` : ''}, ${st.positions.length} open, fees ${usd(fees)}, worst drop ${st.maxDd.toFixed(0)}%${st.kind === 'random' ? ' — random control' : ''}`
}

export function summary() {
  const s = state()
  const days = Math.max(0, (now() - s.startedAt) / DAY)
  const out = [
    `Paper trading, pretend money only: each strategy started with ${usd(START_USD)}. Running ${days < 1 ? `${Math.round(days * 24)} hours` : `${days.toFixed(1)} days`}${s.paused ? ' — PAUSED for new trades' : ''}.`,
  ]
  for (const [market, title] of [['meme', `Solana memecoins (Axiom-style costs: ${COSTS.meme.feePct}% fee + ~${COSTS.meme.slippagePct}% slippage each way + $${COSTS.meme.networkUsd} network fee)`], ['perp', `Hyperliquid perps (taker fee ${COSTS.perp.feePct}% + funding)`], ['pulse', `Pulse launches on ${Object.keys(pulse.CHAINS).length} chains (${COSTS.pulse.feePct}% fee + ~${COSTS.pulse.slippagePct}% slippage each way + each chain's network fee)`]]) {
    out.push('', `${title}:`)
    for (const st of active(market).sort((a, b) => equity(b) - equity(a))) out.push(line(st))
    if (s.errors[market]) out.push(`  (data problem: ${s.errors[market]})`)
  }
  const retired = Object.values(s.strategies).filter((x) => !x.active)
  if (retired.length) out.push('', `Retired: ${retired.map((x) => `${x.id} (${x.retiredWhy})`).join('; ')}.`)
  const ready = Object.values(s.strategies).filter((x) => x.active && readyForLive(x))
  out.push('', ready.length
    ? `Ready for a small live test, if Markus wants one: ${ready.map((x) => x.id).join(', ')}.`
    : 'No strategy is ready for real money. The bar: 14 days, 40 trades, up 10% after costs, ahead of the random control, worst drop under 35%.')
  return out.join('\n')
}

export function detail(id) {
  const st = state().strategies[id]
  if (!st) return null
  const out = [line(st), `  ${st.note}`, `  kind ${st.kind}; settings ${JSON.stringify(st.params)}${st.parent ? `; from ${st.parent}` : ''}${st.active ? '' : `; retired: ${st.retiredWhy}`}`]
  if (st.positions.length) {
    out.push('Open:')
    for (const p of st.positions) out.push(`- ${p.side} ${p.symbol} at ${p.entryPx}, now ${p.lastPx} (${signed(pct(p.lastPx, p.entryPx) * p.dir)}); ${p.why}`)
  }
  if (st.closed.length) {
    out.push('Last trades:')
    for (const t of st.closed.slice(-10).reverse()) out.push(`- ${t.side} ${t.symbol}: ${usd(t.pnlUsd)} (${signed(t.pnlPct)}) after ${t.heldMin} min, ${t.reason}. Entry: ${t.why}`)
  }
  return out.join('\n')
}

export function addStrategy({ id, market, kind, params = {}, note = '' }) {
  if (!KINDS[market]?.[kind]) throw new Error(`${market} strategies are: ${Object.keys(KINDS[market] ?? {}).join(', ')}`)
  const s = state()
  const slug = (id || `${market}-${kind}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  let name = slug
  for (let i = 2; s.strategies[name]; i++) name = `${slug}-${i}`
  s.strategies[name] = newStrategy({ id: name, market, kind, params, note })
  save()
  return s.strategies[name]
}

export function retireStrategy(id, why = 'retired by JARVIS') {
  const st = state().strategies[id]
  if (!st) throw new Error(`No strategy called ${id}.`)
  for (const p of [...st.positions]) (p.market === 'perp' ? closePerp : closeSpot)(st, p, p.lastPx, 'strategy retired')
  retire(st, why)
  save()
  return st
}

export function setPaused(on) {
  state().paused = Boolean(on)
  save()
}

/** Tests only. */
export function _reset({ rand, wipe = false } = {}) {
  S = wipe ? blank() : null
  inFlight = false
  if (rand) random = rand
}
