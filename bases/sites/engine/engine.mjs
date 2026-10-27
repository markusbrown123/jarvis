/**
 * The pipeline, step by step. Each step is safe to run again: it only does what isn't done.
 *
 *   discover   search Google Places for each trade in each area (capped requests, logged cost)
 *   check      fetch each new business's website and judge it
 *   rescore    score everyone (need + value + fit, with reasons)
 *   shortlist  keep the best 25 callable businesses on the shortlist
 *   previews   build a rough preview site for each shortlisted business
 *   batch      open the next batch of 2–3 when the last one is finished
 *
 * Nothing here contacts a business: no calls, texts or emails. Previews are written to the
 * engine's private folder under an unguessable name; publishing them is a separate,
 * approved step.
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { build } from '../sitegen/sitegen.mjs'
import { nextBatch, openBatch, recordOutcome, shortlist } from './lib/batch.mjs'
import { fromLead } from './lib/business.mjs'
import { budget as makeBudget, searchText, toLead } from './lib/places.mjs'
import { score, TRADES } from './lib/score.mjs'
import { checkSite } from './lib/sitecheck.mjs'
export { open } from './lib/store.mjs'
export { recordOutcome, openBatch }

const KEEP = ['stage', 'calls', 'outcome', 'batchId', 'site', 'score', 'preview', 'shortlistedAt', 'foundAt']

export async function discover(store, { key, areas, trades, maxRequests = 30, pages = 3, fetchImpl } = {}) {
  const budget = makeBudget({ maxRequests })
  let found = 0
  let added = 0
  const errors = []
  for (const area of areas)
    for (const trade of trades) {
      const t = TRADES[trade]
      if (!t) {
        errors.push(`unknown trade "${trade}" (one of ${Object.keys(TRADES).join(', ')})`)
        continue
      }
      const query = `${t.search} in ${area}`
      try {
        const places = await searchText({ key, query, pages, budget, fetchImpl })
        for (const p of places) {
          const lead = toLead(p, { trade, query, area })
          if (!lead.state || !lead.name) continue
          found++
          const old = store.lead(lead.id)
          if (!old) added++
          // Refresh what Google says; never overwrite our own work on a lead.
          store.putLead(old ? { ...lead, ...Object.fromEntries(KEEP.filter((k) => k in old).map((k) => [k, old[k]])) } : { ...lead, stage: 'found' })
        }
      } catch (e) {
        errors.push(`${query}: ${e.message}`)
        if (/request cap/.test(e.message)) break
      }
    }
  store.log({ type: 'discover', areas, trades, found, added, requests: budget.used, usd: budget.usd, errors })
  store.save()
  return { found, added, requests: budget.used, usd: budget.usd, errors }
}

export async function check(store, { limit = 40, concurrency = 4, fetchImpl, resolve } = {}) {
  const todo = Object.values(store.leads()).filter((l) => !l.site).slice(0, limit)
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const l = todo[i++]
      store.putLead({ id: l.id, site: await checkSite(l.website, { ...(fetchImpl ? { fetchImpl } : {}), ...(resolve ? { resolve } : {}) }) })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  store.save()
  return { checked: todo.length }
}

export function rescore(store, { area = '' } = {}) {
  let n = 0
  for (const l of Object.values(store.leads())) {
    if (['interested', 'callback', 'lost', 'dnc', 'won', 'closing'].includes(l.stage)) continue
    store.putLead({ id: l.id, score: score(l, { area: area || l.area || '', dnc: store.dnc, contacted: store.contacted }) })
    n++
  }
  store.save()
  return { scored: n }
}

export function previews(store, { limit = 25, now = new Date() } = {}) {
  const todo = Object.values(store.leads()).filter((l) => l.stage === 'shortlisted' && !l.preview).slice(0, limit)
  for (const l of todo) {
    const token = randomBytes(16).toString('hex')
    const outDir = join(store.dir, 'previews', token)
    build(fromLead(l), { mode: 'preview', outDir, now })
    store.putLead({ id: l.id, stage: 'preview_ready', preview: { token, dir: outDir, builtAt: now.toISOString() } })
  }
  store.save()
  return { built: todo.length }
}

/** Every step in order. `discoverToo` runs the (paid) Places search; the rest is free. */
export async function run(store, cfg = {}) {
  const out = {}
  if (cfg.discoverToo) out.discover = await discover(store, cfg)
  out.check = await check(store, { ...cfg, fetchImpl: cfg.siteFetch })
  out.rescore = rescore(store, { area: (cfg.areas ?? []).join(' ') })
  out.shortlist = shortlist(store, { size: cfg.shortlistSize ?? 25 }).length
  store.save()
  out.previews = previews(store, cfg)
  const spent = !Object.values(store.leads()).some((l) => ['found', 'shortlisted'].includes(l.stage) && l.score && !l.score.excluded)
  out.batch = nextBatch(store, { size: cfg.batchSize ?? 3, last: spent }) ?? openBatch(store)
  store.save()
  return out
}
