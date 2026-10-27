/**
 * /api/admin/clients — JARVIS adds and updates paying clients. Bearer KIT_ADMIN_KEY only.
 *
 *   POST { name, plan, oneTimeCents, monthlyCents, contact, leadId }  → a new client with its token
 *   POST { id, origins?, notifyEmail?, thanks?, status? }              → update a published client
 *   GET  ?id=<id>                                                      → the record
 *
 * Price and plan can only be set while nothing is accepted yet, so a signed agreement never
 * changes underneath the client.
 */
import { randomBytes } from 'node:crypto'
import { getClient, putClient } from '../../lib/clients.mjs'
import { PLANS } from '../../lib/agreement.mjs'
import { adminOk, clean, json, readJson } from '../../lib/http.mjs'

const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i
const cents = (v) => (Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null)

export default async (req) => {
  if (!adminOk(req)) return json(401, { error: 'unauthorised' })
  if (req.method === 'GET') {
    const c = await getClient(new URL(req.url).searchParams.get('id'))
    return c ? json(200, c) : json(404, { error: 'no such client' })
  }
  if (req.method !== 'POST') return json(405, { error: 'GET or POST' })
  let b
  try {
    b = await readJson(req, 16_000)
  } catch (e) {
    return json(e.status ?? 400, { error: e.message })
  }
  if (b.id) {
    const c = await getClient(b.id)
    if (!c) return json(404, { error: 'no such client' })
    if (b.origins !== undefined) {
      if (!Array.isArray(b.origins) || !b.origins.every((o) => typeof o === 'string' && ORIGIN.test(o))) return json(400, { error: 'origins: https:// origins only' })
      c.origins = [...new Set(b.origins.map((o) => o.toLowerCase()))].slice(0, 6)
    }
    if (b.notifyEmail !== undefined) c.notifyEmail = clean(b.notifyEmail, 254).toLowerCase() || null
    if (b.thanks !== undefined) c.thanks = clean(b.thanks, 300)
    if (b.status !== undefined) c.status = clean(b.status, 40)
    if (!c.acceptance) {
      if (b.plan && PLANS[b.plan]) c.plan = b.plan
      if (cents(b.oneTimeCents) !== null) c.oneTimeCents = b.oneTimeCents
      if (cents(b.monthlyCents) !== null) c.monthlyCents = b.monthlyCents
    }
    c.updatedAt = new Date().toISOString()
    return json(200, await putClient(c))
  }
  const name = clean(b.name, 100)
  if (!name || !PLANS[b.plan] || cents(b.oneTimeCents) === null || cents(b.monthlyCents ?? 0) === null) return json(400, { error: 'name, plan (launch|premium), oneTimeCents and monthlyCents (integers) required' })
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36)}-${randomBytes(3).toString('hex')}`
  const c = {
    id,
    token: randomBytes(16).toString('hex'),
    name,
    plan: b.plan,
    oneTimeCents: b.oneTimeCents,
    monthlyCents: b.monthlyCents ?? 0,
    contact: { phone: clean(b.contact?.phone, 40) },
    leadId: clean(b.leadId, 120) || null,
    origins: [],
    status: 'agreement_sent',
    createdAt: new Date().toISOString(),
  }
  await putClient(c)
  return json(201, c)
}

export const config = { path: '/api/admin/clients' }
