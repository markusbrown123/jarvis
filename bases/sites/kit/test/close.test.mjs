// Closing a client end to end: admin → agreement → Stripe → webhook → intake → feed → their site's leads.
// npm test — in-memory store; Stripe and Resend are stubbed.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import admin from '../netlify/functions/admin.mjs'
import close, { deps as closeDeps } from '../netlify/functions/close.mjs'
import stripe from '../netlify/functions/stripe.mjs'
import feed from '../netlify/functions/feed.mjs'
import lead, { deps as leadDeps } from '../netlify/functions/lead.mjs'

const ADMIN = 'k'.repeat(32)
const WHSEC = 'whsec_test'
let sent
beforeEach(() => {
  globalThis.__kitMemory = {}
  sent = []
  Object.assign(process.env, { KIT_ADMIN_KEY: ADMIN, URL: 'https://kit.example', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC, RESEND_API_KEY: 're_x', KIT_NOTIFY_FROM: 'Automaton <leads@automaton.example>' })
  const stub = async (url, opts) => {
    sent.push({ url, opts })
    if (String(url).includes('stripe.com')) return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  closeDeps.fetch = stub
  leadDeps.fetch = stub
})

const req = (path, { method = 'GET', body, headers = {} } = {}) => new Request(`https://kit.example${path}`, { method, headers, body, redirect: 'manual' })
const asAdmin = (body) => admin(req('/api/admin/clients', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const form = (path, data) => close(req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() }))
const newClient = async (o = {}) => (await asAdmin({ name: 'Garcia <b>Brothers</b> Plumbing', plan: 'launch', oneTimeCents: 29900, monthlyCents: 0, contact: { phone: '(609) 555-0142' }, ...o })).json()
const signed = (payload, t = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify(payload)
  return req('/api/stripe', { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${t},v1=${createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex')}` } })
}
const paidEvent = (c, id = 'cs_test_1') => ({ type: 'checkout.session.completed', data: { object: { id, metadata: { client: c.id }, client_reference_id: c.id, payment_status: 'paid', amount_total: 29900, currency: 'usd' } } })

test('admin: key required; a new client gets an id and a 32-hex token; origins must be https', async () => {
  assert.equal((await admin(req('/api/admin/clients', { method: 'POST', body: '{}' }))).status, 401)
  const c = await newClient()
  assert.match(c.token, /^[0-9a-f]{32}$/)
  assert.match(c.id, /^garcia-b-brothers-b-plumbing-[0-9a-f]{6}$/)
  assert.equal((await asAdmin({ id: c.id, origins: ['http://insecure.example'] })).status, 400)
  assert.deepEqual((await (await asAdmin({ id: c.id, origins: ['https://Garcia.example'] })).json()).origins, ['https://garcia.example'])
})

test('agreement: the page escapes the client name; a bad token is a 404; incomplete forms are refused', async () => {
  const c = await newClient()
  const page = await close(req(`/c/${c.token}`))
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.doesNotMatch(html, /<b>Brothers<\/b>/)
  assert.match(html, /\$299 one time/)
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal((await close(req(`/c/${'0'.repeat(32)}`))).status, 404)
  const bad = await form(`/c/${c.token}/agree`, { name: 'Jo', email: 'nope' })
  assert.match(await bad.text(), /Please type your full name/)
})

test('accept → Stripe Checkout for the agreed price; acceptance kept with the text version; intake waits for payment', async () => {
  const c = await newClient()
  const r = await form(`/c/${c.token}/agree`, { name: 'Luis Garcia', email: 'luis@garcia.example', agree: 'yes' })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_1')
  const s = new URLSearchParams(sent[0].opts.body)
  assert.equal(s.get('mode'), 'payment')
  assert.equal(s.get('line_items[0][price_data][unit_amount]'), '29900')
  assert.equal(s.get('client_reference_id'), c.id)
  assert.equal(s.get('customer_email'), 'luis@garcia.example')
  assert.match(s.get('success_url'), new RegExp(`/c/${c.token}/start\\?paid=1$`))
  const rec = await (await admin(req(`/api/admin/clients?id=${c.id}`, { headers: { authorization: `Bearer ${ADMIN}` } }))).json()
  assert.match(rec.acceptance.version, /^[0-9a-f]{64}$/)
  assert.equal(rec.acceptance.name, 'Luis Garcia')
  assert.equal((await close(req(`/c/${c.token}/start`))).status, 303, 'no intake before payment')
  // price can't change after acceptance
  await asAdmin({ id: c.id, oneTimeCents: 1 })
  assert.equal((await (await admin(req(`/api/admin/clients?id=${c.id}`, { headers: { authorization: `Bearer ${ADMIN}` } }))).json()).oneTimeCents, 29900)
})

test('stripe webhook: forged or stale signatures refused; a real payment recorded once', async () => {
  const c = await newClient()
  const raw = JSON.stringify(paidEvent(c))
  assert.equal((await stripe(req('/api/stripe', { method: 'POST', body: raw, headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` } }))).status, 400)
  assert.equal((await stripe(signed(paidEvent(c), Math.floor(Date.now() / 1000) - 3600))).status, 400)
  assert.equal((await stripe(signed(paidEvent(c)))).status, 200)
  assert.equal((await (await stripe(signed(paidEvent(c)))).json()).duplicate, true)
  const ev = await (await feed(req('/api/feed?since=0', { headers: { authorization: `Bearer ${ADMIN}` } }))).json()
  assert.deepEqual(ev.events.map((e) => e.type), ['paid'])
  assert.equal(ev.events[0].record.payment.amountCents, 29900)
})

test('intake after payment: required fields enforced, then stored with an event for JARVIS', async () => {
  const c = await newClient()
  await stripe(signed(paidEvent(c)))
  assert.equal((await close(req(`/c/${c.token}/start`))).status, 200)
  const bad = await form(`/c/${c.token}/start`, { business: 'Garcia', phone: '123' })
  assert.match(await bad.text(), /Please fill in every required field/)
  const ok = await form(`/c/${c.token}/start`, {
    business: 'Garcia Brothers Plumbing',
    phone: '(609) 555-0142',
    email: 'office@garcia.example',
    about: 'Two brothers, twenty years.',
    services: 'Water heaters: repair and replacement\nDrain cleaning: sinks and main lines',
    areas: 'Hamilton, Trenton',
    domain: 'https://GarciaPlumbing.example/home',
    confirm: 'yes',
  })
  assert.match(await ok.text(), /building your site now/)
  const ev = await (await feed(req('/api/feed?since=0', { headers: { authorization: `Bearer ${ADMIN}` } }))).json()
  const intake = ev.events.find((e) => e.type === 'intake')
  assert.equal(intake.record.intake.fields.domain, 'garciaplumbing.example')
})

test("a published client's form: only from its own origins, stored, and emailed to the client escaped", async () => {
  const c = await newClient()
  const send = (origin) =>
    lead(req('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ site: c.id, name: '<img src=x onerror=alert(1)>', phone: '609 555 0100', message: 'Leak <b>now</b>' }) }), { ip: '203.0.113.9' })
  assert.equal((await send('https://garcia.example')).status, 404, 'not published yet: unknown site')
  await asAdmin({ id: c.id, origins: ['https://garcia.example'], notifyEmail: 'office@garcia.example' })
  assert.equal((await send('https://evil.example')).status, 403)
  sent = []
  assert.equal((await send('https://garcia.example')).status, 200)
  const mail = sent.find((s) => String(s.url).includes('resend.com'))
  const body = JSON.parse(mail.opts.body)
  assert.deepEqual(body.to, ['office@garcia.example'])
  assert.doesNotMatch(body.html, /<img|<b>now/)
  assert.match(body.html, /&lt;img/)
})
