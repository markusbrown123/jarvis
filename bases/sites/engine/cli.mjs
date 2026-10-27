#!/usr/bin/env node
// The lead engine from a terminal. JARVIS runs the same steps on his own (bridge/hub/leadengine.mjs).
//
//   node cli.mjs discover --area "Trenton, NJ" --trades plumbing,roofing [--max-requests 30]
//   node cli.mjs check | score | shortlist | previews | batch | run [--discover]
//   node cli.mjs status
//   node cli.mjs sheet <lead-id> [--out sheet.html]
//   node cli.mjs outcome <lead-id> <interested|callback|not_interested|no_answer|voicemail|wrong_number|do_not_call> ["note"] [--callback 2026-11-02T09:30]
//   node cli.mjs dnc <phone>                   never call this number
//   node cli.mjs import-contacted <file.csv>   phone numbers Automaton already called (any column)
//
// Settings: <engine folder>/engine.config.json ({ areas, trades, maxRequests, shortlistSize, batchSize }),
// flags override. The Places key comes from GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY), never a file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, discover, open, previews, recordOutcome, rescore, run } from './engine.mjs'
import { nextBatch, openBatch, shortlist } from './lib/batch.mjs'
import { sheet } from './lib/brief.mjs'

const [cmd, ...rest] = process.argv.slice(2)
const flag = (n) => rest.includes(n)
const opt = (n, d) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : d)
const VALUED = new Set(['--area', '--trades', '--max-requests', '--limit', '--out', '--callback'])
const words = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]))

const store = open()
const cfgFile = join(store.dir, 'engine.config.json')
const cfg = { areas: [], trades: [], maxRequests: 30, shortlistSize: 25, batchSize: 3, ...(existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {}) }
if (opt('--area')) cfg.areas = opt('--area').split(';').map((s) => s.trim())
if (opt('--trades')) cfg.trades = opt('--trades').split(',').map((s) => s.trim())
if (opt('--max-requests')) cfg.maxRequests = Number(opt('--max-requests'))
cfg.key = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY

const show = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))
const line = (l) => `${String(l.score?.total ?? '–').padStart(3)}  ${l.stage.padEnd(13)} ${l.name}  ${l.phoneDisplay ?? ''}  ${l.city ?? ''} ${l.state ?? ''}  [${l.site?.status ?? 'unchecked'}]${l.score?.excluded ? `  (excluded: ${l.score.excluded})` : ''}  ${l.id}`

try {
  switch (cmd) {
    case 'discover':
      if (!cfg.areas.length || !cfg.trades.length) throw new Error('give --area "City, ST" and --trades a,b (or put them in engine.config.json)')
      show(await discover(store, cfg))
      break
    case 'check':
      show(await check(store, { limit: Number(opt('--limit', 40)) }))
      break
    case 'score':
      show(rescore(store, { area: cfg.areas.join(' ') }))
      break
    case 'shortlist':
      shortlist(store, { size: cfg.shortlistSize }).forEach((l) => console.log(line(l)))
      store.save()
      break
    case 'previews':
      show(previews(store))
      break
    case 'batch': {
      const b = openBatch(store) ?? nextBatch(store, { size: cfg.batchSize })
      store.save()
      if (!b) show('No batch open, and not enough previews ready for a new one (run `previews`).')
      else {
        console.log(`Batch ${b.n} (${b.status}):`)
        b.leadIds.forEach((id) => console.log(line(store.lead(id))))
      }
      break
    }
    case 'run':
      show(await run(store, { ...cfg, discoverToo: flag('--discover') }))
      break
    case 'status': {
      const all = Object.values(store.leads())
      const by = {}
      for (const l of all) by[l.stage] = (by[l.stage] ?? 0) + 1
      const spent = store.readLog().filter((e) => e.type === 'discover').reduce((a, e) => a + (e.usd ?? 0), 0)
      console.log(`${all.length} businesses: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}`)
      console.log(`Places spend logged: $${spent.toFixed(2)}`)
      const b = openBatch(store)
      if (b) {
        console.log(`Open batch ${b.n}:`)
        b.leadIds.forEach((id) => console.log(line(store.lead(id))))
      }
      break
    }
    case 'sheet': {
      const l = store.lead(words[0])
      if (!l) throw new Error(`no lead ${words[0]}`)
      const html = sheet(l, { batch: store.batches().find((b) => b.id === l.batchId), previewUrl: l.preview ? `file://${join(l.preview.dir, 'index.html')}` : null })
      const out = opt('--out', join(store.dir, `sheet-${l.id}.html`))
      writeFileSync(out, html, { mode: 0o600 })
      show(`wrote ${out}`)
      break
    }
    case 'outcome': {
      const [id, outcome, note = ''] = words
      const l = recordOutcome(store, id, outcome, { note, callbackAt: opt('--callback', null), dnc: store.dnc })
      store.save()
      show(`${l.name}: ${outcome}${l.outcome ? ` (final: ${l.outcome})` : ''}`)
      break
    }
    case 'dnc': {
      const d = String(words[0] ?? '').replace(/\D/g, '')
      if (d.length < 10) throw new Error('give a 10-digit phone number')
      store.dnc.add(d.length === 10 ? `+1${d}` : `+${d}`)
      store.save()
      show(`added to Do-Not-Call; ${store.dnc.size} numbers on the list`)
      break
    }
    case 'import-contacted': {
      const text = readFileSync(words[0], 'utf8')
      let n = 0
      for (const m of text.matchAll(/\+?1?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/g)) {
        const d = m[0].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
        if (d.length === 10) (store.contacted.add(`+1${d}`), n++)
      }
      store.save()
      show(`${n} numbers marked as already contacted; ${store.contacted.size} in all`)
      break
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
      process.exit(cmd ? 2 : 0)
  }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
