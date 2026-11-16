/**
 * The real estate walkthrough inbox, run on its own (bases/realestate/inbox.py).
 *
 * Every five minutes, if the inbox folder exists (WALKTHROUGH_INBOX, else
 * ~/RealEstate/Inbox), JARVIS renders whatever listing folders are ready. A
 * finished walkthrough goes on Markus's Needs list with its review page; one
 * that couldn't be made goes there with why. The free Ken Burns cut unless
 * WALKTHROUGH_BACKEND names a model, never past WALKTHROUGH_MAX_SPEND a
 * listing (inbox.py). Nothing is sent to anyone.
 *
 * The review page and its videos are served under a signed path
 * (/api/walkthroughs/<sig>/<listing>/<file>), so a link from Needs opens on
 * the phone without the dashboard's token; the signature is the token's own.
 */
import { spawn } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import * as hub from './store.mjs'
import { baseDir } from './streams.mjs'

export const INBOX = resolve((process.env.WALKTHROUGH_INBOX ?? '~/RealEstate/Inbox').replace(/^~(?=$|\/)/, homedir()))
const EVERY = 5 * 60000
const FILES = /^(review\.html|walkthrough-(16x9|9x16)\.mp4|thumbnail\.jpg)$/
const TYPES = { html: 'text/html; charset=utf-8', mp4: 'video/mp4', jpg: 'image/jpeg' }

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
const sign = (listing) => createHmac('sha256', hub.apiToken()).update(`walkthrough:${listing}`).digest('hex').slice(0, 32)
export const reviewUrl = (listing) => `/api/walkthroughs/${sign(listing)}/${encodeURIComponent(listing)}/review.html`

/** inbox.py once; its JSON lines. */
function runInbox() {
  return new Promise((done) => {
    const child = spawn('python3', ['inbox.py', '--json'], { cwd: baseDir('realestate'), env: { ...process.env, WALKTHROUGH_INBOX: INBOX } })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    // A paid model can take a while a listing; past two hours something's stuck.
    const timer = setTimeout(() => child.kill(), 2 * 3600_000)
    child.on('error', (e) => (clearTimeout(timer), done({ lines: [], error: e.message })))
    child.on('close', (code) => {
      clearTimeout(timer)
      const lines = out
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .filter(Boolean)
      done({ lines, error: code ? err.trim().split('\n').at(-1) || `inbox.py exited ${code}` : null })
    })
  })
}

/** What a run of inbox.py did, onto Needs. Only what it rendered or failed this time. */
export function take(lines, startedAt) {
  for (const { listing, status, result } of lines) {
    if (!result || (status !== 'rendered' && status !== 'failed')) continue
    if (status === 'failed' && (result.finished_at ?? 0) * 1000 < startedAt) continue // an old failure, already reported
    const id = `realestate:walkthrough:${slug(listing)}`
    if (status === 'rendered') {
      const cost = result.cost_usd ? `, $${result.cost_usd.toFixed(2)}` : ', no cost'
      hub.upsertItem({
        id,
        source: 'jarvis',
        project: 'realestate',
        title: `Walkthrough ready: ${listing}`,
        why: `JARVIS made it from the photos in your inbox (${result.shots} shots, ${Math.round(result.duration_s)}s, ${result.backend}${cost}). Nothing has been sent.`,
        instructions: `Watch both cuts on its review page${result.qc_flagged ? ` — ${result.qc_flagged} shot(s) flagged by QC, look at those first` : ''}. If it's right, send it to the agent yourself and mark this Done. It's in ${result.folder}/walkthrough/.`,
        priority: 'P2',
        state: 'open',
        actions: [{ kind: 'open', label: 'Review it', url: reviewUrl(listing) }],
      })
      hub.activity({ source: 'jarvis', project: 'realestate', title: `Walkthrough made: ${listing}`, level: 'success' })
    } else {
      hub.upsertItem({
        id,
        source: 'jarvis',
        project: 'realestate',
        title: `Walkthrough not made: ${listing}`,
        why: result.reason ?? 'The render failed.',
        instructions: `Fix what it says — the photos, the model's price (HF_USD_PER_CLIP) or its key — and it tries again by itself when the folder's photos change. The log is ${result.folder ?? listing}/walkthrough/render.log.`,
        priority: 'P3',
        state: 'open',
      })
    }
  }
}

let busy = false
export async function tick() {
  if (busy || !existsSync(INBOX)) return
  busy = true
  const startedAt = Date.now() - 1000
  try {
    const { lines, error } = await runInbox()
    if (error) console.warn('[hub] walkthroughs:', error)
    take(lines, startedAt)
  } finally {
    busy = false
  }
}

export function start() {
  if (process.env.JARVIS_NO_WALKTHROUGHS) return
  setTimeout(() => void tick(), 60_000).unref()
  setInterval(() => void tick(), EVERY).unref()
}

/**
 * GET /api/walkthroughs/<sig>/<listing>/<file>: a finished walkthrough's
 * review page, cuts and thumbnail. True if it handled the request.
 */
export function serve(req, res, path) {
  const m = path.match(/^\/api\/walkthroughs\/([0-9a-f]{32})\/([^/]+)\/([^/]+)$/)
  if (!m) return false
  const [, sig, rawListing, file] = m
  let listing
  try {
    listing = decodeURIComponent(rawListing)
  } catch {
    listing = ''
  }
  const want = Buffer.from(sign(listing))
  const ok = listing && !listing.startsWith('.') && !/[/\\]/.test(listing) && FILES.test(file) && timingSafeEqual(Buffer.from(sig), want)
  const full = ok ? join(INBOX, listing, 'walkthrough', file) : ''
  if (!ok || !full.startsWith(INBOX + sep) || !existsSync(full)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return true
  }
  const size = statSync(full).size
  const type = TYPES[file.split('.').pop()]
  // Safari plays video only with byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return true
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=300' })
    createReadStream(full, { start, end }).pipe(res)
    return true
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=300' })
  createReadStream(full).pipe(res)
  return true
}
