/**
 * JARVIS reviewing his own paper trading, once a day, on his own.
 *
 * A background job reads the scoreboard, every strategy's recent trades with
 * why each was taken, and what Pulse launches did in the hours after they
 * appeared; it may search the web for what traders are seeing right now. It
 * then names at most two new strategies worth testing and any that should
 * stop. Those are applied here, on paper only, inside the same bounds as
 * everything else — so the tournament keeps learning while Markus sleeps, and
 * he gets the summary on his phone. Its LESSON lines go into memory, as every
 * job's do.
 *
 * Nothing here can place a real trade. Runs once a day around midnight (local)
 * and whenever he asks; JARVIS_NO_TRADE_REVIEW=1 turns the nightly run off.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import * as paper from './papertrade.mjs'
import * as pulse from './pulse.mjs'

const FILE = () => join(hub.DATA_DIR, 'tradereview.json')
const MAX_ADDS = 2
/** No market grows past this many live strategies; ideas wait for a slot. */
const MAX_PER_MARKET = 8
/** Only a strategy with this many trades has a record worth judging. */
const MIN_TRADES_TO_STOP = 15
/** Local hours the nightly run may start in (before the 3am self-review). */
const NIGHT = [0, 3]

const read = () => {
  try {
    return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : {}
  } catch {
    return {}
  }
}
const write = (v) => writeFileSync(FILE(), JSON.stringify(v, null, 2))

const SETTINGS = `How strategies are defined (pretend $40 each; every number is kept within bounds):
- market "meme" (Solana memecoins, DexScreener trending): kind "filter" with minLiq ($), minAgeH, minBuyRatio (1h buys/sells), minVolH1 ($), h1Min/h1Max (% change in the last hour), m5Min, h24Min; or kind "random" (the control).
- market "perp" (Hyperliquid, top 8 coins by volume, hourly candles): kind "trend" with fast, slow (EMA hours) and lev (1-5); kind "breakout" with lookback (hours) and lev; or "random".
- market "pulse" (new launches on sol, robinhood, ely, bnb, base, eth, hype, arc, ink): kind "filter" with stage ("new" | "stretch" | "migrated" | "any"), chains ("all" or e.g. "sol,base"), minLiq, minBuyRatio, minBuyers (unique buyers in the hour), minAgeMin, maxAgeMin; or "random".
- every kind: tp and sl (% move to take profit / stop out) and maxHoldH (hours).`

export function brief() {
  const s = paper.state()
  const details = Object.values(s.strategies)
    .filter((x) => x.active)
    .map((x) => paper.detail(x.id))
    .join('\n\n')
  const trends = ['h1', 'h6', 'h24'].map((m) => {
    const t = pulse.trends(m)
    return t.length ? `${m === 'h1' ? 'One hour' : m === 'h6' ? 'Six hours' : 'A day'} after being spotted:\n${t.join('\n')}` : ''
  }).filter(Boolean)

  return `You run JARVIS's paper-trading tournament for Markus. It is pretend money only: nothing you do can place a real trade, and you must not try to.

THE SCOREBOARD
${paper.summary()}

EACH LIVE STRATEGY (settings, open positions, last trades with why each was taken)
${details}

WHAT NEW LAUNCHES ON THE PULSE DID AFTER APPEARING
${trends.length ? trends.join('\n\n') : 'Not enough followed yet.'}

${SETTINGS}

Do this:
1. Judge what is working and what isn't, from the numbers above. Small samples mislead: under about 15 trades, say it's too early rather than conclude. A strategy that isn't beating its market's random control has found nothing yet, however good its total looks.
2. If you have a web search tool, spend a few searches on what is working or failing for traders in these markets right now (new launch patterns, chains getting attention, common rug patterns, Hyperliquid conditions). Use what you find only as ideas to test, never as proof.
3. End with a short plain summary for Markus, 3 to 5 sentences, no jargon: what's winning, what's losing, what you're changing and why, and whether anything is close to ready for real money (the bar is in the scoreboard).
4. Then, for at most ${MAX_ADDS} new strategies worth testing, one line each, exactly:
ADD: {"id": "short-name", "market": "meme|perp|pulse", "kind": "...", "params": {...}, "note": "the evidence it's based on, in one sentence"}
Base each on the evidence above (a variation of something beating random, or a pattern in the Pulse trends), not on a hunch. Leave out settings you'd keep at default.
5. Then, for any strategy that should stop, one line each: STOP: <id> :: <why>. Only one with ${MIN_TRADES_TO_STOP}+ trades doing clearly worse than its random control, or a near-duplicate of a better one. Never a random control.
6. LESSON: lines (as usual) only for something the numbers actually showed about these markets.`
}

/** Apply what the review decided: its ADD and STOP lines, within the limits. Returns what changed, in words. */
export function apply(output) {
  const changes = []
  const s = paper.state()
  for (const [, id, why] of String(output).matchAll(/^\s*STOP:\s*([\w-]+)\s*::\s*(.+)$/gm)) {
    const st = s.strategies[id]
    if (!st || !st.active) continue
    if (st.kind === 'random') {
      changes.push(`kept ${id}: the random control is never stopped`)
      continue
    }
    if (st.closed.length < MIN_TRADES_TO_STOP) {
      changes.push(`kept ${id}: only ${st.closed.length} trades, too few to judge`)
      continue
    }
    paper.retireStrategy(id, `daily review: ${why.trim().slice(0, 200)}`)
    changes.push(`stopped ${id}: ${why.trim()}`)
  }
  let added = 0
  for (const [, json] of String(output).matchAll(/^\s*ADD:\s*(\{.+\})\s*$/gm)) {
    if (added >= MAX_ADDS) break
    let spec
    try {
      spec = JSON.parse(json)
    } catch {
      changes.push('skipped an idea that was not valid JSON')
      continue
    }
    const live = Object.values(s.strategies).filter((x) => x.active && x.market === spec.market).length
    if (live >= MAX_PER_MARKET) {
      changes.push(`skipped ${spec.id ?? 'an idea'}: ${spec.market} already has ${live} strategies running`)
      continue
    }
    try {
      const params = Object.fromEntries(Object.entries(spec.params ?? {}).filter(([, v]) => typeof v === 'number' || typeof v === 'string'))
      const st = paper.addStrategy({ id: spec.id, market: spec.market, kind: spec.kind, params, note: String(spec.note ?? 'from the daily review').slice(0, 300) })
      added++
      changes.push(`started ${st.id}: ${st.note}`)
    } catch (e) {
      changes.push(`skipped ${spec.id ?? 'an idea'}: ${e.message}`)
    }
  }
  if (changes.length)
    hub.activity({ source: 'jarvis', project: 'finance', title: 'Paper trading: daily review', detail: changes.join('\n'), level: 'info' })
  return changes
}

/** Start a review now. Returns what happened, in words. */
export function run({ runner, notify = 'phone' }) {
  const s = paper.state()
  const trades = Object.values(s.strategies).reduce((a, x) => a + x.closed.length, 0)
  const followed = Object.values(pulse.rows()).filter((r) => r.outcome?.h1).length
  if (trades < 5 && followed < 20) return { started: false, why: `Too little to review yet: ${trades} paper trades closed and ${followed} launches followed for an hour.` }
  const { id } = runner.start({
    title: 'Paper trading: daily review',
    project: 'finance',
    instructions: brief(),
    notify,
    onDone: (output) => {
      try {
        apply(output)
      } catch (err) {
        console.warn('[hub] trading review not applied:', err.message)
      }
    },
  })
  write({ ...read(), lastAt: Date.now() })
  return { started: true, id }
}

/** The nightly run: once a day, around midnight, with nothing else running. */
export function start({ runner }) {
  if (process.env.JARVIS_NO_TRADE_REVIEW === '1' || process.env.JARVIS_NO_PAPER === '1') return
  const tick = () => {
    const h = new Date().getHours()
    if (h < NIGHT[0] || h >= NIGHT[1]) return
    if (Date.now() - (read().lastAt ?? 0) < 20 * 3600000) return
    if (Object.values(hub.snapshot().jobs).some((j) => j.state === 'running')) return
    try {
      const r = run({ runner })
      if (!r.started) write({ ...read(), lastAt: Date.now() })
    } catch (err) {
      console.warn('[hub] trading review not started:', err.message)
    }
  }
  setInterval(tick, 20 * 60000).unref()
}
