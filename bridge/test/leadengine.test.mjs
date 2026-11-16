// node --test bridge/test/ — the lead engine inside JARVIS: Needs items, signed links, the outcome form.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-'))
process.env.JARVIS_NO_LEADS = '1'
const hub = await import('../hub/store.mjs')
const le = await import('../hub/leadengine.mjs')
const { open, run } = await import('../../bases/sites/engine/engine.mjs')

// Three businesses with no website, already found (as if Google had returned them).
const store = open(join(hub.DATA_DIR, 'leads'))
for (const i of [1, 2, 3, 4])
  store.putLead({
    id: `pl_T${i}`,
    name: `Test ${i} Roofing`,
    trade: 'roofing',
    phone: `+1609555010${i}`,
    phoneDisplay: `(609) 555-010${i}`,
    city: 'Trenton',
    state: 'NJ',
    reviews: 30,
    rating: 4.7,
    businessStatus: 'OPERATIONAL',
    stage: 'found',
    site: { status: 'none', notes: ['No website listed on their Google profile.'] },
  })
store.save()
await run(store, { shortlistSize: 25, batchSize: 3 })
await le.tick()

const srv = createServer(async (req, res) => {
  if (!(await le.serve(req, res, new URL(req.url, 'http://x').pathname))) (res.writeHead(418), res.end())
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
test.after(() => srv.close())

test('the open batch is on Needs, one item per business, with sheet, preview and call links', () => {
  const items = Object.values(hub.snapshot().items ?? {}).filter((i) => i.id.startsWith('leads:call:'))
  assert.equal(items.length, 3)
  const it = items[0]
  assert.equal(it.project, 'automaton')
  assert.deepEqual(it.actions.map((a) => a.label), ['Call sheet', 'Preview site', 'Call'])
  assert.match(it.actions[0].url, /^\/api\/leads\/[0-9a-f]{32}\/pl_T\d\/sheet$/)
})

test('signed links work; a wrong signature or a path outside the preview gets nothing', async () => {
  const id = 'pl_T1'
  const sheet = await fetch(base + le.sheetUrl(id))
  assert.equal(sheet.status, 200)
  assert.match(sheet.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal(sheet.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert.match(await sheet.text(), /This is Markus with Automaton/)
  assert.equal((await fetch(base + le.sheetUrl(id).replace(/[0-9a-f]{32}/, '0'.repeat(32)))).status, 404)
  assert.equal((await fetch(base + le.sheetUrl('pl_T2').replace('pl_T2', 'pl_T1'))).status, 404, "another lead's signature doesn't open this one")

  const prev = await fetch(base + le.previewUrl(id))
  assert.equal(prev.status, 200)
  const html = await prev.text()
  assert.match(html, /Preview made by Automaton for Test 1 Roofing/)
  assert.match(html, new RegExp(`href="${le.previewUrl(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}contact/"`), 'links stay inside the preview')
  // An encoded "../" survives URL parsing (a plain one is collapsed before it gets here).
  assert.equal((await fetch(base + le.previewUrl(id) + '%2e%2e%2f%2e%2e%2f%2e%2e%2fleads.json')).status, 404)
  assert.equal((await fetch(base + le.previewUrl(id) + '..%2F..%2Fdnc.json')).status, 404)
  assert.equal((await fetch(base + le.previewUrl(id) + '_headers')).status, 404)
})

test('the outcome form: interested → a P1 item to close; the batch item resolves; bad input refused', async () => {
  const id = 'pl_T1'
  const url = base + le.sheetUrl(id).replace(/sheet$/, 'outcome')
  const post = (form) => fetch(url, { method: 'POST', body: new URLSearchParams(form), redirect: 'manual' })
  assert.equal((await post({ outcome: 'maybe' })).status, 400)
  assert.equal((await post({ outcome: 'callback', callbackAt: '' })).status, 400)
  const r = await post({ outcome: 'interested', note: 'Text the link to this number' })
  assert.equal(r.status, 303)
  assert.match(r.headers.get('location'), /sheet\?saved=interested$/)
  assert.equal(hub.getItem('leads:call:pl_T1').state, 'resolved')
  const close = hub.getItem('leads:close:pl_T1')
  assert.equal(close.priority, 'P1')
  assert.match(close.why, /Text the link/)

  const cb = await post.call(null, { outcome: 'callback', callbackAt: '2099-01-05T09:30' })
  assert.equal(cb.status, 303)
  const item = hub.getItem('leads:callback:pl_T1')
  assert.equal(item.state, 'snoozed')
  assert.equal(new Date(item.snoozedUntil).toISOString(), '2099-01-05T14:30:00.000Z', '9:30 in New Jersey is 14:30 UTC in January')
  assert.equal(hub.getItem('leads:close:pl_T1').state, 'resolved', 'no longer "interested" once it became a callback')
})

test('callback times: read in the business\'s zone with that date\'s offset (DST-safe)', () => {
  assert.equal(le.zonedToUtc('2027-01-05T09:30', 'America/New_York').toISOString(), '2027-01-05T14:30:00.000Z')
  assert.equal(le.zonedToUtc('2027-07-05T09:30', 'America/New_York').toISOString(), '2027-07-05T13:30:00.000Z')
  assert.equal(le.zonedToUtc('2027-07-05T09:30', 'America/Los_Angeles').toISOString(), '2027-07-05T16:30:00.000Z')
})

test('by voice: findLead matches part of a name; summary names the open batch', () => {
  assert.equal(le.findLead('test 2 roof').id, 'pl_T2')
  assert.match(le.summary(), /Open batch 1: /)
})
