/**
 * What a business's current website tells us, from one fetch of its home page.
 *
 * status: none (no website listed), social (a Facebook/Instagram/Yelp page or a link page
 * instead of a site), broken (doesn't load), parked (a for-sale or expired-domain page),
 * weak (loads, but several things a customer would notice are wrong), ok.
 * `notes` are plain sentences for the call sheet; nothing here is shown to the business.
 *
 * Only public http(s) addresses are fetched: hostnames that resolve to private, loopback or
 * link-local addresses are refused at every redirect, so a listing can't point the engine
 * at Markus's own network.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|yelp\.com|nextdoor\.com|business\.site|tiktok\.com|x\.com|twitter\.com|linkedin\.com|angi\.com|homeadvisor\.com|thumbtack\.com|houzz\.com|bbb\.org)$/i
const PARKED = /(domain (is|may be) for sale|buy this domain|this domain (name )?has expired|parked (free|domain)|hugedomains|sedoparking|account (has been )?suspended|future home of|coming soon<\/title>|website (is )?(under construction|coming soon))/i
const BUILDERS = [
  ['Wix', /static\.wixstatic\.com|wix\.com website builder|x-wix/i],
  ['Squarespace', /squarespace/i],
  ['GoDaddy builder', /img1\.wsimg\.com|godaddy website builder/i],
  ['Weebly', /weebly/i],
  ['WordPress', /wp-content|wp-includes/i],
  ['Duda', /irp\.cdn-website\.com|dudaone/i],
  ['Google Sites', /sites\.google\.com/i],
]
const MAX_BYTES = 2_000_000

function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  const v = ip.toLowerCase()
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.')
}

async function publicUrl(u, resolve) {
  if (!/^https?:$/.test(u.protocol)) return false
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [host] : (await resolve(host)).map((r) => r.address)
  return ips.length > 0 && !ips.some(privateAddress)
}

/** Fetch a page, following up to 5 redirects, each one checked to be public. */
async function fetchPage(url, { fetchImpl, resolve, timeoutMs }) {
  let u = new URL(url)
  const t0 = Date.now()
  for (let hop = 0; hop < 6; hop++) {
    if (!(await publicUrl(u, resolve))) throw new Error('not a public address')
    const res = await fetchImpl(u.href, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; AutomatonSiteCheck/1.0)' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location'), u)
      continue
    }
    const reader = res.body?.getReader?.()
    let html = ''
    if (reader) {
      const dec = new TextDecoder()
      let n = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        n += value.length
        html += dec.decode(value, { stream: true })
        if (n > MAX_BYTES) {
          reader.cancel().catch(() => {})
          break
        }
      }
    } else html = (await res.text()).slice(0, MAX_BYTES)
    return { status: res.status, finalUrl: u.href, html, ms: Date.now() - t0 }
  }
  throw new Error('too many redirects')
}

export async function checkSite(website, { fetchImpl = fetch, resolve = (h) => lookup(h, { all: true }), timeoutMs = 12000, now = new Date() } = {}) {
  const checkedAt = now.toISOString()
  if (!website) return { checkedAt, status: 'none', notes: ['No website listed on their Google profile.'] }
  let url
  try {
    url = new URL(/^https?:\/\//i.test(website) ? website : `http://${website}`)
  } catch {
    return { checkedAt, status: 'broken', notes: [`Their listed website (${website}) isn't a valid address.`] }
  }
  if (SOCIAL.test(url.hostname)) return { checkedAt, status: 'social', url: url.href, notes: [`Their "website" is a ${url.hostname.replace(/^www\./, '')} page, not a site of their own.`] }

  let page
  try {
    page = await fetchPage(url.href, { fetchImpl, resolve, timeoutMs })
  } catch (e) {
    return { checkedAt, status: 'broken', url: url.href, notes: [`Their website (${url.hostname}) doesn't load (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`] }
  }
  const final = new URL(page.finalUrl)
  if (SOCIAL.test(final.hostname)) return { checkedAt, status: 'social', url: page.finalUrl, notes: [`Their website forwards to a ${final.hostname.replace(/^www\./, '')} page.`] }
  if (page.status >= 400) return { checkedAt, status: 'broken', url: page.finalUrl, notes: [`Their website (${final.hostname}) answers with an error (${page.status}).`] }

  const html = page.html
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  if (PARKED.test(html.slice(0, 50000)) && text.trim().split(/\s+/).length < 400)
    return { checkedAt, status: 'parked', url: page.finalUrl, notes: [`${final.hostname} shows a parked or "coming soon" page, not their business.`] }

  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]))
  const year = years.length ? Math.max(...years) : null
  const signals = {
    https: final.protocol === 'https:',
    mobile: /<meta[^>]+name=["']?viewport/i.test(html),
    year,
    tel: /href=["']?tel:/i.test(html),
    form: /<form[\s>]/i.test(html),
    title: (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim().slice(0, 120),
    builder: BUILDERS.find(([, re]) => re.test(html))?.[0] ?? null,
    ms: page.ms,
    kb: Math.round(Buffer.byteLength(html) / 1024),
  }
  const weak = []
  if (!signals.https) weak.push('It isn\'t secure (http://), so browsers warn visitors "Not secure".')
  if (!signals.mobile) weak.push("It has no mobile layout: on a phone it's the desktop page shrunk down.")
  if (year && year <= now.getFullYear() - 3) weak.push(`The footer still says ${year}, so it looks unmaintained.`)
  if (!signals.tel) weak.push('There\'s no tap-to-call link, so phone visitors have to copy the number.')
  if (page.ms > 4000) weak.push(`The home page took ${(page.ms / 1000).toFixed(1)} s to load.`)
  return { checkedAt, status: weak.length >= 2 ? 'weak' : 'ok', url: page.finalUrl, signals, notes: weak.length ? weak : ['Their current site looks reasonable; the pitch is the assistant, booking and follow-up, not a rescue.'] }
}
