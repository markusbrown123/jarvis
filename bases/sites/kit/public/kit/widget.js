/*
 * Automaton site kit — the assistant, booking and contact form, on any site.
 *
 *   <script src="https://<kit>/kit/widget.js" data-site="automaton" defer></script>
 *
 * A button in the corner opens a panel: the site's assistant answers from the
 * site's own facts (/api/chat), offers a call when they're ready (the site's
 * Cal.com link) or takes their details (/api/lead). Its styles live in its
 * own isolated root, so nothing on the host page can break it or be broken by it.
 *
 * window.AutomatonKit.open("a question") opens it, and asks, from any button.
 */
;(() => {
  const script = document.currentScript
  const SITE = script?.dataset.site
  const API = (script?.dataset.api || new URL(script?.src || location.href).origin).replace(/\/$/, '')
  if (!SITE || window.AutomatonKit) return
  const KEY = `automaton-kit:${SITE}`

  const state = { cfg: null, open: false, busy: false, messages: [], form: false, sent: false }
  try {
    Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}'), { open: false, busy: false })
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ messages: state.messages.slice(-24), form: state.form, sent: state.sent }))
    } catch {}
  }

  const host = document.createElement('div')
  host.setAttribute('data-ui', 'automaton-kit')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
:host { all: initial; }
* { box-sizing: border-box; }
button, a, input, textarea { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.kit { --accent: #c8ff00; --accent-ink: #0a0a0f; --bg: #111118; --surface: #1c1c28; --ink: #f0f0f8; --muted: #9aa1b8;
  font: 16px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
.launch { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 20px 0 16px; border: 0; border-radius: 999px;
  background: var(--accent); color: var(--accent-ink); font: 600 16px/1 inherit; font-family: inherit; cursor: pointer;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); /* taste-skill-ignore: it floats over the host page */ transition: transform 140ms cubic-bezier(.22,1,.36,1); }
.launch:hover { transform: translateY(-2px); }
.launch:active { transform: scale(.97); }
.launch:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.launch svg { width: 22px; height: 22px; }
.panel { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: calc(max(16px, env(safe-area-inset-bottom)) + 64px); z-index: 2147483001;
  width: min(400px, calc(100vw - 32px)); height: min(620px, calc(100dvh - 120px)); display: grid; grid-template-rows: auto 1fr auto;
  background: var(--bg); border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.45); /* taste-skill-ignore: a floating dialog */
  transform-origin: bottom right; animation: pop 220ms cubic-bezier(.22,1,.36,1); }
.panel[hidden] { display: none; }
@keyframes pop { from { opacity: 0; transform: translateY(12px) scale(.98); } }
header { display: flex; align-items: center; gap: 12px; padding: 16px 16px 14px 20px; background: var(--surface); }
header b { display: block; font-size: 16px; }
header span { display: block; font-size: 13px; color: var(--muted); }
header .x { margin-left: auto; width: 44px; height: 44px; border: 0; border-radius: 12px; background: transparent; color: var(--ink); font-size: 22px; cursor: pointer; }
header .x:hover { background: rgba(255,255,255,.06); }
.log { overflow-y: auto; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.msg { max-width: 86%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; }
.bot { align-self: flex-start; background: var(--surface); border-bottom-left-radius: 6px; }
.me { align-self: flex-end; background: var(--accent); color: var(--accent-ink); border-bottom-right-radius: 6px; }
.typing { display: inline-flex; gap: 4px; padding: 14px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: blink 1s infinite; }
.typing i:nth-child(2) { animation-delay: .15s } .typing i:nth-child(3) { animation-delay: .3s }
@keyframes blink { 50% { opacity: .3; } }
.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 0 6px; }
.chip, .act { min-height: 40px; padding: 8px 14px; border: 0; border-radius: 999px; background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
.chip:hover { background: #262636; }
.act { display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: var(--accent-ink); font-weight: 600; text-decoration: none; }
.act.alt { background: var(--surface); color: var(--ink); font-weight: 500; }
.row { display: flex; flex-wrap: wrap; gap: 8px; }
form.ask { display: flex; gap: 8px; padding: 12px 12px max(12px, env(safe-area-inset-bottom)); background: var(--bg); }
input, textarea { width: 100%; min-height: 48px; padding: 12px 14px; border: 0; border-radius: 12px; background: var(--surface); color: var(--ink); font: inherit; font-size: 16px; }
input::placeholder, textarea::placeholder { color: var(--muted); }
.send { flex: none; width: 48px; height: 48px; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-ink); cursor: pointer; }
.send:disabled { opacity: .5; cursor: default; }
.send svg { width: 20px; height: 20px; margin: auto; display: block; }
form.lead { align-self: stretch; display: grid; gap: 8px; padding: 14px; border-radius: 16px; background: var(--surface); }
form.lead p { margin: 0 0 2px; font-size: 14px; color: var(--muted); }
form.lead input, form.lead textarea { background: var(--bg); }
form.lead .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; } /* taste-skill-ignore: hidden trap field */
.err { color: #fca5a5; font-size: 14px; }
.foot { padding: 0 16px 10px; font-size: 12.5px; color: var(--muted); }
@media (max-width: 520px) {
  .panel { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; bottom: 0; right: 0; }
  .launch[aria-expanded="true"] { display: none; }
}
@media (prefers-reduced-motion: reduce) { .panel, .launch, .typing i { animation: none; transition: none; } }
</style>
<div class="kit">
  <button class="launch" type="button" aria-expanded="false" aria-controls="kit-panel">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
    <span>Ask us</span>
  </button>
  <section class="panel" id="kit-panel" role="dialog" aria-modal="false" aria-label="Chat" hidden>
    <header><div><b class="name">…</b><span>Answers right away · a person follows up</span></div><button class="x" type="button" aria-label="Close chat">×</button></header>
    <div class="log" aria-live="polite"></div>
    <div>
      <form class="ask"><label style="flex:1"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Your question</span><input name="q" autocomplete="off" maxlength="600" placeholder="Ask a question…" enterkeyhint="send" /></label><button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
      <p class="foot">An AI assistant answers from this business's own information. Don't share passwords or card details.</p>
    </div>
  </section>
</div>`

  const $ = (s) => root.querySelector(s)
  const launch = $('.launch'),
    panel = $('.panel'),
    log = $('.log'),
    ask = $('form.ask'),
    input = $('input[name=q]')
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function render() {
    const cfg = state.cfg
    if (cfg) {
      $('.name').textContent = cfg.name
      if (cfg.accent) root.querySelector('.kit').style.setProperty('--accent', cfg.accent)
    }
    const parts = []
    parts.push(`<div class="msg bot">${esc(cfg?.greeting ?? 'Hi, ask me anything.')}</div>`)
    if (!state.messages.length && cfg?.suggestions?.length) parts.push(`<div class="chips">${cfg.suggestions.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('')}</div>`)
    state.messages.forEach((m, i) => {
      parts.push(`<div class="msg ${m.role === 'user' ? 'me' : 'bot'}">${esc(m.content)}</div>`)
      const last = i === state.messages.length - 1
      if (last && m.role === 'assistant' && m.action === 'booking' && cfg?.booking)
        parts.push(
          `<div class="row"><a class="act" href="${esc(cfg.booking.url)}" target="_blank" rel="noopener">${esc(cfg.booking.label)}</a><button type="button" class="act alt" data-form>Have someone call me</button></div>`,
        )
    })
    if (state.busy) parts.push('<div class="msg bot typing" aria-label="Typing"><i></i><i></i><i></i></div>')
    if (state.sent) parts.push(`<div class="msg bot">${esc(cfg?.thanks ?? 'Thanks, we’ll be in touch.')}</div>`)
    else if (state.form)
      parts.push(`<form class="lead" novalidate><p>Leave a number or email and the team will get back to you.</p>
      <input name="name" autocomplete="name" placeholder="Your name…" maxlength="100" />
      <input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Phone, e.g. 862 555 0100…" maxlength="40" />
      <input name="email" type="email" autocomplete="email" placeholder="Email…" maxlength="254" />
      <textarea name="message" rows="2" placeholder="What do you need? (optional)…" maxlength="2000"></textarea>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
      <p class="err" role="alert"></p>
      <button class="act" type="submit">Send my details</button></form>`)
    log.innerHTML = parts.join('')
    log.scrollTop = log.scrollHeight
  }

  async function config() {
    if (state.cfg) return state.cfg
    try {
      const r = await fetch(`${API}/api/site?site=${encodeURIComponent(SITE)}`)
      if (r.ok) state.cfg = await r.json()
    } catch {}
    render()
    return state.cfg
  }

  async function send(text) {
    text = text.trim()
    if (!text || state.busy) return
    state.messages.push({ role: 'user', content: text })
    state.busy = true
    render()
    let out = { reply: 'Sorry, I can’t reach the team’s assistant right now. Leave your details and they’ll get back to you.', action: 'lead_form' }
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site: SITE, messages: state.messages.map(({ role, content }) => ({ role, content })) }),
      })
      if (r.ok) out = await r.json()
    } catch {}
    state.busy = false
    state.messages.push({ role: 'assistant', content: out.reply, action: out.action })
    if (out.action === 'lead_form' || (out.action === 'booking' && !state.cfg?.booking)) state.form = true
    save()
    render()
  }

  async function sendLead(form) {
    const f = Object.fromEntries(new FormData(form))
    const err = form.querySelector('.err')
    if (!f.phone && !f.email) return void ((err.textContent = 'Add a phone number or an email.'), form.querySelector('input[name=phone]').focus())
    form.querySelector('button[type=submit]').disabled = true
    try {
      const r = await fetch(`${API}/api/lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site: SITE, ...f, page: location.href, transcript: state.messages.map(({ role, content }) => ({ role, content })) }),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'Something went wrong.')
      state.sent = true
      state.form = false
      save()
      render()
    } catch (e) {
      err.textContent = e.message.startsWith('check:') ? `Please ${e.message.replace('check:', 'check your')}.` : 'That didn’t go through. Please try again.'
      form.querySelector('button[type=submit]').disabled = false
    }
  }

  function setOpen(open) {
    state.open = open
    panel.hidden = !open
    launch.setAttribute('aria-expanded', String(open))
    if (open) {
      config()
      render()
      setTimeout(() => input.focus(), 30)
    } else launch.focus()
  }

  launch.addEventListener('click', () => setOpen(!state.open))
  $('.x').addEventListener('click', () => setOpen(false))
  root.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false))
  ask.addEventListener('submit', (e) => {
    e.preventDefault()
    const q = input.value
    input.value = ''
    send(q)
  })
  log.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip')
    if (chip) send(chip.textContent)
    if (e.target.closest('[data-form]')) {
      state.form = true
      render()
    }
  })
  log.addEventListener('submit', (e) => {
    if (!e.target.matches('form.lead')) return
    e.preventDefault()
    sendLead(e.target)
  })

  window.AutomatonKit = {
    open(question) {
      setOpen(true)
      if (question) send(question)
    },
  }
  document.body.appendChild(host)
  config()
})()
