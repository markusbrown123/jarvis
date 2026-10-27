/**
 * POST /api/stripe — Stripe's webhook. Only a payment Stripe signed is believed.
 *
 * checkout.session.completed (paid) → the client's payment recorded once, and an event for
 * JARVIS. Everything else is acknowledged and ignored. STRIPE_WEBHOOK_SECRET is the endpoint's
 * signing secret (whsec_…); requests older than five minutes are refused.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getClient, putClient } from '../../lib/clients.mjs'
import { json } from '../../lib/http.mjs'
import { addEvent } from '../../lib/store.mjs'

const TOLERANCE_S = 300

export function verify(raw, header, secret, now = Date.now()) {
  if (!secret || !header) return false
  const t = Number(header.match(/(?:^|,)t=(\d+)/)?.[1])
  const sigs = [...header.matchAll(/(?:^|,)v1=([0-9a-f]{64})/g)].map((m) => m[1])
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > TOLERANCE_S) return false
  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'))
  return sigs.some((s) => timingSafeEqual(Buffer.from(s), want))
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const raw = await req.text()
  if (raw.length > 512_000) return json(413, { error: 'too large' })
  if (!verify(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) return json(400, { error: 'bad signature' })
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    return json(400, { error: 'not JSON' })
  }
  if (event.type !== 'checkout.session.completed') return json(200, { ok: true, ignored: event.type })
  const s = event.data?.object ?? {}
  const c = await getClient(s.metadata?.client ?? s.client_reference_id)
  if (!c) return json(200, { ok: true, ignored: 'unknown client' })
  if (c.payment?.sessionId === s.id) return json(200, { ok: true, duplicate: true })
  if (!['paid', 'no_payment_required'].includes(s.payment_status)) return json(200, { ok: true, ignored: s.payment_status })
  c.payment = { status: 'paid', sessionId: s.id, amountCents: s.amount_total ?? null, currency: s.currency ?? 'usd', subscription: s.subscription ?? null, at: new Date().toISOString() }
  await putClient(c)
  await addEvent('paid', c.id, c.id)
  return json(200, { ok: true })
}

export const config = { path: '/api/stripe' }
