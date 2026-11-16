// The kit pages' script: entrances, the live question, the call-back line,
// and the booking link once the site has one. Every part of the page works
// and reads without it.
;(() => {
  const SITE = document.querySelector('script[data-site]')?.dataset.site
  const API = ''

  // Entrances: once per element, staggered within a section, never left hidden.
  const targets = [...document.querySelectorAll('[data-reveal]')]
  for (const section of document.querySelectorAll('section, footer')) {
    section.querySelectorAll('[data-reveal]').forEach((el, i) => el.style.setProperty('--d', `${i * 80}ms`))
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    )
    targets.forEach((el) => io.observe(el))
    addEventListener('load', () => setTimeout(() => targets.forEach((el) => el.getBoundingClientRect().top < innerHeight && el.classList.add('is-in')), 2500))
  } else targets.forEach((el) => el.classList.add('is-in'))

  // Decorative loops stop for anyone who asks for less motion.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('video[autoplay]').forEach((v) => (v.removeAttribute('autoplay'), v.pause()))

  // The booking link, when the site has one: every call button becomes "book a call".
  let booking = null
  if (SITE)
    fetch(`${API}/api/site?site=${encodeURIComponent(SITE)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cfg?.booking) return
        booking = cfg.booking
        document.querySelectorAll('[data-book]').forEach((a) => {
          a.href = booking.url
          a.target = '_blank'
          a.rel = 'noopener'
          a.textContent = booking.label
        })
      })
      .catch(() => {})

  // The live question: the real assistant answers, at true size.
  const form = document.querySelector('.ask-form')
  if (form) {
    const input = form.querySelector('input')
    const answer = document.querySelector('[data-answer]')
    const note = document.querySelector('[data-note]')
    const actions = document.querySelector('[data-actions]')
    const history = []
    const ask = async (q) => {
      q = q.trim()
      if (!q) return
      history.push({ role: 'user', content: q })
      answer.classList.add('is-busy')
      answer.textContent = 'Thinking…'
      note.textContent = ''
      actions.hidden = true
      let out = { reply: "I can't answer right now. Call (862) 325-3923 and a person will.", action: 'lead_form' }
      try {
        const r = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: SITE, messages: history.slice(-12) }) })
        if (r.ok) out = await r.json()
      } catch {}
      history.push({ role: 'assistant', content: out.reply })
      answer.classList.remove('is-busy')
      answer.textContent = out.reply
      note.textContent = 'Answered by the assistant, from Automaton’s own information.'
      actions.innerHTML = ''
      if (out.action === 'booking' && (out.booking || booking)) {
        const b = out.booking || booking
        actions.innerHTML = `<a class="button" href="${b.url}" target="_blank" rel="noopener">${b.label}</a>`
      } else if (out.action !== 'none') {
        actions.innerHTML = '<a class="button" href="#close-title">Have us call you</a>'
      }
      actions.hidden = !actions.innerHTML
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      ask(input.value)
    })
    document.querySelectorAll('.example').forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.textContent
        ask(b.textContent)
      }),
    )
  }

  // One move per room: the picked room plays its camera move.
  const stage = document.querySelector('[data-stage]')
  if (stage) {
    const label = document.querySelector('[data-stage-move]')
    document.querySelectorAll('.room-pick').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('.room-pick').forEach((o) => (o.classList.toggle('is-on', o === b), o.setAttribute('aria-pressed', String(o === b))))
        stage.src = b.dataset.src
        stage.alt = b.dataset.alt
        stage.dataset.move = ''
        void stage.offsetWidth // restart the move from its beginning
        stage.dataset.move = b.dataset.move
        label.textContent = b.dataset.text
      }),
    )
  }

  // The call-back line: the blank is the form.
  const close = document.querySelector('[data-close]')
  if (close) {
    const note = close.querySelector('[data-close-note]')
    close.addEventListener('submit', async (e) => {
      e.preventDefault()
      const f = Object.fromEntries(new FormData(close))
      if ((f.phone || '').replace(/\D/g, '').length < 7) {
        note.textContent = 'Add the number to call — at least seven digits.'
        close.querySelector('input[name=phone]').focus()
        return
      }
      const btn = close.querySelector('button')
      btn.disabled = true
      try {
        const r = await fetch(`${API}/api/lead`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ site: SITE, phone: f.phone, website: f.website, message: 'Asked for a call back from the page.', page: location.href }),
        })
        const out = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(out.error)
        note.textContent = out.message || 'Thanks, we’ll call you.'
        note.classList.add('is-done')
      } catch {
        note.textContent = 'That didn’t go through. Call (862) 325-3923 instead, or try again.'
        btn.disabled = false
      }
    })
  }
})()
