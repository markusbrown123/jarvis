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
import { clientSite } from '../../lib/clients.mjs'

export const deps = { fetch: (...a) => fetch(...a) }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A published client's enquiry, straight to the client's own inbox (their notifyEmail, set when
 * Markus publishes the site), if RESEND_API_KEY and KIT_NOTIFY_FROM are configured. Everything
 * the visitor typed is escaped. A failure is logged, never shown to the visitor: the lead is
 * already stored and on JARVIS's feed.
 */
async function notifyClient(site, lead) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.KIT_NOTIFY_FROM
  if (!site.client || !site.notifyEmail || !key || !from) return
  const row = (k, v) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#555">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>` : '')
  try {
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [site.notifyEmail],
        ...(lead.email ? { reply_to: lead.email } : {}),
        subject: `New enquiry from your website: ${lead.name || lead.phone || lead.email}`.slice(0, 150),
        html: `<p>Someone sent this through ${esc(site.name)}'s website:</p><table>${row('Name', lead.name)}${row('Phone', lead.phone)}${row('Email', lead.email)}${row('Message', lead.message)}${row('Page', lead.page)}</table><p style="color:#777;font-size:13px">Call them back soon: most people contact more than one company.</p>`,
      }),
    })
    if (!res.ok) console.error('[lead] client email failed', res.status)
  } catch (e) {
    console.error('[lead] client email error', e.message)
  }
}

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
  const siteId = body.site ?? new URL(req.url).searchParams.get('site')
  const site = getSite(siteId) ?? (await clientSite(siteId))
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
  await notifyClient(site, lead)
  return json(200, { ok: true, message: site.thanks }, cors)
}

export const config = { path: '/api/lead' }
