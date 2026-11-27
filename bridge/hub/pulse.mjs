/**
 * Axiom's Pulse, rebuilt from public data, so JARVIS can watch it all day.
 *
 * Pulse is Axiom's live board of brand-new tokens on the chains Markus has
 * turned on (sol, robinhood, ely, bnb, base, eth, hype, arc, ink), in three
 * columns: new pairs, the final stretch before a launchpad token graduates,
 * and those that just migrated to a real exchange. Axiom publishes no feed of
 * it, and reading it by logging in as Markus would put his account at risk,
 * so the same board is built here from GeckoTerminal's free data: the newest
 * pools on each chain, sorted into the same three columns by where they trade.
 *
 * Watching is half of it. The promising ones (some liquidity) are followed for
 * a day, and what became of them an hour, six hours and a day after they were
 * spotted is kept — by column, by chain, by what they looked like when found.
 * That record is how JARVIS learns which launches tend to run and which die,
 * and the paper trader's pulse strategies trade straight off this board.
 *
 * Read-only, public data, no keys. The real page is still there to look at:
 * https://axiom.trade/pulse. JARVIS_NO_PULSE=1 turns this off.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'

const GT = 'https://api.geckoterminal.com/api/v2'
const EVERY = 3 * 60000
/**
 * GeckoTerminal's free tier says 30 calls a minute, but in practice it
 * refused after five quick ones. One call every 6.5 seconds, and a refusal is
 * waited out once before giving up on that chain until the next round.
 */
const GAP = 6500
const RETRY_AFTER = 20000
const HOUR = 3600_000
const KEEP = 30 * HOUR
const MAX_ROWS = 3000
const FOLLOW_MIN_LIQ = 5000
const FOLLOW_PER_CHAIN = 30
const FOLLOW_CHAINS_PER_ROUND = 4

/**
 * Axiom's chain names → GeckoTerminal's, with a rough network fee per
 * transaction in dollars (an estimate, for the paper trader's costs). "ely"
 * is taken to be Elysium and "hype" HyperEVM.
 */
export const CHAINS = {
  sol: { gt: 'solana', name: 'Solana', gasUsd: 0.15 },
  robinhood: { gt: 'robinhood', name: 'Robinhood Chain', gasUsd: 0.1 },
  ely: { gt: 'elysium', name: 'Elysium', gasUsd: 0.1 },
  bnb: { gt: 'bsc', name: 'BNB Chain', gasUsd: 0.1 },
  base: { gt: 'base', name: 'Base', gasUsd: 0.05 },
  eth: { gt: 'eth', name: 'Ethereum', gasUsd: 3 },
  hype: { gt: 'hyperevm', name: 'HyperEVM', gasUsd: 0.05 },
  arc: { gt: 'arc', name: 'Arc', gasUsd: 0.05 },
  ink: { gt: 'ink', name: 'Ink', gasUsd: 0.05 },
}

/** Bonding-curve launchpads: a token here has not graduated yet. */
const LAUNCHPAD = /pump-?fun|dbc|launch-?lab|bonk|four-?meme|moonshot|believe|clanker|zora|virtuals|boop|heaven|bags|nad-?fun|flap/i
/** Near graduation: pump.fun-style curves complete somewhere around here. */
const STRETCH_FDV = 35000

export const STAGES = { new: 'New pairs', stretch: 'Final stretch', migrated: 'Migrated' }

/**
 * Fake pools: enormous "liquidity" or impossible jumps with almost nobody
 * trading. Seen live on Base on the first day: $72m of liquidity, up
 * 14,000,000% in an hour, two buyers. They are never shown, followed, counted
 * in the trends or traded.
 */
export const suspicious = (r) => (r.liq > 1e6 && r.buyersH1 < 20) || r.h1 > 100000 || r.fdv > 1e9

export function stageOf(dex, fdv) {
  if (LAUNCHPAD.test(dex)) return fdv >= STRETCH_FDV ? 'stretch' : 'new'
  return 'migrated'
}

const now = () => Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0)
const signed = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(0)}%`
const k = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}m` : x >= 1000 ? `$${Math.round(x / 1000)}k` : `$${Math.round(x)}`)

/** One GeckoTerminal pool → one row on the board, or null if unpriced. */
export function parsePool(p, chain, at = now()) {
  const a = p?.attributes ?? {}
  const px = Number(a.base_token_price_usd)
  if (!(px > 0) || !a.address) return null
  const dex = p.relationships?.dex?.data?.id ?? ''
  const fdv = Number(a.market_cap_usd ?? a.fdv_usd ?? 0)
  const tx = a.transactions?.h1 ?? {}
  return {
    key: `${chain}:${a.address}`,
    chain,
    pool: a.address,
    name: a.name ?? '',
    symbol: String(a.name ?? '').split(' / ')[0].trim() || a.address.slice(0, 6),
    dex,
    stage: stageOf(dex, fdv),
    createdAt: Date.parse(a.pool_created_at) || at,
    px,
    fdv,
    liq: Number(a.reserve_in_usd ?? 0),
    volH1: Number(a.volume_usd?.h1 ?? 0),
    m5: Number(a.price_change_percentage?.m5 ?? 0),
    h1: Number(a.price_change_percentage?.h1 ?? 0),
    buysH1: Number(tx.buys ?? 0),
    sellsH1: Number(tx.sells ?? 0),
    buyersH1: Number(tx.buyers ?? 0),
    sellersH1: Number(tx.sellers ?? 0),
  }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const file = () => join(hub.DATA_DIR, 'pulse.json')
let S = null
let held = new Set()

export function state() {
  if (S) return S
  try {
    S = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    S = { startedAt: now(), rows: {}, lastPollAt: 0, polls: 0, errors: {} }
  }
  return S
}

function save() {
  mkdirSync(hub.DATA_DIR, { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(S), { mode: 0o600 })
  renameSync(tmp, file())
}

/** Fold a fresh reading into the board, keeping what it looked like when first found. */
export function upsert(row, at = now()) {
  if (!row) return null
  const rows = state().rows
  const prev = rows[row.key]
  if (!prev) {
    rows[row.key] = {
      ...row,
      firstSeenAt: at,
      updatedAt: at,
      firstPx: row.px,
      maxPx: row.px,
      first: { stage: row.stage, liq: row.liq, fdv: row.fdv, buysH1: row.buysH1, sellsH1: row.sellsH1, buyersH1: row.buyersH1, h1: row.h1 },
      outcome: {},
    }
    return rows[row.key]
  }
  const next = { ...prev, ...row, firstSeenAt: prev.firstSeenAt, firstPx: prev.firstPx, first: prev.first, outcome: prev.outcome, maxPx: Math.max(prev.maxPx, row.px), updatedAt: at }
  // What it did after it was spotted: the record the trends are built from.
  for (const [mark, hours] of [['h1', 1], ['h6', 6], ['h24', 24]]) {
    if (next.outcome[mark] == null && at - next.firstSeenAt >= hours * HOUR) next.outcome[mark] = { change: pct(row.px, next.firstPx), peak: pct(next.maxPx, next.firstPx), liq: row.liq }
  }
  rows[row.key] = next
  return next
}

function prune(at = now()) {
  const rows = state().rows
  for (const [key, r] of Object.entries(rows)) if (!held.has(key) && at - r.firstSeenAt > KEEP) delete rows[key]
  const keys = Object.keys(rows)
  if (keys.length > MAX_ROWS) {
    keys.sort((a, b) => rows[a].firstSeenAt - rows[b].firstSeenAt)
    for (const key of keys.slice(0, keys.length - MAX_ROWS)) if (!held.has(key)) delete rows[key]
  }
}

/** The paper trader's open positions: always followed, never pruned. */
export function hold(keys) {
  held = new Set(keys)
}

export const rows = () => state().rows

// ---------------------------------------------------------------------------
// Polling (replaceable in tests)
// ---------------------------------------------------------------------------

async function gt(path, retried = false) {
  const res = await fetch(`${GT}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (res.status === 429 && !retried) {
    await sleep(feeds.retryAfter)
    return gt(path, true)
  }
  if (!res.ok) throw new Error(`GeckoTerminal answered ${res.status}`)
  return res.json()
}

export const feeds = {
  async newPools(chain) {
    const d = await gt(`/networks/${CHAINS[chain].gt}/new_pools?include=dex&page=1`)
    return (d.data ?? []).map((p) => parsePool(p, chain)).filter(Boolean)
  },
  async pools(chain, addresses) {
    const d = await gt(`/networks/${CHAINS[chain].gt}/pools/multi/${addresses.join(',')}?include=dex`)
    return (d.data ?? []).map((p) => parsePool(p, chain)).filter(Boolean)
  },
  gap: GAP,
  retryAfter: RETRY_AFTER,
}

let polling = false

export async function poll() {
  if (polling) return
  polling = true
  const s = state()
  try {
    for (const chain of Object.keys(CHAINS)) {
      try {
        for (const row of await feeds.newPools(chain)) upsert(row)
        delete s.errors[chain]
      } catch (e) {
        s.errors[chain] = String(e?.message ?? e)
      }
      await sleep(feeds.gap)
    }

    // Follow the ones worth following, held positions first.
    const at = now()
    const byChain = {}
    for (const r of Object.values(s.rows)) {
      const isHeld = held.has(r.key)
      const due = r.outcome.h24 == null && at - r.firstSeenAt < 25 * HOUR && r.liq >= FOLLOW_MIN_LIQ && !suspicious(r)
      if (isHeld || due) (byChain[r.chain] ??= []).push({ r, isHeld })
    }
    // A few chains a round, taking turns, so the round stays inside the rate
    // limit; a chain where the paper trader holds something is read every time.
    const all = Object.keys(CHAINS)
    const turn = all.map((_, i) => all[(i + s.polls * FOLLOW_CHAINS_PER_ROUND) % all.length]).slice(0, FOLLOW_CHAINS_PER_ROUND)
    const chains = Object.keys(byChain).filter((c) => turn.includes(c) || byChain[c].some((x) => x.isHeld))
    for (const chain of chains) {
      const list = byChain[chain]
      const pick = list.sort((a, b) => Number(b.isHeld) - Number(a.isHeld) || b.r.liq - a.r.liq).slice(0, FOLLOW_PER_CHAIN).map((x) => x.r.pool)
      try {
        for (const row of await feeds.pools(chain, pick)) upsert(row)
        delete s.errors[`${chain} follow-up`]
      } catch (e) {
        s.errors[`${chain} follow-up`] = String(e?.message ?? e)
      }
      await sleep(feeds.gap)
    }
    prune()
    s.polls++
    s.lastPollAt = now()
  } finally {
    save()
    polling = false
  }
}

export function start() {
  if (process.env.JARVIS_NO_PULSE === '1') return
  state()
  setTimeout(() => void poll(), 30000).unref()
  setInterval(() => void poll(), EVERY).unref()
}

// ---------------------------------------------------------------------------
// What it shows, and what it has learned
// ---------------------------------------------------------------------------

const ratio = (r) => (r.sellsH1 ? r.buysH1 / r.sellsH1 : r.buysH1 ? 9 : 0)
const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Rows read in the last ten minutes and under a day old: the live board. */
export function candidates(at = now()) {
  return Object.values(state().rows).filter((r) => at - r.updatedAt < 10 * 60000 && at - r.createdAt < 24 * HOUR && !suspicious(r))
}

/** How a group of followed launches did an hour (or six, or a day) after being spotted. */
function groupStats(list, mark) {
  const done = list.filter((r) => r.outcome[mark])
  if (!done.length) return null
  const ch = done.map((r) => r.outcome[mark].change)
  return {
    n: done.length,
    median: median(ch),
    up: (done.filter((r) => r.outcome[mark].change > 0).length / done.length) * 100,
    doubled: (done.filter((r) => r.outcome[mark].peak >= 100).length / done.length) * 100,
    dead: (done.filter((r) => r.outcome[mark].change <= -80).length / done.length) * 100,
  }
}

export function trends(mark = 'h1') {
  const all = Object.values(state().rows).filter((r) => !suspicious(r.first))
  const out = []
  const add = (label, list) => {
    const g = groupStats(list, mark)
    if (g && g.n >= 5) out.push(`- ${label}: ${g.n} followed, median ${signed(g.median)}, ${Math.round(g.up)}% up, ${Math.round(g.doubled)}% doubled at some point, ${Math.round(g.dead)}% died (−80% or worse)`)
  }
  for (const [stage, title] of Object.entries(STAGES)) add(title, all.filter((r) => r.first.stage === stage))
  for (const [chain, c] of Object.entries(CHAINS)) add(c.name, all.filter((r) => r.chain === chain))
  add('More buys than sells when found (1.5×+)', all.filter((r) => ratio(r.first) >= 1.5))
  add('More sells than buys when found', all.filter((r) => ratio(r.first) < 1))
  add('$20k+ liquidity when found', all.filter((r) => r.first.liq >= 20000))
  add('Under $10k liquidity when found', all.filter((r) => r.first.liq < 10000))
  add('100+ buyers in the hour when found', all.filter((r) => r.first.buyersH1 >= 100))
  return out
}

export function summary({ chain } = {}) {
  const s = state()
  const at = now()
  const live = candidates(at).filter((r) => !chain || r.chain === chain)
  const lastHour = Object.values(s.rows).filter((r) => at - r.firstSeenAt < HOUR && (!chain || r.chain === chain))
  const out = [
    `Pulse (rebuilt from GeckoTerminal; the real board is https://axiom.trade/pulse), ${chain ? CHAINS[chain]?.name ?? chain : `${Object.keys(CHAINS).length} chains`}. Last read ${s.lastPollAt ? `${Math.round((at - s.lastPollAt) / 60000)} min ago` : 'not yet'}.`,
    `Spotted in the last hour: ${lastHour.length} (${Object.keys(STAGES).map((st) => `${lastHour.filter((r) => r.stage === st).length} ${STAGES[st].toLowerCase()}`).join(', ')}).`,
  ]
  for (const [stage, title] of Object.entries(STAGES)) {
    const hot = live.filter((r) => r.stage === stage && r.liq >= FOLLOW_MIN_LIQ && r.buyersH1 >= 10).sort((a, b) => b.volH1 - a.volH1).slice(0, 5)
    if (!hot.length) continue
    out.push('', `${title} — most traded now:`)
    for (const r of hot) out.push(`- ${r.symbol} (${CHAINS[r.chain]?.name ?? r.chain}, ${r.dex}): mcap ${k(r.fdv)}, liquidity ${k(r.liq)}, 1h ${signed(r.h1)}, ${r.buyersH1} buyers / ${r.sellersH1} sellers, ${Math.round((at - r.createdAt) / 60000)} min old`)
  }
  const t = trends('h1')
  out.push('', t.length ? 'What launches did in the hour after being spotted:' : 'Nothing followed for an hour yet — the trends fill in as it watches.')
  out.push(...t)
  const t6 = trends('h6')
  if (t6.length) out.push('', 'Six hours after being spotted:', ...t6)
  const errs = Object.entries(s.errors)
  if (errs.length) out.push('', `Data problems: ${errs.map(([c, e]) => `${c}: ${e}`).join('; ')}`)
  return out.join('\n')
}

/** Tests only. */
export function _reset() {
  S = { startedAt: now(), rows: {}, lastPollAt: 0, polls: 0, errors: {} }
  held = new Set()
  polling = false
}
