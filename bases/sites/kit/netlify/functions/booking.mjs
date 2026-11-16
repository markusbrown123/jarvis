/**
 * POST /api/booking?site=<site> — Cal.com's webhook, when a call is booked,
 * moved or cancelled.
 *
 * Cal.com signs the raw body with the webhook's secret: X-Cal-Signature-256
 * is its HMAC-SHA256 (hex; a "sha256=" prefix is accepted too). Without
 * CAL_WEBHOOK_SECRET set nothing is accepted, so no one can post fake
 * bookings. Cal.com sends no timestamp, so a repeat of the same booking is
 * recognised by its uid and kept once.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { addEvent, store } from '../../lib/store.mjs'
import { clean, json } from '../../lib/http.mjs'
import { getSite } from '../../lib/sites.mjs'

const STATUS = { BOOKING_CREATED: 'booked', BOOKING_RESCHEDULED: 'rescheduled', BOOKING_CANCELLED: 'cancelled' }

export function signed(raw, header, secret) {
  const got = String(header ?? '')
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase()
  const want = createHmac('sha256', secret).update(raw).digest('hex')
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const secret = process.env.CAL_WEBHOOK_SECRET
  if (!secret) return json(503, { error: 'CAL_WEBHOOK_SECRET is not set' })
  const raw = await req.text()
  if (raw.length > 200_000) return json(413, { error: 'too large' })
  if (!signed(raw, req.headers.get('x-cal-signature-256'), secret)) return json(401, { error: 'bad signature' })

  let hook
  try {
    hook = JSON.parse(raw)
  } catch {
    return json(400, { error: 'not JSON' })
  }
  const status = STATUS[hook.triggerEvent]
  if (!status) return json(200, { ok: true, ignored: hook.triggerEvent ?? 'no triggerEvent' }) // a ping, or an event we don't track
  const p = hook.payload ?? {}
  const uid = clean(p.uid ?? p.bookingId?.toString(), 120)
  if (!uid) return json(400, { error: 'no booking uid' })

  const site = getSite(new URL(req.url).searchParams.get('site'))?.id ?? 'unknown'
  const attendee = p.attendees?.[0] ?? {}
  const answers = Object.fromEntries(
    Object.entries(p.responses ?? {})
      .filter(([k]) => !['name', 'email'].includes(k))
      .map(([k, v]) => [clean(v?.label ?? k, 80), clean(typeof v?.value === 'string' ? v.value : JSON.stringify(v?.value ?? v), 1000)]),
  )
  const bookings = store('bookings')
  const prev = await bookings.get(uid, { type: 'json' })
  const booking = {
    uid,
    site,
    status,
    title: clean(p.title ?? p.eventTitle, 200),
    start: clean(p.startTime, 40),
    end: clean(p.endTime, 40),
    name: clean(attendee.name, 100),
    email: clean(attendee.email, 254).toLowerCase(),
    timeZone: clean(attendee.timeZone, 60),
    answers,
    at: prev?.at ?? Date.now(),
    updatedAt: Date.now(),
  }
  // The same delivery twice changes nothing and tells JARVIS nothing new.
  if (prev && prev.status === status && prev.start === booking.start) return json(200, { ok: true, duplicate: true })
  await bookings.setJSON(uid, booking)
  await addEvent(status === 'booked' ? 'booking' : `booking_${status}`, site, uid)
  return json(200, { ok: true })
}

export const config = { path: '/api/booking' }
