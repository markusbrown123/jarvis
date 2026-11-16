/**
 * GET /api/site?site=<site> — what the widget needs to show itself: name,
 * greeting, suggestions, the booking link if there is one, contact details.
 */
import { allowedOrigin, corsHeaders, json } from '../../lib/http.mjs'
import { getSite, publicConfig } from '../../lib/sites.mjs'

export default async (req) => {
  const site = getSite(new URL(req.url).searchParams.get('site'))
  const { ok, origin } = allowedOrigin(req, site)
  const cors = ok ? corsHeaders(origin) : {}
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
  if (!site) return json(404, { error: 'unknown site' }, cors)
  if (!ok) return json(403, { error: 'not from this site' })
  return json(200, publicConfig(site), { ...cors, 'cache-control': 'public, max-age=300' })
}

export const config = { path: '/api/site' }
