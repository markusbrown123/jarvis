// The kit's API end to end, against an in-memory store and a stand-in model.
// npm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { deps } from '../lib/bot.mjs'
import chat from '../netlify/functions/chat.mjs'
import lead from '../netlify/functions/lead.mjs'
import booking from '../netlify/functions/booking.mjs'
import feed from '../netlify/functions/feed.mjs'
import site from '../netlify/functions/site.mjs'

const ADMIN = 'k'.repeat(32)
let calls

beforeEach(() => {
  globalThis.__kitMemory = {}
  calls = []
  deps.client = { beta: { messages: { create: async (req) => (calls.push(req), fake(req)) } } }
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', KIT_ADMIN_KEY: ADMIN, CAL_WEBHOOK_SECRET: 'whsec', URL: 'https://kit.example' })
  delete process.env.BOOKING_URL_AUTOMATON
})

let fake = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply: 'It is $299, one time.', action: 'booking' }) }] })

const post = (path, body, headers = {}) =>
  new Request(`https://kit.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://automaton.llc', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const ctx = { ip: '203.0.113.9' }
const say = (text) => ({ site: 'automaton', messages: [{ role: 'user', content: text }] })

test('chat: answers from the site facts, on Opus 5.5 at low effort with fallbacks', async () => {
  process.env.BOOKING_URL_AUTOMATON = 'https://cal.com/automaton/discovery'
  const res = await chat(post('/api/chat', say('How much is a site?')), ctx)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.equal(out.reply, 'It is $299, one time.')
  assert.equal(out.action, 'booking')
  assert.equal(out.booking.url, 'https://cal.com/automaton/discovery')
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://automaton.llc')
  const req = calls[0]
  assert.equal(req.model, 'claude-opus-5-5')
  assert.equal(req.fallbacks, 'default')
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01'])
  assert.equal(req.output_config.effort, 'low')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.match(req.system[0].text, /\$299, one time, no monthly fees/)
  assert.match(req.system[0].text, /Never invent prices/)
})

test('chat: with no booking link, never offers booking', async () => {
  const out = await (await chat(post('/api/chat', say('I want one')), ctx)).json()
  assert.equal(out.action, 'lead_form')
  assert.equal(out.booking, null)
  assert.match(calls[0].system[0].text, /"lead_form" when they show real interest/)
})

test('chat: refuses other sites, bad input, and unknown sites', async () => {
  assert.equal((await chat(post('/api/chat', say('hi'), { origin: 'https://evil.example' }), ctx)).status, 403)
  assert.equal((await chat(post('/api/chat', { site: 'automaton', messages: [{ role: 'assistant', content: 'hi' }] }), ctx)).status, 400)
  assert.equal((await chat(post('/api/chat', { site: 'automaton', messages: 'hi' }), ctx)).status, 400)
  assert.equal((await chat(post('/api/chat', { ...say('hi'), site: 'nope' }), ctx)).status, 404)
  assert.equal((await chat(post('/api/chat', 'x'.repeat(40_000)), ctx)).status, 413)
  const pre = await chat(new Request('https://kit.example/api/chat?site=automaton', { method: 'OPTIONS', headers: { origin: 'https://automaton.llc' } }), ctx)
  assert.equal(pre.status, 204)
  assert.equal(calls.length, 0)
})

test('chat: no key, a refusal, or an API error all hand over to the form', async () => {
  delete process.env.ANTHROPIC_API_KEY
  let out = await (await chat(post('/api/chat', say('hi')), ctx)).json()
  assert.equal(out.action, 'lead_form')
  assert.equal(calls.length, 0)
  process.env.ANTHROPIC_API_KEY = 'test'
  fake = () => ({ stop_reason: 'refusal', content: [] })
  out = await (await chat(post('/api/chat', say('hi')), ctx)).json()
  assert.equal(out.action, 'lead_form')
  fake = () => {
    throw new Error('boom')
  }
  const res = await chat(post('/api/chat', say('hi')), ctx)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).action, 'lead_form')
  fake = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply: 'It is $299, one time.', action: 'booking' }) }] })
})

test('chat: a visitor past the daily limit is handed over without a model call', async () => {
  process.env.KIT_CHAT_PER_VISITOR = '2'
  const { default: limited } = await import(`../netlify/functions/chat.mjs?limit=${Date.now()}`)
  // (no booking link set, so a model's "booking" comes back as the form)
  for (let i = 0; i < 2; i++) assert.equal((await (await limited(post('/api/chat', say('hi')), ctx)).json()).action, 'lead_form')
  const before = calls.length
  const out = await (await limited(post('/api/chat', say('hi')), ctx)).json()
  assert.equal(calls.length, before)
  assert.match(out.reply, /answered a lot today/)
  // someone else still gets an answer
  await limited(post('/api/chat', say('hi')), { ip: '198.51.100.1' })
  assert.equal(calls.length, before + 1)
  delete process.env.KIT_CHAT_PER_VISITOR
})

test('lead: stored with an event; email or phone required; the hidden field drops bots', async () => {
  let res = await lead(post('/api/lead', { site: 'automaton', name: 'Dana', email: 'dana@plumb.co', message: 'need a site', transcript: [{ role: 'user', content: 'hi' }] }), ctx)
  assert.equal(res.status, 200)
  assert.match((await res.json()).message, /one business day/)
  const leads = [...globalThis.__kitMemory.leads.values()].map((v) => JSON.parse(v))
  assert.equal(leads.length, 1)
  assert.equal(leads[0].email, 'dana@plumb.co')
  assert.equal(leads[0].transcript.length, 1)
  assert.equal(leads[0].from.length, 16) // a hash, not the address
  assert.equal(globalThis.__kitMemory.events.size, 1)

  assert.equal((await lead(post('/api/lead', { site: 'automaton', name: 'Dana' }), ctx)).status, 400)
  assert.equal((await lead(post('/api/lead', { site: 'automaton', phone: '862 555 0100' }), ctx)).status, 200) // a number alone is enough
  assert.equal((await lead(post('/api/lead', { site: 'automaton', name: 'Dana', email: 'not-an-email' }), ctx)).status, 400)
  assert.equal((await lead(post('/api/lead', { site: 'automaton', name: 'Dana', phone: '(862) 555-0101' }), ctx)).status, 200)
  assert.equal((await lead(post('/api/lead', { site: 'automaton', name: 'Bot', email: 'b@b.co', website: 'http://spam' }), ctx)).status, 200)
  assert.equal(globalThis.__kitMemory.leads.size, 3)
})

const sign = (raw, secret = 'whsec') => createHmac('sha256', secret).update(raw).digest('hex')
const calHook = (event, uid = 'bk_1', start = '2026-11-02T15:00:00Z') =>
  JSON.stringify({
    triggerEvent: event,
    payload: {
      uid,
      title: 'Discovery call',
      startTime: start,
      endTime: '2026-11-02T15:15:00Z',
      attendees: [{ name: 'Sam Rivera', email: 'Sam@Roofs.com', timeZone: 'America/New_York' }],
      responses: { name: { label: 'Name', value: 'Sam' }, notes: { label: 'What do you need?', value: 'A site with booking' } },
    },
  })
const hook = (raw, sig) => new Request('https://kit.example/api/booking?site=automaton', { method: 'POST', headers: { 'x-cal-signature-256': sig }, body: raw })

test('booking: signed Cal.com webhooks are kept once; unsigned or forged ones are refused', async () => {
  const raw = calHook('BOOKING_CREATED')
  assert.equal((await booking(hook(raw, sign(raw)))).status, 200)
  assert.equal((await booking(hook(raw, 'sha256=' + sign(raw)))).status, 200) // the same delivery again
  assert.equal(globalThis.__kitMemory.events.size, 1)
  const b = JSON.parse(globalThis.__kitMemory.bookings.get('bk_1'))
  assert.equal(b.email, 'sam@roofs.com')
  assert.equal(b.site, 'automaton')
  assert.equal(b.answers['What do you need?'], 'A site with booking')

  assert.equal((await booking(hook(raw, sign(raw, 'wrong')))).status, 401)
  assert.equal((await booking(hook(raw, ''))).status, 401)
  const cancel = calHook('BOOKING_CANCELLED')
  assert.equal((await booking(hook(cancel, sign(cancel)))).status, 200)
  assert.equal(JSON.parse(globalThis.__kitMemory.bookings.get('bk_1')).status, 'cancelled')
  assert.equal(globalThis.__kitMemory.events.size, 2)

  delete process.env.CAL_WEBHOOK_SECRET
  assert.equal((await booking(hook(raw, sign(raw)))).status, 503)
})

test('feed: only with the admin key; events in order with their records, from a cursor', async () => {
  await lead(post('/api/lead', { site: 'automaton', name: 'Dana', email: 'dana@plumb.co' }), ctx)
  await new Promise((r) => setTimeout(r, 5))
  const raw = calHook('BOOKING_CREATED')
  await booking(hook(raw, sign(raw)))
  const get = (q, key = ADMIN) => feed(new Request(`https://kit.example/api/feed${q}`, { headers: { authorization: `Bearer ${key}` } }))
  assert.equal((await get('', 'x'.repeat(32))).status, 401)
  assert.equal((await feed(new Request('https://kit.example/api/feed'))).status, 401)
  const all = await (await get('')).json()
  assert.deepEqual(
    all.events.map((e) => e.type),
    ['lead', 'booking'],
  )
  assert.equal(all.events[0].record.name, 'Dana')
  assert.equal(all.events[1].record.name, 'Sam Rivera')
  const next = await (await get(`?since=${all.events[0].at}`)).json()
  assert.deepEqual(
    next.events.map((e) => e.type),
    ['booking'],
  )
  const none = await (await get(`?since=${all.cursor}`)).json()
  assert.equal(none.events.length, 0)
})

test('site: public config only, booking link from the environment', async () => {
  const get = () => site(new Request('https://kit.example/api/site?site=walkthroughs', { headers: { origin: 'https://kit.example' } }))
  let cfg = await (await get()).json()
  assert.equal(cfg.name, 'Listing Walkthroughs')
  assert.equal(cfg.booking, null)
  assert.equal(cfg.facts, undefined)
  process.env.BOOKING_URL_WALKTHROUGHS = 'https://cal.com/walkthroughs/demo'
  cfg = await (await get()).json()
  assert.equal(cfg.booking.url, 'https://cal.com/walkthroughs/demo')
  process.env.BOOKING_URL_WALKTHROUGHS = 'javascript:alert(1)'
  assert.equal((await (await get()).json()).booking, null)
  delete process.env.BOOKING_URL_WALKTHROUGHS
})
