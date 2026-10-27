/**
 * Requests and replies: JSON in and out, which pages may call (CORS), and a
 * private hash of the caller's address for the limits.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })

/**
 * The pages allowed to call: the site's own origins, this kit's own address
 * (Netlify sets URL and DEPLOY_PRIME_URL), and localhost while developing.
 */
export function allowedOrigin(req, site) {
  const origin = req.headers.get('origin')
  if (!origin) return { ok: true, origin: null } // a server or curl: no browser to protect
  const own = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean)
  const dev = process.env.CONTEXT === 'dev' || process.env.NETLIFY_DEV === 'true'
  const ok = [...(site?.origins ?? []), ...own].includes(origin) || (dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  return { ok, origin }
}

export function corsHeaders(origin) {
  return origin
    ? { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }
    : {}
}

/** The body as JSON, refusing anything over `limit` bytes. */
export async function readJson(req, limit = 32_000) {
  const text = await req.text()
  if (text.length > limit) throw Object.assign(new Error('too large'), { status: 413 })
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw Object.assign(new Error('not JSON'), { status: 400 })
  }
}

/** The caller, unreadably: enough to count requests, not to know who. */
export const callerId = (context) =>
  createHash('sha256')
    .update(`${process.env.KIT_SALT ?? 'automaton-kit'}:${context?.ip ?? 'unknown'}`)
    .digest('hex')
    .slice(0, 16)

export const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** JARVIS's calls (the feed, client admin): Authorization: Bearer <KIT_ADMIN_KEY>, compared in constant time. */
export function adminOk(req) {
  const key = process.env.KIT_ADMIN_KEY
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return Boolean(key) && key.length >= 24 && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key))
}
