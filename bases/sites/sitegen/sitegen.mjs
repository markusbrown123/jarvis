/**
 * sitegen — one business's facts in, a complete static website out.
 *
 *   build(business, { mode: 'preview' | 'live', outDir, kit, now })
 *
 * Pages: home, services, about, contact, privacy, terms, accessibility, 404; plus robots.txt,
 * sitemap.xml (live), _headers (Netlify security headers), the stylesheet, a small script for
 * the form and menu, and an SVG favicon. No fonts, images, analytics or scripts from anywhere
 * else, so the Content-Security-Policy can be strict: nothing on the page can talk to anything
 * but the site itself and the kit that receives its form.
 *
 * preview: a rough idea for a business we haven't spoken to yet. Built only from their public
 *   Google listing, marked as a preview on every page, not indexed, form switched off, and gaps
 *   shown as "this is where … goes" boxes rather than invented content.
 * live: the real site after the sale. Refuses to build until the facts it needs are confirmed
 *   (`check(business)` lists what's missing), and never shows a placeholder.
 *
 * Every value from the business is escaped; JSON-LD has "<" escaped so it can't close its tag.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { accessibility, copyFor, privacyPolicy, STATES, terms } from './copy.mjs'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const digits = (p) => String(p ?? '').replace(/\D/g, '')
const e164 = (p) => (digits(p).length === 10 ? `+1${digits(p)}` : `+${digits(p)}`)
const pretty = (p) => {
  const d = digits(p).replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p ?? '')
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const placeName = (a) => (typeof a === 'string' ? a : a?.name)

// Google's hours lines ("Monday: 7:00 AM – 6:00 PM") → [{ day, ranges: [[open, close] as HH:MM] } | closed]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function to24(t, meridiem) {
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  const mer = (m[3] ?? meridiem ?? '').toUpperCase()
  if (mer === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
}
export function parseHours(lines = []) {
  const out = []
  for (const raw of lines ?? []) {
    const line = String(raw).replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/[–—]/g, '-')
    const [dayPart, rest = ''] = line.split(/:\s(.+)/)
    const day = DAYS.find((d) => d.toLowerCase() === dayPart.trim().toLowerCase())
    if (!day) continue
    if (/closed/i.test(rest)) out.push({ day, closed: true })
    else if (/24 hours/i.test(rest)) out.push({ day, ranges: [['00:00', '23:59']] })
    else {
      const ranges = rest.split(',').map((r) => {
        const [a, b] = r.split('-').map((x) => x.trim())
        const mer = b?.match(/AM|PM/i)?.[0]
        return a && b ? [to24(a, mer), to24(b)] : null
      }).filter((r) => r && r[0] && r[1])
      if (ranges.length) out.push({ day, ranges })
    }
  }
  return out
}
const hhmm = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}
// Consecutive days with the same hours, e.g. "Mon–Fri 7 am–6 pm", "Sun closed".
function hoursSummary(lines) {
  const days = parseHours(lines)
  const label = (d) => (d.closed ? 'closed' : d.ranges.map(([a, b]) => (a === '00:00' && b === '23:59' ? 'open 24 hours' : `${hhmm(a)}–${hhmm(b)}`)).join(', '))
  const groups = []
  for (const d of days) {
    const g = groups.at(-1)
    if (g && g.label === label(d) && DAYS.indexOf(d.day) === DAYS.indexOf(g.to) + 1) g.to = d.day
    else groups.push({ from: d.day, to: d.day, label: label(d) })
  }
  return groups.map((g) => `${g.from.slice(0, 3)}${g.to !== g.from ? '–' + g.to.slice(0, 3) : ''} ${g.label}`)
}

/** What a live build still needs from the owner. Empty means ready. */
export function check(b) {
  const missing = []
  if (!b.name) missing.push('business name')
  if (digits(b.telephone).length < 10) missing.push('phone number')
  if (!/^https:\/\//.test(b.url ?? '')) missing.push('the live https:// address')
  if (!(b.areaServed?.length || b.address?.addressLocality)) missing.push('the towns they serve')
  if (!b.about) missing.push('a few lines about the business, in the owner\'s words')
  if (!b.services?.length) missing.push('their services')
  if (!b.privacyContact && !b.email) missing.push('an email for privacy requests')
  return missing
}

function model(b, mode, now) {
  const c = copyFor(b.trade)
  const areas = (b.areaServed ?? []).map(placeName).filter(Boolean)
  const city = areas[0] ?? b.address?.addressLocality ?? ''
  const st = b.address?.addressRegion ?? b.state ?? ''
  const services = (b.services?.length ? b.services.map((s) => [s.name, s.description ?? '']) : c.services).map(([name, description]) => ({ name, description, id: slug(name) }))
  const contactLine = [b.email && `email ${b.email}`, `call ${pretty(b.telephone)}`].filter(Boolean).join(' or ')
  return {
    ...b,
    mode,
    preview: mode === 'preview',
    noun: b.noun ?? c.noun,
    accent: /^#[0-9a-f]{6}$/i.test(b.accent ?? '') ? b.accent : c.accent,
    areas,
    city,
    st,
    services,
    tel: e164(b.telephone),
    phone: pretty(b.telephone),
    areaText: areas.length ? areas.join(', ') : city,
    stateName: STATES[st] ?? null,
    contactLine,
    date: now.toISOString().slice(0, 10),
    base: mode === 'live' ? b.url.replace(/\/?$/, '/') : null,
  }
}

// ---------------------------------------------------------------- page parts

const NAV = [
  ['/', 'Home'],
  ['/services/', 'Services'],
  ['/about/', 'About'],
  ['/contact/', 'Contact'],
]

function schema(m) {
  const node = {
    '@context': 'https://schema.org',
    '@type': m.type ?? 'HomeAndConstructionBusiness',
    name: m.name,
    telephone: m.tel,
    ...(m.base ? { url: m.base, '@id': `${m.base}#business` } : {}),
    ...(m.email ? { email: m.email } : {}),
    ...(m.areas.length ? { areaServed: (m.areaServed ?? []).map((a) => (typeof a === 'string' ? { '@type': 'City', name: a } : a)) } : {}),
    // A shopfront shows its address; a service-area business is described by areaServed alone.
    ...(m.showAddress && m.address?.streetAddress
      ? { address: { '@type': 'PostalAddress', streetAddress: m.address.streetAddress, addressLocality: m.address.addressLocality, addressRegion: m.address.addressRegion, postalCode: m.address.postalCode, addressCountry: 'US' } }
      : {}),
    ...(parseHours(m.hoursText).length
      ? { openingHoursSpecification: parseHours(m.hoursText).filter((d) => !d.closed).flatMap((d) => d.ranges.map(([opens, closes]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: d.day, opens, closes }))) }
      : {}),
    ...(m.sameAs?.length ? { sameAs: m.sameAs } : {}),
    makesOffer: m.services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name } })),
  }
  return `<script type="application/ld+json">${JSON.stringify(node).replace(/</g, '\\u003c')}</script>`
}

function head(m, { title, description, path }) {
  const full = title === m.name ? title : `${title} | ${m.name}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
${m.preview ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(m.base + path.replace(/^\//, ''))}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(m.base + path.replace(/^\//, ''))}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
${m.ogImage ? `<meta property="og:image" content="${esc(m.ogImage)}">` : ''}`}
<meta name="theme-color" content="${esc(m.accent)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
${schema(m)}
</head>`
}

const links = (path) => NAV.map(([href, label]) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')

function header(m, path) {
  return `<body>
<a class="skip" href="#main">Skip to content</a>
${m.preview ? `<div class="preview-bar" role="note">Preview made by Automaton for ${esc(m.name)}. Not live, and not yet approved by the owner.</div>` : ''}
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/">${esc(m.name)}</a>
    <nav aria-label="Main">
      <ul class="nav-wide">${links(path)}</ul>
      <details class="menu"><summary>Menu</summary><ul>${links(path)}</ul></details>
    </nav>
    <a class="btn btn-call top-call" href="tel:${esc(m.tel)}">Call ${esc(m.phone)}</a>
  </div>
</header>
<main id="main">`
}

function footer(m) {
  return `</main>
<footer class="foot">
  <div class="wrap foot-in">
    <address>
      <strong>${esc(m.name)}</strong><br>
      ${m.showAddress && m.address?.streetAddress ? `${esc(m.address.streetAddress)}<br>${esc(m.address.addressLocality)}, ${esc(m.address.addressRegion)} ${esc(m.address.postalCode ?? '')}<br>` : m.areaText ? `Serving ${esc(m.areaText)}<br>` : ''}
      <a href="tel:${esc(m.tel)}">${esc(m.phone)}</a>${m.email ? `<br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}${m.license ? `<br>${esc(m.license)}` : ''}
    </address>
    <ul class="foot-links">
      ${NAV.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}
      <li><a href="/privacy/">Privacy</a></li><li><a href="/terms/">Terms</a></li><li><a href="/accessibility/">Accessibility</a></li>
    </ul>
  </div>
  <p class="wrap small">© ${m.date.slice(0, 4)} ${esc(m.name)}. Website by Automaton.</p>
</footer>
<a class="callbar btn btn-call" href="tel:${esc(m.tel)}">Call ${esc(m.phone)}</a>
</body>
</html>
`
}

const gap = (m, text) => (m.preview ? `<div class="gap" role="note"><strong>Preview:</strong> ${esc(text)}</div>` : '')

function hours(m) {
  if (m.hoursText?.length) return `<ul class="hours">${m.hoursText.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
  return ''
}

// ---------------------------------------------------------------- pages

function home(m) {
  const g = m.google
  return `${head(m, { title: `${cap(m.noun)} in ${m.city}${m.st ? `, ${m.st}` : ''}`, description: `${m.name}: ${m.noun} for homes and businesses in ${m.areaText || m.city}. Call ${m.phone}.`, path: '/' })}
${header(m, '/')}
<section class="hero">
  <div class="wrap hero-in">
  <div>
    <p class="hero-name">${esc(m.name)}</p>
    <h1>${esc(cap(m.noun))} for ${esc(m.city || 'local')} homes and businesses</h1>
    <p class="lead">${m.tagline ? esc(m.tagline) + ' ' : ''}Call to talk it through, or send a few details and we'll call you back.</p>
    <div class="ctas">
      <a class="btn btn-call" href="tel:${esc(m.tel)}">Call ${esc(m.phone)}</a>
      <a class="btn btn-ghost" href="/contact/">Request an estimate</a>
    </div>
  </div>
  <aside class="hero-card" aria-label="At a glance">
    <dl>
      ${g?.rating ? `<dt>Google rating</dt><dd><span class="stars" aria-hidden="true">★</span> <a href="${esc(g.url ?? '#')}" rel="noopener noreferrer">${esc(g.rating)} out of 5, ${esc(g.reviews)} reviews</a></dd>` : ''}
      ${m.hoursText?.length ? `<dt>Hours</dt><dd>${hoursSummary(m.hoursText).map(esc).join('<br>')}</dd>` : ''}
      ${m.areaText ? `<dt>Area</dt><dd>${esc(m.areaText)}${m.areas.length ? ' and nearby' : ''}</dd>` : ''}
      ${m.license ? `<dt>Licensed</dt><dd>${esc(m.license)}</dd>` : ''}
      ${m.insured ? '<dt>Insured</dt><dd>Fully insured</dd>' : ''}
      <dt>Phone</dt><dd><a href="tel:${esc(m.tel)}">${esc(m.phone)}</a></dd>
    </dl>
  </aside>
  </div>
</section>
<section class="band">
  <div class="wrap">
    <h2>What we do</h2>
    <ul class="cards">${m.services.map((s) => `<li class="card"><h3><a href="/services/#${esc(s.id)}">${esc(s.name)}</a></h3><p>${esc(s.description)}</p></li>`).join('')}</ul>
  </div>
</section>
${m.photos?.length ? `<section class="band alt"><div class="wrap"><h2>Recent work</h2><ul class="photos">${m.photos.map((p) => `<li><img src="${esc(p.src)}" alt="${esc(p.alt)}" width="${esc(p.width ?? 800)}" height="${esc(p.height ?? 600)}" loading="lazy" decoding="async"></li>`).join('')}</ul></div></section>` : m.preview ? `<section class="band alt"><div class="wrap"><h2>Recent work</h2>${gap(m, `${m.name}'s own job photos go here: before and after, the crew, the trucks. Real photos are what make people call.`)}</div></section>` : ''}
<section class="band">
  <div class="wrap steps">
    <h2>How it works</h2>
    <ol>
      <li><strong>Call or send a few details.</strong> Tell us what's going on and where.</li>
      <li><strong>We look at the job and price it.</strong> You know the cost before any work starts.</li>
      <li><strong>The work gets done.</strong> On the day we agreed, and we clean up after.</li>
    </ol>
  </div>
</section>
${g?.rating ? `<section class="band alt"><div class="wrap"><h2>What customers say</h2><p class="rating"><span class="stars" aria-hidden="true">★</span> <strong>${esc(g.rating)}</strong> out of 5 from ${esc(g.reviews)} reviews on Google.</p><p><a href="${esc(g.url ?? '#')}" rel="noopener noreferrer">Read the reviews on Google</a></p></div></section>` : ''}
<section class="cta">
  <div class="wrap">
    <h2>Need ${esc(m.noun)}${m.city ? ` in ${esc(m.city)}` : ''}?</h2>
    <a class="btn btn-call" href="tel:${esc(m.tel)}">Call ${esc(m.phone)}</a>
  </div>
</section>
${footer(m)}`
}

function servicesPage(m) {
  return `${head(m, { title: `${cap(m.noun)} services`, description: `${m.services.map((s) => s.name).join(', ')}, from ${m.name}${m.city ? ` in ${m.city}` : ''}.`, path: '/services/' })}
${header(m, '/services/')}
<section class="page-head"><div class="wrap"><h1>Services</h1><p class="lead">${esc(cap(m.noun))} for homes and businesses${m.areaText ? ` in ${esc(m.areaText)}` : ''}.</p></div></section>
<section class="band"><div class="wrap">
  ${m.services.map((s) => `<article class="service" id="${esc(s.id)}"><h2>${esc(s.name)}</h2><p>${esc(s.description)}</p></article>`).join('\n  ')}
  <p><a class="btn btn-call" href="tel:${esc(m.tel)}">Call ${esc(m.phone)}</a> <a class="btn btn-ghost" href="/contact/">Request an estimate</a></p>
</div></section>
${footer(m)}`
}

function about(m) {
  return `${head(m, { title: 'About', description: `About ${m.name}: ${m.noun} for homes and businesses${m.areaText ? ` in ${m.areaText}` : ''}. Who we are and where we work. Call ${m.phone}.`, path: '/about/' })}
${header(m, '/about/')}
<section class="page-head"><div class="wrap"><h1>About ${esc(m.name)}</h1></div></section>
<section class="band"><div class="wrap prose">
  ${m.about ? m.about.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('\n  ') : gap(m, `${m.name}'s story goes here, in the owner's words: how long they've been doing this, who does the work, what they're proud of. We write it together on a short call.`)}
  ${m.areaText ? `<h2>Where we work</h2><p>${esc(m.areaText)}${m.areas.length ? ' and nearby' : ''}.</p>` : ''}
  ${hours(m) ? `<h2>Hours</h2>${hours(m)}` : ''}
</div></section>
${footer(m)}`
}

function contact(m, kit) {
  const off = m.preview || !kit
  return `${head(m, { title: 'Contact', description: `Contact ${m.name}: call ${m.phone} or send a few details about the job and we'll call you back with an estimate.`, path: '/contact/' })}
${header(m, '/contact/')}
<section class="page-head"><div class="wrap"><h1>Contact</h1><p class="lead">The fastest way is to call: <a href="tel:${esc(m.tel)}">${esc(m.phone)}</a>.</p></div></section>
<section class="band"><div class="wrap contact">
  <form class="form" id="estimate"${off ? '' : ` data-kit="${esc(kit.url.replace(/\/$/, ''))}" data-site="${esc(kit.site)}"`} novalidate>
    <h2>Request an estimate</h2>
    ${off ? gap(m, 'This form is switched off in the preview. On the live site it sends straight to the owner, and they call you back.') : ''}
    <label for="f-name">Name</label><input id="f-name" name="name" autocomplete="name" required${off ? ' disabled' : ''}>
    <label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" autocomplete="tel" required${off ? ' disabled' : ''}>
    <label for="f-email">Email <span class="opt">(optional)</span></label><input id="f-email" name="email" type="email" autocomplete="email"${off ? ' disabled' : ''}>
    <label for="f-msg">What do you need done, and where?</label><textarea id="f-msg" name="message" rows="4"${off ? ' disabled' : ''}></textarea>
    <div class="trap" aria-hidden="true"><label for="f-web">Leave this empty</label><input id="f-web" name="website" tabindex="-1" autocomplete="off"></div>
    <button class="btn btn-call" type="submit"${off ? ' disabled' : ''}>Send my request</button>
    <p class="small">We use these details only to get back to you. <a href="/privacy/">Privacy policy</a>.</p>
    <p class="form-status" role="status" aria-live="polite"></p>
  </form>
  <div>
    <h2>Call</h2><p><a class="big-tel" href="tel:${esc(m.tel)}">${esc(m.phone)}</a></p>
    ${hours(m) ? `<h2>Hours</h2>${hours(m)}` : ''}
    ${m.areaText ? `<h2>Area</h2><p>${esc(m.areaText)}</p>` : ''}
  </div>
</div></section>
${footer(m)}`
}

function legal(m, title, path, sections, intro) {
  return `${head(m, { title, description: `${title} for the ${m.name} website: plain-language details${m.city ? ` from a ${m.noun} business in ${m.city}` : ''}.`, path })}
${header(m, path)}
<section class="page-head"><div class="wrap"><h1>${esc(title)}</h1>${intro ? `<p class="lead">${esc(intro)}</p>` : ''}</div></section>
<section class="band"><div class="wrap prose">
  ${sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join('\n  ')}
</div></section>
${footer(m)}`
}

function notFound(m) {
  return `${head(m, { title: 'Page not found', description: `${m.name}: page not found.`, path: '/404.html' })}
${header(m, '')}
<section class="page-head"><div class="wrap"><h1>That page isn't here</h1><p class="lead"><a href="/">Go to the home page</a>, or call <a href="tel:${esc(m.tel)}">${esc(m.phone)}</a>.</p></div></section>
${footer(m)}`
}

// ---------------------------------------------------------------- files

function headers(m, kit) {
  const kitOrigin = kit && !m.preview ? new URL(kit.url).origin : ''
  const csp = [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    `connect-src 'self'${kitOrigin ? ' ' + kitOrigin : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
  return `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
${m.preview ? '  X-Robots-Tag: noindex, nofollow\n' : ''}
/assets/*
  Cache-Control: public, max-age=604800
`
}

const css = (m) => `:root{--accent:${m.accent};--ink:#16181d;--soft:#4b5260;--line:#dfe3e8;--bg:#ffffff;--alt:#f4f5f7;--max:68rem}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;padding-bottom:4.5rem}
@media(min-width:48rem){body{padding-bottom:0}}
a{color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
h1,h2,h3{line-height:1.15;letter-spacing:-.01em;margin:0 0 .6rem}h1{font-size:clamp(2rem,5.5vw,3.4rem);max-width:20ch}h2{font-size:clamp(1.4rem,3vw,1.9rem)}h3{font-size:1.15rem}
p{margin:0 0 1rem}.wrap{max-width:var(--max);margin:0 auto;padding:0 1.25rem}.small{font-size:.9rem;color:var(--soft)}
.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;background:#fff;padding:.5rem 1rem;z-index:10}
.preview-bar{background:#16181d;color:#fff;font-size:.9rem;padding:.5rem 1.25rem;text-align:center}
.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:5}
.top-in{display:flex;align-items:center;gap:1rem;min-height:4rem}.brand{font-weight:800;font-size:1.1rem;line-height:1.2;color:var(--ink);text-decoration:none;margin-right:auto;padding:.5rem 0}
.menu summary{cursor:pointer;list-style:none;padding:.6rem .9rem;border:1px solid var(--line);border-radius:.4rem;min-height:44px;display:flex;align-items:center}.menu summary::-webkit-details-marker{display:none}
.menu ul{list-style:none;margin:0;padding:.5rem;position:absolute;right:1.25rem;background:#fff;border:1px solid var(--line);border-radius:.5rem;min-width:12rem}
.menu a,.nav-wide a{display:block;padding:.6rem .8rem;color:var(--ink);text-decoration:none;min-height:44px}.menu a[aria-current],.nav-wide a[aria-current]{font-weight:700;color:var(--accent)}
.nav-wide{display:none;list-style:none;margin:0;padding:0;gap:.25rem}
@media(min-width:48rem){.nav-wide{display:flex}.menu{display:none}}

.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.75rem 1.3rem;border-radius:.45rem;font-weight:700;text-decoration:none;border:2px solid var(--accent);font-size:1rem;cursor:pointer;font-family:inherit}
.btn-call{background:var(--accent);color:#fff}.top .top-call{display:none}@media(min-width:48rem){.top .top-call{display:inline-flex}}.btn-ghost{background:transparent;color:var(--accent)}.btn[disabled]{opacity:.5;cursor:not-allowed}
.callbar{position:fixed;left:.75rem;right:.75rem;bottom:.75rem;z-index:6;box-shadow:0 6px 20px rgba(0,0,0,.18)}@media(min-width:48rem){.callbar{display:none}}
.hero{padding:clamp(2.5rem,7vw,5.5rem) 0;border-bottom:6px solid var(--accent)}.hero-name{font-weight:700;color:var(--accent);margin-bottom:.5rem}
.lead{font-size:1.15rem;color:var(--soft);max-width:40rem}.ctas{display:flex;flex-wrap:wrap;gap:.75rem;margin:1.5rem 0}
.hero-in{display:grid;gap:2rem;align-items:center}@media(min-width:60rem){.hero-in{grid-template-columns:minmax(0,1.6fr) minmax(16rem,1fr)}}
.hero-card{border:1px solid var(--line);border-top:5px solid var(--accent);border-radius:.6rem;padding:1.2rem 1.4rem;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.hero-card dl{margin:0}.hero-card dt{font-size:.8rem;font-weight:700;color:var(--soft);margin-top:.8rem}.hero-card dt:first-child{margin-top:0}.hero-card dd{margin:.15rem 0 0}.hero-card a{display:inline-block;padding:.3rem 0}
.band{padding:clamp(2.5rem,6vw,4rem) 0}.band.alt{background:var(--alt)}.page-head{padding:2.5rem 0 1rem;border-bottom:1px solid var(--line)}
.cards{list-style:none;padding:0;margin:1rem 0 0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))}
.card{border:1px solid var(--line);border-radius:.6rem;padding:1.2rem}.card h3 a{color:var(--ink);text-decoration:none}.card p{margin:0;color:var(--soft)}
.steps ol{padding-left:1.2rem;max-width:44rem}.steps li{margin:.6rem 0}
.rating{font-size:1.2rem}.stars{color:#b7791f}
.cta{background:var(--ink);color:#fff;padding:2.5rem 0}.cta h2{color:#fff}.cta .btn-call{border-color:#fff}
.photos{list-style:none;padding:0;display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))}.photos img{width:100%;height:auto;border-radius:.5rem}
.gap{border:2px dashed var(--line);border-radius:.6rem;padding:1rem 1.2rem;color:var(--soft);background:#fff;margin:.5rem 0 1rem}
.prose{max-width:46rem}.service{border-bottom:1px solid var(--line);padding:1rem 0}.hours{list-style:none;padding:0}
.contact{display:grid;gap:2.5rem}@media(min-width:56rem){.contact{grid-template-columns:3fr 2fr}}
.form label{display:block;font-weight:600;margin:.9rem 0 .3rem}.opt{font-weight:400;color:var(--soft)}
.form input,.form textarea{width:100%;font:inherit;padding:.7rem .8rem;border:1px solid #9aa1ab;border-radius:.4rem;min-height:48px}
.form button{margin-top:1.2rem}.trap{position:absolute;left:-9999px}.form-status{font-weight:600;margin-top:1rem}.big-tel{font-size:1.6rem;font-weight:800}
.foot{border-top:1px solid var(--line);padding:2.5rem 0 1.5rem;margin-top:2rem}.foot-in{display:grid;gap:1.5rem}@media(min-width:48rem){.foot-in{grid-template-columns:1fr 1fr}}
.foot address{font-style:normal;line-height:1.9}.foot address a{display:inline-block;padding:.3rem 0;min-height:32px}.foot-links{list-style:none;padding:0;margin:0;columns:2}.foot-links a{display:inline-block;padding:.35rem 0;min-height:32px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`

const js = `// Menu closes after a choice; the estimate form posts to the site kit and says plainly what happened.
document.addEventListener('click', (e) => { const m = document.querySelector('.menu[open]'); if (m && e.target.closest('.menu a')) m.removeAttribute('open') })
const form = document.getElementById('estimate')
if (form && form.dataset.kit) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const status = form.querySelector('.form-status')
    const data = Object.fromEntries(new FormData(form))
    if (!data.name || !data.phone) { status.textContent = 'Please add your name and phone number.'; return }
    const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Sending…'
    try {
      const res = await fetch(form.dataset.kit + '/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, site: form.dataset.site, page: location.pathname }) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'failed')
      form.reset(); status.textContent = out.message || 'Thanks, we have your details and will call you back.'
    } catch { status.textContent = 'That didn\\'t go through. Please call instead.'; button.disabled = false }
  })
}
`

const favicon = (m) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${esc(m.accent)}"/><text x="32" y="44" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${esc((m.name.match(/[A-Za-z0-9]/) ?? ['A'])[0].toUpperCase())}</text></svg>`

/**
 * A built page served under a folder instead of a domain root (a preview behind JARVIS's
 * signed path, or /<token>/ on the previews site): its root-relative links, re-pointed.
 */
export const rebase = (html, root) => html.replace(/\b(href|src|action)="\/(?!\/)/g, `$1="${root.replace(/\/?$/, '/')}`)

export function build(business, { mode = 'preview', outDir, kit = null, now = new Date() } = {}) {
  if (!outDir) throw new Error('outDir is required')
  if (mode === 'live') {
    const missing = check(business)
    if (missing.length) throw new Error(`not ready to build live; still needed: ${missing.join(', ')}`)
    if (!kit?.url || !kit?.site) throw new Error('a live site needs its kit (url and site id) for the form')
  }
  const m = model(business, mode, now)
  const files = {
    'index.html': home(m),
    'services/index.html': servicesPage(m),
    'about/index.html': about(m),
    'contact/index.html': contact(m, kit),
    'privacy/index.html': legal(m, 'Privacy policy', '/privacy/', privacyPolicy(m, { date: m.date, assistant: !!business.assistant }), 'What happens to the details you send us.'),
    'terms/index.html': legal(m, 'Terms of use', '/terms/', terms(m, { date: m.date })),
    'accessibility/index.html': legal(m, 'Accessibility', '/accessibility/', accessibility(m, { date: m.date })),
    '404.html': notFound(m),
    'assets/site.css': css(m),
    'assets/site.js': js,
    'favicon.svg': favicon(m),
    _headers: headers(m, kit),
    'robots.txt': m.preview ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${m.base}sitemap.xml\n`,
  }
  if (!m.preview) {
    const pages = ['', 'services/', 'about/', 'contact/', 'privacy/', 'terms/', 'accessibility/']
    files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${esc(m.base + p)}</loc><lastmod>${m.date}</lastmod></url>`).join('\n')}\n</urlset>\n`
  }
  for (const [rel, body] of Object.entries(files)) {
    const f = join(outDir, rel)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, body)
  }
  return { outDir, files: Object.keys(files), pages: Object.keys(files).filter((f) => f.endsWith('.html')) }
}
