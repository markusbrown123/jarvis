/**
 * POST /api/lead — a visitor's details, from the form or the chat.
 *
 * { site, name, email?, phone?, message?, page?, transcript?, website? } →
 * { ok, message }. An email or a phone is required (a name helps, but the
 * "call me on …" line asks only for a number). `website` is a field
 * people never see: a bot that fills it in is thanked and dropped.
 *
 * Kept in the leads store with an event for JARVIS, who drafts the reply
 * for Markus to approve. Nothing is sent from here.
 */
import { addEvent, store, timeKey } from '../../lib/store.mjs'
import { allowedOrigin, callerId, clean, corsHeaders, json, readJson } from '../../lib/http.mjs'
import { getSite } from '../../lib/sites.mjs'

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i

export default async (req, context) => {
  let body = {}
  if (req.method === 'POST') {
    try {
      body = await readJson(req, 48_000)
    } catch (err) {
      return json(err.status ?? 400, { error: err.message })
    }
  }
  const site = getSite(body.site ?? new URL(req.url).searchParams.get('site'))
  const { ok, origin } = allowedOrigin(req, site)
  const cors = ok ? corsHeaders(origin) : {}
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'POST only' }, cors)
  if (!site) return json(404, { error: 'unknown site' }, cors)
  if (!ok) return json(403, { error: 'not from this site' })

  if (clean(body.website, 200)) return json(200, { ok: true, message: site.thanks }, cors)

  const lead = {
    name: clean(body.name, 100),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40),
    message: clean(body.message, 2000),
    page: clean(body.page, 300),
  }
  const problems = []
  if (lead.email && !EMAIL.test(lead.email)) problems.push('email')
  if (lead.phone && (lead.phone.replace(/\D/g, '').length < 7 || /[^\d\s()+.\-x]/i.test(lead.phone))) problems.push('phone')
  if (!lead.email && !lead.phone) problems.push('email or phone')
  if (problems.length) return json(400, { error: `check: ${problems.join(', ')}` }, cors)

  const transcript = Array.isArray(body.transcript)
    ? body.transcript
        .slice(-24)
        .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : []

  const at = Date.now()
  const key = `${site.id}/${timeKey(at)}`
  await store('leads').setJSON(key, { key, site: site.id, ...lead, transcript, from: callerId(context), status: 'new', at })
  await addEvent('lead', site.id, key, at)
  return json(200, { ok: true, message: site.thanks }, cors)
}

export const config = { path: '/api/lead' }
