/**
 * Publishing a built folder to Netlify, through its API (no CLI):
 *   1. create the site once (POST /sites) — or reuse `siteId`
 *   2. POST /sites/:id/deploys with every file's SHA-1; Netlify answers which it doesn't have
 *   3. PUT only those files; wait until the deploy is ready
 *
 * The token (NETLIFY_AUTH_TOKEN, a personal access token) never leaves this process.
 * Only callers acting on Markus's explicit "publish" use this.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API = 'https://api.netlify.com/api/v1'

function files(dir) {
  const out = {}
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f.startsWith('.') && f !== '.well-known') continue
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else out['/' + relative(dir, p).split(sep).join('/')] = p
    }
  }
  walk(dir)
  return out
}

export async function deploy({ token, dir, siteId = null, name = null, customDomain = null, fetchImpl = fetch, waitMs = 60000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token) throw new Error('no Netlify token (NETLIFY_AUTH_TOKEN)')
  const call = async (path, opts = {}) => {
    const res = await fetchImpl(API + path, { ...opts, headers: { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Netlify ${res.status} on ${path.split('?')[0]}: ${body?.message ?? 'request failed'}`)
    return body
  }
  let site
  if (siteId) site = await call(`/sites/${siteId}`)
  else site = await call('/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  if (customDomain && site.custom_domain !== customDomain)
    site = await call(`/sites/${site.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ custom_domain: customDomain }) })

  const all = files(dir)
  const digests = Object.fromEntries(Object.entries(all).map(([p, f]) => [p, createHash('sha1').update(readFileSync(f)).digest('hex')]))
  let d = await call(`/sites/${site.id}/deploys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: digests }) })
  const need = new Set(d.required ?? [])
  for (const [p, sha] of Object.entries(digests)) {
    if (!need.has(sha)) continue
    await call(`/deploys/${d.id}/files${p.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: readFileSync(all[p]) })
    need.delete(sha)
  }
  for (const until = Date.now() + waitMs; d.state !== 'ready' && Date.now() < until; ) {
    if (d.state === 'error') throw new Error(`Netlify deploy failed: ${d.error_message ?? 'unknown error'}`)
    await sleep(1500)
    d = await call(`/deploys/${d.id}`)
  }
  return { siteId: site.id, name: site.name, url: site.ssl_url || site.url, deployId: d.id, state: d.state, uploaded: Object.values(digests).length, customDomain: site.custom_domain ?? null }
}
