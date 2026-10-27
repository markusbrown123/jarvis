// node --test test/*.test.mjs — no network: Places, websites and DNS are stubbed.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { check, discover, open, previews, rescore, run } from '../engine.mjs'
import { callWindow, nextBatch, openBatch, recordOutcome, shortlist } from '../lib/batch.mjs'
import { sheet } from '../lib/brief.mjs'
import { budget, searchText } from '../lib/places.mjs'
import { score } from '../lib/score.mjs'
import { checkSite } from '../lib/sitecheck.mjs'
import { build, check as liveCheck } from '../../sitegen/sitegen.mjs'

const fresh = () => open(mkdtempSync(join(tmpdir(), 'engine-')))

// ---- a fake Google Places
const place = (i, o = {}) => ({
  id: `P${i}`,
  displayName: { text: o.name ?? `Business ${i} Plumbing` },
  formattedAddress: `${i} Main St, Trenton, NJ 08608, USA`,
  addressComponents: [
    { longText: 'Trenton', shortText: 'Trenton', types: ['locality'] },
    { longText: 'New Jersey', shortText: 'NJ', types: ['administrative_area_level_1'] },
    { longText: '08608', shortText: '08608', types: ['postal_code'] },
  ],
  nationalPhoneNumber: o.phone === null ? undefined : `(609) 555-01${String(i).padStart(2, '0')}`,
  internationalPhoneNumber: o.phone === null ? undefined : `+1 609-555-01${String(i).padStart(2, '0')}`,
  websiteUri: o.website,
  rating: o.rating ?? 4.7,
  userRatingCount: o.reviews ?? 40,
  businessStatus: o.status ?? 'OPERATIONAL',
  googleMapsUri: `https://maps.google.com/?cid=${i}`,
  regularOpeningHours: { weekdayDescriptions: ['Monday: 7:00 AM – 6:00 PM'] },
})
const PLACES = [
  place(1),
  place(2, { website: 'https://facebook.com/biz2' }),
  place(3, { website: 'http://old-site.example' }),
  place(4, { website: 'https://good-site.example' }),
  place(5, { name: 'Roto-Rooter Plumbing & Water Cleanup' }),
  place(6, { status: 'CLOSED_PERMANENTLY' }),
  place(7, { phone: null }),
  place(8, { reviews: 0, rating: null }),
  place(9, { website: 'https://parked.example' }),
]
function placesApi(pages = [PLACES.slice(0, 5), PLACES.slice(5)]) {
  const seen = []
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body)
    seen.push({ url, headers: opts.headers, body })
    const i = body.pageToken ? Number(body.pageToken) : 0
    return { ok: true, status: 200, json: async () => ({ places: pages[i], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) }) }
  }
  return { fetchImpl, seen }
}

// ---- fake websites
const PAGES = {
  'http://old-site.example/': [200, '<html><head><title>Old</title></head><body>© 2015 Business 3. Call 609-555-0103</body></html>'],
  'https://good-site.example/': [200, '<html><head><meta name="viewport" content="width=device-width"><title>Good</title></head><body><a href="tel:+16095550104">Call</a> © 2026</body></html>'],
  'https://parked.example/': [200, '<html><title>parked.example</title><body>This domain is for sale! Buy this domain today.</body></html>'],
  'https://redirect.example/': [301, '', 'http://127.0.0.1/admin'],
}
const siteFetch = async (url) => {
  const [status, html, location] = PAGES[url] ?? [500, 'error']
  return { status, headers: { get: (h) => (h === 'location' ? location : null) }, text: async () => html, body: null }
}
const publicDns = async (host) => [{ address: host === '127.0.0.1' ? '127.0.0.1' : '93.184.216.34' }]
const privateDns = async () => [{ address: '10.0.0.5' }]

test('places: the request is a Text Search with a field mask; pages follow; the cap is enforced', async () => {
  const { fetchImpl, seen } = placesApi()
  const out = await searchText({ key: 'k', query: 'plumber in Trenton, NJ', budget: budget({ maxRequests: 5 }), fetchImpl })
  assert.equal(out.length, PLACES.length)
  assert.equal(seen[0].url, 'https://places.googleapis.com/v1/places:searchText')
  assert.equal(seen[0].headers['x-goog-api-key'], 'k')
  assert.match(seen[0].headers['x-goog-fieldmask'], /places\.websiteUri/)
  assert.equal(seen[1].body.pageToken, '1')
  await assert.rejects(searchText({ key: 'k', query: 'q', budget: budget({ maxRequests: 1 }), fetchImpl }), /request cap/)
  await assert.rejects(searchText({ key: '', query: 'q', budget: budget({ maxRequests: 1 }), fetchImpl }), /no Google Places key/)
})

test('sitecheck: none, social, weak, ok, parked, broken; private addresses refused at every hop', async () => {
  const o = { fetchImpl: siteFetch, resolve: publicDns, now: new Date('2026-10-27T12:00:00Z') }
  assert.equal((await checkSite(null, o)).status, 'none')
  assert.equal((await checkSite('https://facebook.com/biz2', o)).status, 'social')
  const weak = await checkSite('http://old-site.example', o)
  assert.equal(weak.status, 'weak')
  assert.ok(weak.notes.some((n) => /2015/.test(n)) && weak.notes.some((n) => /mobile/.test(n)))
  assert.equal((await checkSite('https://good-site.example', o)).status, 'ok')
  assert.equal((await checkSite('https://parked.example', o)).status, 'parked')
  assert.equal((await checkSite('https://down.example', o)).status, 'broken')
  const ssrf = await checkSite('https://good-site.example', { ...o, resolve: privateDns })
  assert.equal(ssrf.status, 'broken')
  assert.match(ssrf.notes[0], /not a public address/)
  assert.match((await checkSite('https://redirect.example', o)).notes[0], /not a public address/)
  assert.equal((await checkSite('file:///etc/passwd', o)).status, 'broken')
})

test('the whole pipeline: discover → check → score → shortlist → previews → a batch of 3', async () => {
  const store = fresh()
  const { fetchImpl } = placesApi()
  const d = await discover(store, { key: 'k', areas: ['Trenton, NJ'], trades: ['plumbing'], maxRequests: 5, fetchImpl })
  assert.equal(d.found, 9)
  assert.equal(d.requests, 2)
  await check(store, { fetchImpl: siteFetch, resolve: publicDns })
  rescore(store, { area: 'Trenton, NJ' })
  const L = (i) => store.lead(`pl_P${i}`)
  assert.equal(L(5).score.excluded, 'a chain or franchise')
  assert.equal(L(6).score.excluded, 'not operating')
  assert.equal(L(7).score.excluded, 'no phone number')
  assert.ok(L(1).score.total > L(3).score.total && L(3).score.total > L(4).score.total, 'no site > weak site > good site')
  assert.ok(L(1).score.reasons.some((r) => /No website/.test(r.text)))

  const list = shortlist(store, { size: 4 })
  assert.equal(list.length, 4)
  assert.ok(!list.some((l) => l.score.excluded))
  assert.equal(previews(store).built, 4)
  const p = L(1).preview
  assert.match(p.token, /^[0-9a-f]{32}$/)
  assert.ok(existsSync(join(p.dir, 'index.html')) && existsSync(join(p.dir, 'privacy/index.html')))

  const b = nextBatch(store, { size: 3 })
  assert.equal(b.leadIds.length, 3)
  assert.equal(nextBatch(store, { size: 3 }), null, 'one batch at a time')
  assert.equal(openBatch(store).id, b.id)
  store.save()
  assert.equal((statSync(join(store.dir, 'leads.json')).mode & 0o777).toString(8), '600')
})

test('outcomes: final ones close the batch; no answer ×3 gives up; do-not-call sticks; then the next batch opens', async () => {
  const store = fresh()
  const { fetchImpl } = placesApi()
  await run(store, { discoverToo: true, key: 'k', areas: ['Trenton, NJ'], trades: ['plumbing'], fetchImpl, siteFetch, resolve: publicDns, shortlistSize: 6, batchSize: 3 })
  const b = openBatch(store)
  assert.ok(b, 'a batch opened')
  const [a, c, e] = b.leadIds
  assert.throws(() => recordOutcome(store, a, 'callback'), /needs a time/)
  assert.throws(() => recordOutcome(store, a, 'maybe'), /unknown outcome/)
  recordOutcome(store, a, 'interested', { note: 'text the link to this number' })
  recordOutcome(store, c, 'do_not_call', { dnc: store.dnc })
  assert.ok(store.dnc.has(store.lead(c).phone))
  recordOutcome(store, e, 'no_answer')
  recordOutcome(store, e, 'voicemail')
  assert.equal(openBatch(store).id, b.id, 'still open: one lead has no final outcome')
  recordOutcome(store, e, 'no_answer')
  assert.equal(store.lead(e).outcome, 'unreached')
  assert.equal(openBatch(store), null, 'batch done')
  const next = nextBatch(store, { size: 3 })
  assert.ok(next && next.n === 2 && !next.leadIds.some((id) => b.leadIds.includes(id)))
  rescore(store)
  assert.equal(store.lead(c).stage, 'dnc')
})

test('call windows: business hours in their own time zone, never Sunday', () => {
  const nj = { state: 'NJ' }
  assert.equal(callWindow(nj, new Date('2026-10-26T14:00:00Z')).open, true) // Mon 10:00 New York
  assert.equal(callWindow(nj, new Date('2026-10-26T11:00:00Z')).open, false) // Mon 07:00
  const sun = callWindow(nj, new Date('2026-10-25T16:00:00Z')) // Sun noon
  assert.equal(sun.open, false)
  assert.match(sun.next, /^Mon/)
  assert.equal(callWindow({ state: 'CA' }, new Date('2026-10-26T14:00:00Z')).open, false) // 7:00 in LA
  assert.equal(callWindow({ state: 'NJ' }, new Date('2026-10-31T19:00:00Z')).open, false) // Sat 15:00
})

test('the call sheet: honest script, tel link, outcome form; business data escaped', () => {
  const lead = {
    id: 'pl_x',
    name: 'Joe’s <script>alert(1)</script> Plumbing',
    trade: 'plumbing',
    phone: '+16095550101',
    phoneDisplay: '(609) 555-0101',
    city: 'Trenton',
    state: 'NJ',
    site: { status: 'none', notes: ['No website listed on their Google profile.'] },
    score: { total: 80, reasons: [{ pts: 50, text: 'No website at all.' }] },
  }
  const html = sheet(lead, { previewUrl: 'https://x/p', outcomeUrl: '/api/leads/sig/pl_x/outcome', now: new Date('2026-10-26T14:00:00Z') })
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /href="tel:\+16095550101"/)
  assert.match(html, /This is Markus with Automaton/)
  assert.match(html, /name="outcome" value="do_not_call"/)
  assert.match(html, /Good time to call/)
  assert.doesNotMatch(html, /<script/i, 'no scripts on the sheet')
})

test('sitegen: preview is marked, unindexed and form-less; live refuses without the facts; everything escaped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'))
  const b = { name: 'Ace </script><script>x()</script> Roofing', trade: 'roofing', type: 'RoofingContractor', telephone: '+16095550101', areaServed: ['Trenton'], address: { addressLocality: 'Trenton', addressRegion: 'NJ' }, google: { rating: 4.8, reviews: 52, url: 'https://maps.google.com/?cid=1' } }
  const out = build(b, { mode: 'preview', outDir: join(dir, 'p') })
  assert.ok(out.pages.length >= 8)
  const home = readFileSync(join(dir, 'p', 'index.html'), 'utf8')
  assert.match(home, /noindex/)
  assert.match(home, /Preview made by Automaton/)
  assert.doesNotMatch(home, /<script>x\(\)/)
  assert.doesNotMatch(home.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1], /<\/script/)
  assert.match(readFileSync(join(dir, 'p', 'robots.txt'), 'utf8'), /Disallow: \//)
  assert.match(readFileSync(join(dir, 'p', '_headers'), 'utf8'), /X-Robots-Tag: noindex/)
  assert.match(readFileSync(join(dir, 'p', 'contact/index.html'), 'utf8'), /switched off in the preview/)
  assert.throws(() => build(b, { mode: 'live', outDir: join(dir, 'l') }), /still needed: .*live https/)
  assert.ok(liveCheck(b).includes('a few lines about the business, in the owner\'s words'))

  const live = { ...b, name: 'Ace Roofing', url: 'https://aceroofing.example', about: 'Family run since 1998.', email: 'office@aceroofing.example', services: [{ name: 'Roof repair', description: 'Leaks fixed.' }] }
  build(live, { mode: 'live', outDir: join(dir, 'l'), kit: { url: 'https://kit.example', site: 'aceroofing' } })
  const lh = readFileSync(join(dir, 'l', 'index.html'), 'utf8')
  assert.doesNotMatch(lh, /Preview|noindex|class="gap"/)
  assert.match(lh, /rel="canonical" href="https:\/\/aceroofing\.example\/"/)
  const hdr = readFileSync(join(dir, 'l', '_headers'), 'utf8')
  assert.match(hdr, /connect-src 'self' https:\/\/kit\.example/)
  assert.match(hdr, /frame-ancestors 'none'/)
  assert.doesNotMatch(hdr, /unsafe-inline/)
  assert.match(readFileSync(join(dir, 'l', 'contact/index.html'), 'utf8'), /data-kit="https:\/\/kit\.example" data-site="aceroofing"/)
  assert.match(readFileSync(join(dir, 'l', 'sitemap.xml'), 'utf8'), /aceroofing\.example\/privacy\//)
  for (const p of ['privacy', 'terms', 'accessibility']) assert.ok(existsSync(join(dir, 'l', p, 'index.html')))
})

test('score: Do-Not-Call and already-contacted numbers are never shortlisted', () => {
  const lead = { name: 'X', phone: '+16095550101', site: { status: 'none' }, trade: 'plumbing', reviews: 20, rating: 4.5 }
  assert.equal(score(lead, { dnc: new Set(['+16095550101']) }).excluded, 'on the Do-Not-Call list')
  assert.equal(score(lead, { contacted: new Set(['+16095550101']) }).excluded, 'already contacted by Automaton')
  assert.equal(score(lead).excluded, null)
})
