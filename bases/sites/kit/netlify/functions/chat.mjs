/**
 * POST /api/chat — the site assistant.
 *
 * { site, messages: [{ role: "user" | "assistant", content }] } →
 * { reply, action: "none" | "booking" | "lead_form", booking? }
 *
 * Every visitor's message costs a model call, so: only the site's own pages
 * may call it, a visitor gets KIT_CHAT_PER_VISITOR replies a day (default 40)
 * and the site KIT_CHAT_PER_DAY (default 400). Past either, or with no
 * ANTHROPIC_API_KEY, it hands over to the contact form instead of going quiet.
 */
import Anthropic from '@anthropic-ai/sdk'
import { cleanMessages, reply } from '../../lib/bot.mjs'
import { allowedOrigin, callerId, corsHeaders, json, readJson } from '../../lib/http.mjs'
import { bookingFor, getSite } from '../../lib/sites.mjs'
import { store } from '../../lib/store.mjs'

const PER_VISITOR = Number(process.env.KIT_CHAT_PER_VISITOR) || 40
const PER_DAY = Number(process.env.KIT_CHAT_PER_DAY) || 400

/** Count one reply against today's limits; false once either is reached. */
async function spend(site, who) {
  const usage = store('usage')
  const day = new Date().toISOString().slice(0, 10)
  const keys = [`${day}/${site.id}`, `${day}/${site.id}/${who}`]
  const [all, mine] = await Promise.all(keys.map((k) => usage.get(k, { type: 'json' })))
  if ((all?.n ?? 0) >= PER_DAY || (mine?.n ?? 0) >= PER_VISITOR) return false
  await Promise.all([usage.setJSON(keys[0], { n: (all?.n ?? 0) + 1 }), usage.setJSON(keys[1], { n: (mine?.n ?? 0) + 1 })])
  return true
}

export default async (req, context) => {
  const url = new URL(req.url)
  let body = {}
  if (req.method === 'POST') {
    try {
      body = await readJson(req)
    } catch (err) {
      return json(err.status ?? 400, { error: err.message })
    }
  }
  const site = getSite(body.site ?? url.searchParams.get('site'))
  const { ok, origin } = allowedOrigin(req, site)
  const cors = ok ? corsHeaders(origin) : {}
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'POST only' }, cors)
  if (!site) return json(404, { error: 'unknown site' }, cors)
  if (!ok) return json(403, { error: 'not from this site' })

  const messages = cleanMessages(body.messages)
  if (!messages) return json(400, { error: 'messages: user/assistant text turns, ending with the visitor' }, cors)

  const booking = bookingFor(site)
  const handOver = (text) => json(200, { reply: text, action: 'lead_form', booking }, cors)
  if (!process.env.ANTHROPIC_API_KEY) return handOver(`The assistant isn't switched on yet — leave your details and the ${site.name} team will get back to you.`)
  if (!(await spend(site, callerId(context)))) return handOver("I've answered a lot today — leave your details and the team will pick it up from here.")

  try {
    const out = await reply(site, messages, { canBook: Boolean(booking) })
    return json(200, { ...out, booking }, cors)
  } catch (err) {
    console.error('[chat]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err)
    return handOver("I'm having trouble answering right now — leave your details and the team will get back to you.")
  }
}

export const config = { path: '/api/chat' }
