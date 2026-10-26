/**
 * Where the kit keeps what comes in: Netlify Blobs on Netlify (no database to
 * set up), an in-memory stand-in under test.
 *
 * Stores: leads (<site>/<key>), bookings (<booking uid>), events (<key>, what
 * JARVIS's feed reads), usage (per-day counters for the chat limits).
 */
import { getStore } from '@netlify/blobs'

export function store(name) {
  if (globalThis.__kitMemory) return memoryStore(globalThis.__kitMemory, name)
  return getStore({ name, consistency: 'strong' })
}

/** A sortable, unique key: the time first, so a listing comes back in order. */
export const timeKey = (at = Date.now()) => `${String(at).padStart(13, '0')}-${Math.random().toString(36).slice(2, 8)}`

/** Something new for JARVIS: the feed lists these in order. */
export async function addEvent(type, site, ref, at = Date.now()) {
  const key = timeKey(at)
  await store('events').setJSON(key, { key, type, site, ref, at })
  return key
}

function memoryStore(all, name) {
  const m = (all[name] ??= new Map())
  return {
    async setJSON(key, value) {
      m.set(key, JSON.stringify(value))
    },
    async get(key, opts) {
      const v = m.get(key)
      return v === undefined ? null : opts?.type === 'json' ? JSON.parse(v) : v
    },
    async list({ prefix = '' } = {}) {
      return {
        blobs: [...m.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort()
          .map((key) => ({ key })),
      }
    },
    async delete(key) {
      m.delete(key)
    },
  }
}
