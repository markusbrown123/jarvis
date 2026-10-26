/**
 * GET /api/feed?since=<ms> — what's come in since then, for JARVIS.
 *
 * Authorization: Bearer <KIT_ADMIN_KEY>. Each event comes with its lead or
 * booking, oldest first, at most 100 at a time; `cursor` is what to send as
 * `since` next.
 */
import { timingSafeEqual } from 'node:crypto'
import { store } from '../../lib/store.mjs'
import { json } from '../../lib/http.mjs'

function authorised(req) {
  const key = process.env.KIT_ADMIN_KEY
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return Boolean(key) && key.length >= 24 && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key))
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'GET only' })
  if (!authorised(req)) return json(401, { error: 'unauthorised' })
  const since = Number(new URL(req.url).searchParams.get('since')) || 0
  const events = store('events')
  const { blobs } = await events.list()
  const after = blobs
    .map((b) => b.key)
    .filter((k) => Number(k.split('-')[0]) > since)
    .sort()
    .slice(0, 100)
  const out = []
  for (const key of after) {
    const e = await events.get(key, { type: 'json' })
    if (!e) continue
    const record = await store(e.type === 'lead' ? 'leads' : 'bookings').get(e.ref, { type: 'json' })
    out.push({ ...e, record })
  }
  return json(200, { events: out, cursor: out.length ? out.at(-1).at : since, more: after.length === 100 })
}

export const config = { path: '/api/feed' }
