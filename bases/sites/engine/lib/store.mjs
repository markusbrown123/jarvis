/**
 * The engine's records, as JSON files in one private folder (never in git):
 *   leads.json    every business found, with its website check, score and stage
 *   batches.json  the call batches, 2–3 businesses each
 *   log.jsonl     what happened when (searches, costs, calls), one line each
 *
 * Writes go to a temp file and are renamed into place, so a crash never leaves
 * half a file; files are created readable by Markus's user only.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ENGINE_DIR = process.env.ENGINE_DIR ?? join(process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis'), 'leads')

export function open(dir = ENGINE_DIR) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = (n) => join(dir, n)
  const read = (n, fallback) => {
    try {
      return existsSync(file(n)) ? JSON.parse(readFileSync(file(n), 'utf8')) : fallback
    } catch {
      return fallback
    }
  }
  const write = (n, data) => {
    const tmp = file(`.${n}.${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, file(n))
  }
  let leads = read('leads.json', {})
  let batches = read('batches.json', [])
  // Numbers never to call (Do-Not-Call), and numbers Automaton already contacted elsewhere.
  const dnc = new Set(read('dnc.json', []))
  const contacted = new Set(read('contacted.json', []))
  return {
    dir,
    leads: () => leads,
    lead: (id) => leads[id] ?? null,
    putLead(lead) {
      leads[lead.id] = { ...(leads[lead.id] ?? {}), ...lead, updatedAt: new Date().toISOString() }
      return leads[lead.id]
    },
    batches: () => batches,
    putBatch(b) {
      const i = batches.findIndex((x) => x.id === b.id)
      if (i < 0) batches.push(b)
      else batches[i] = { ...batches[i], ...b }
      return b
    },
    dnc,
    contacted,
    save() {
      write('leads.json', leads)
      write('batches.json', batches)
      write('dnc.json', [...dnc])
      write('contacted.json', [...contacted])
    },
    reload() {
      leads = read('leads.json', {})
      batches = read('batches.json', [])
    },
    log(entry) {
      const f = file('log.jsonl')
      appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
      try {
        chmodSync(f, 0o600)
      } catch {}
    },
    readLog() {
      try {
        return readFileSync(file('log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      } catch {
        return []
      }
    },
  }
}
