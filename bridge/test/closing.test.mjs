// node --test bridge/test/*.test.mjs — closing a business end to end, JARVIS + the site kit in-process.
// The kit runs on its in-memory store; Stripe, Netlify and email are stubbed. Nothing leaves the machine.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-close-'))
process.env.JARVIS_NO_LEADS = '1'
Object.assign(process.env, { KIT_URL: 'https://kit.example', KIT_ADMIN_KEY: 'k'.repeat(32), URL: 'https://kit.example', NETLIFY_AUTH_TOKEN: 'nfp_test', STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_t', RESEND_API_KEY: 're_t', KIT_NOTIFY_FROM: 'Automaton <leads@automaton.example>' })
globalThis.__kitMemory = {}

const hub = await import('../hub/store.mjs')
const le = await import('../hub/leadengine.mjs')
const closing = await import('../hub/closing.mjs')
const { open, run, recordOutcome } = await import('../../bases/sites/engine/engine.mjs')
const kitAdmin = (await import('../../bases/sites/kit/netlify/functions/admin.mjs')).default
const kitClose = await import('../../bases/sites/kit/netlify/functions/close.mjs')
const kitStripe = (await import('../../bases/sites/kit/netlify/functions/stripe.mjs')).default
const kitFeed = (await import('../../bases/sites/kit/netlify/functions/feed.mjs')).default
const kitLead = await import('../../bases/sites/kit/netlify/functions/lead.mjs')

// JARVIS → kit admin goes straight into the kit's handler; Stripe and email are recorded.
const outside = []
closing.deps.fetch = async (url, opts) => kitAdmin(new Request(url, opts))
kitClose.deps.fetch = async (url, opts) => (outside.push({ url, opts }), new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' })))
kitLead.deps.fetch = async (url, opts) => (outside.push({ url, opts }), new Response('{}'))
const deploys = []
closing.deps.deploy = async (o) => (deploys.push(o), { siteId: `site-${deploys.length}`, name: o.name, url: `https://${o.name}.netlify.app`, deployId: 'd1', state: 'ready' })

// One interested roofer, with a preview.
const store = le.engineStore()
store.putLead({ id: 'pl_G', name: 'Garcia Roofing', trade: 'roofing', phone: '+16095550142', phoneDisplay: '(609) 555-0142', city: 'Hamilton', state: 'NJ', zip: '08619', reviews: 40, rating: 4.8, businessStatus: 'OPERATIONAL', stage: 'found', site: { status: 'none', notes: ['No website.'] } })
store.putLead({ id: 'pl_H', name: 'Other Roofing', trade: 'roofing', phone: '+16095550143', city: 'Hamilton', state: 'NJ', reviews: 10, businessStatus: 'OPERATIONAL', stage: 'found', site: { status: 'none', notes: [] } })
store.save()
await run(store, {})
recordOutcome(store, 'pl_G', 'interested', { note: 'text the link to this number' })
store.save()
await le.tick()

const srv = createServer(async (req, res) => {
  if (!(await closing.serve(req, res, new URL(req.url, 'http://x').pathname))) (res.writeHead(418), res.end())
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
test.after(() => srv.close())
const act = (data) => fetch(base + closing.closeUrl('pl_G'), { method: 'POST', body: new URLSearchParams(data) })
const kitReq = (path, init = {}) => new Request(`https://kit.example${path}`, { redirect: 'manual', ...init })

test('interested → the close page, behind its own signature', async () => {
  assert.equal(hub.getItem('leads:close:pl_G').actions[0].label, 'Close page')
  const page = await fetch(base + closing.closeUrl('pl_G'))
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Publish the preview link/)
  assert.equal((await fetch(base + closing.closeUrl('pl_G').replace(/[0-9a-f]{32}/, 'f'.repeat(32)))).status, 404)
})

test('share: the preview is deployed as its own site only when Markus presses the button', async () => {
  assert.equal(deploys.length, 0)
  const r = await act({ action: 'share' })
  assert.match(await r.text(), /Done\./)
  assert.equal(deploys.length, 1)
  assert.equal(deploys[0].dir, le.engineStore().lead('pl_G').preview.dir)
  assert.match(le.engineStore().lead('pl_G').shared.url, /^https:\/\/preview-garcia-roofing-[0-9a-f]{6}\.netlify\.app$/)
})

test('agreement → accepted → paid → intake → the live site is built from their words', async () => {
  await act({ action: 'agreement', plan: 'launch', oneTime: '299', monthly: '0' })
  const l = le.engineStore().lead('pl_G')
  assert.match(l.client.agreementUrl, /^https:\/\/kit\.example\/c\/[0-9a-f]{32}$/)
  assert.equal(hub.getItem('leads:agreement:pl_G').actions[0].value, l.client.agreementUrl)
  const token = l.client.token

  // The owner: agrees, pays (Stripe signs the webhook), fills in the form.
  const agreed = await kitClose.default(kitReq(`/c/${token}/agree`, { method: 'POST', body: new URLSearchParams({ name: 'Luis Garcia', email: 'luis@garcia.example', agree: 'yes' }) }))
  assert.equal(agreed.status, 303)
  const t = Math.floor(Date.now() / 1000)
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { client: l.client.id }, payment_status: 'paid', amount_total: 29900 } } })
  assert.equal((await kitStripe(kitReq('/api/stripe', { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${createHmac('sha256', 'whsec_t').update(`${t}.${raw}`).digest('hex')}` } }))).status, 200)
  const intake = await kitClose.default(
    kitReq(`/c/${token}/start`, {
      method: 'POST',
      body: new URLSearchParams({ business: 'Garcia Roofing', phone: '(609) 555-0142', email: 'office@garcia.example', about: 'Luis and his brother, roofing Hamilton since 2004.', services: 'Roof repair: leaks and storm damage\nRoof replacement - full tear-off', areas: 'Hamilton, Trenton, Ewing', license: 'NJ HIC #13VH0000', insured: 'yes', domain: 'garciaroofing.example', confirm: 'yes' }),
    }),
  )
  assert.equal(intake.status, 200)

  // JARVIS reads the kit's feed and acts on each event.
  const feed = await (await kitFeed(kitReq('/api/feed?since=0', { headers: { authorization: `Bearer ${'k'.repeat(32)}` } }))).json()
  assert.deepEqual(feed.events.map((e) => e.type), ['agreed', 'paid', 'intake'])
  for (const e of feed.events) await closing.onEvent(e)

  const after = le.engineStore().lead('pl_G')
  assert.equal(after.stage, 'site_ready')
  assert.equal(hub.getItem('leads:agreement:pl_G').state, 'resolved', 'paid: the agreement item is done')
  assert.equal(hub.getItem('leads:review:pl_G').priority, 'P1')
  const home = readFileSync(join(after.live.dir, 'index.html'), 'utf8')
  assert.match(home, /rel="canonical" href="https:\/\/garciaroofing\.example\/"/)
  assert.match(readFileSync(join(after.live.dir, 'about/index.html'), 'utf8'), /roofing Hamilton since 2004/)
  assert.match(readFileSync(join(after.live.dir, 'services/index.html'), 'utf8'), /Roof replacement[\s\S]*full tear-off/)
  assert.match(readFileSync(join(after.live.dir, 'contact/index.html'), 'utf8'), new RegExp(`data-kit="https://kit.example" data-site="${after.client.id}"`))
  assert.match(readFileSync(join(after.live.dir, 'privacy/index.html'), 'utf8'), /office@garcia\.example/)
  assert.doesNotMatch(home, /office@garcia\.example/, 'their enquiry email stays off the public pages except privacy')
  assert.ok(existsSync(join(after.live.dir, '_headers')))

  assert.equal((await fetch(base + closing.closeUrl('pl_G') + '/site/%E0%A4%A')).status, 404, 'a malformed path is a 404, not a crash')
  assert.equal((await fetch(base + closing.closeUrl('pl_G') + '/site/..%2F..%2F..%2Fleads.json')).status, 404)
  const review = await fetch(base + closing.closeUrl('pl_G') + '/site/')
  assert.equal(review.status, 200)
  assert.match(await review.text(), new RegExp(`href="${closing.closeUrl('pl_G')}/site/services/"`))
})

test('publish: deployed with their domain; the kit takes forms from it and sends enquiries to the owner', async () => {
  const r = await act({ action: 'publish' })
  assert.match(await r.text(), /Done\./)
  const d = deploys.at(-1)
  assert.equal(d.customDomain, 'garciaroofing.example')
  const l = le.engineStore().lead('pl_G')
  assert.equal(l.stage, 'won')
  const live = hub.getItem('leads:live:pl_G')
  assert.match(live.instructions, /A record for garciaroofing\.example → 75\.2\.60\.5/)
  assert.equal(hub.getItem('leads:review:pl_G').state, 'resolved')

  outside.length = 0
  const res = await kitLead.default(
    kitReq('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://garciaroofing.example' }, body: JSON.stringify({ site: l.client.id, name: 'Pat', phone: '609 555 0177', message: 'Leak over the kitchen' }) }),
    { ip: '203.0.113.5' },
  )
  assert.equal(res.status, 200)
  const mail = outside.find((o) => String(o.url).includes('resend.com'))
  assert.deepEqual(JSON.parse(mail.opts.body).to, ['office@garcia.example'])
})
