/**
 * GET /api/feed?since=<ms> — what's come in since then, for JARVIS.
 *
 * Authorization: Bearer <KIT_ADMIN_KEY>. Each event comes with its lead or
 * booking, oldest first, at most 100 at a time; `cursor` is what to send as
 * `since` next.
 */
import { store } from '../../lib/store.mjs'
import { adminOk as authorised, json } from '../../lib/http.mjs'

// Which store an event's record lives in: a lead, a booking, or a client (agreed, paid, intake).
const recordOf = (e) =>
  e.type === 'lead' ? store('leads').get(e.ref, { type: 'json' }) : e.type.startsWith('booking') ? store('bookings').get(e.ref, { type: 'json' }) : store('clients').get(`c/${e.ref}`, { type: 'json' })

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
    const record = await recordOf(e)
    out.push({ ...e, record })
  }
  return json(200, { events: out, cursor: out.length ? out.at(-1).at : since, more: after.length === 100 })
}

export const config = { path: '/api/feed' }
