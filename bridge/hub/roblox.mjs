/**
 * Roblox studio source.
 *
 * The studio (MarkusRobloxStudio in the traderedge repo) already runs its own
 * job system: queue/tasks.json holds every task with its state, lease, history
 * and revision, and a `human` list of things only Markus can do. The Windows
 * PC is the authoritative worker and pushes to GitHub. So this reads that
 * queue — it does not invent a second one — and mirrors it into the hub:
 * tasks become jobs, human items become Needs Markus items, task history
 * becomes activity, and each game's renders become dated asset previews.
 * Its evidence folders (world renders, UI previews by device and screen,
 * 4K UI, characters, maps, props) become a gallery per game: listed from
 * git, each image copied out of git into the cache only when it's looked at.
 *
 * Read-only throughout. Nothing here writes to the queue or the repo.
 */

import { cacheBlob, fetchRef, listTree, locateRepo, showText } from './git.mjs'
import { expand, loadConfig } from './config.mjs'
import * as hub from './store.mjs'

const NAME = 'roblox'
const STATE_MAP = {
  running: 'running',
  ready: 'queued',
  queued: 'queued',
  blocked: 'waiting',
  review: 'waiting',
  interrupted: 'waiting',
  done: 'completed',
  failed: 'failed',
  canceled: 'canceled',
}

let repo = null
let last = { ok: false, error: null, at: 0 }

// ---------------------------------------------------------------- galleries

const IMAGE = /\.(jpe?g|png|webp)$/i
/** The studio's evidence folders, in the order the gallery shows them. */
const SECTIONS = [
  { dir: 'world-renders-4k', title: 'World · 4K', note: 'Offline renders of the built place, not gameplay captures.' },
  { dir: 'map-previews', title: 'Maps', note: 'Map previews rendered from the place file.' },
  { dir: 'ui-previews', title: 'UI', note: 'Every screen of the UI, by device.', devices: true },
  { dir: 'ui-previews-4k', title: 'UI · 4K', note: 'The main screens at 4K.', devices: true },
  { dir: 'characters', title: 'Characters', note: 'Character lineups and studies.' },
  { dir: 'dragon-art', title: 'Creatures', note: 'Blender renders of the creature roster, not Roblox screenshots.', game: 'dragon-egg-dash' },
  { dir: 'blender-previews', title: 'Props', note: 'Props modelled in Blender, before import.' },
  { dir: 'turf-blasters', title: 'Props', note: 'Blaster lineup.', game: 'turf-blasterz' },
  { dir: 'style-bible', title: 'Logo & icon', note: 'Logo and icon mock-ups from the style bible.' },
]
// Studio-wide pictures (no one game's) are listed under this id.
const STUDIO = '_studio'
let galleries = { commit: null, byGame: new Map(), blobs: new Map() }

/** Words from a file name: the game's prefix, the extension and separators gone. */
const words = (s) => s.replace(IMAGE, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Which game a picture belongs to, from its name (or folder), else the studio's. */
function gameOf(entry, section, ids, aliases) {
  if (section.game) return section.game
  if (entry.path.includes('/dragons/')) return 'dragon-egg-dash'
  const base = entry.name
  const id = ids.find((g) => base.startsWith(`${g}__`) || base.startsWith(`${g}-`) || base.startsWith(`${g}_`))
  return id ?? aliases.get(base.split('_')[0]) ?? STUDIO
}

/** A picture's caption and, for UI previews, its device: game__Device__screen.jpg. */
function labelOf(entry, game, section, aliases) {
  const short = entry.name.split('_')[0]
  let base = entry.name.startsWith(game) ? entry.name.slice(game.length).replace(/^[-_]+/, '') : aliases.get(short) === game ? entry.name.slice(short.length + 1) : entry.name
  const parts = base.replace(IMAGE, '').split('__')
  let device = null
  if (section.devices && parts.length >= 2) {
    device = parts[0]
    base = parts.slice(1).join(' · ')
  } else base = parts.join(' · ')
  // Folders under the section (a dragon's stage, poses…) say what it is too.
  const sub = entry.rel.split('/').slice(0, -1).filter((d) => !/^(cells|part-built|pilot)$/.test(d))
  return { label: [...sub, words(base)].filter(Boolean).join(' · '), device }
}

async function buildGalleries(dir, ref, studio, ids, commit) {
  if (galleries.commit === commit.sha) return
  // The studio's own build summary says which game each short prefix is.
  const aliases = new Map()
  try {
    const summary = JSON.parse(await showText(dir, ref, `${studio}/evidence/blender-previews/build_summary.json`))
    for (const a of summary.assets ?? []) if (a.asset && a.game) aliases.set(String(a.asset).split('_')[0], a.game)
  } catch {
    /* no summary: those files list as studio-wide */
  }
  const byGame = new Map()
  const blobs = new Map()
  const byLength = [...ids].sort((a, b) => b.length - a.length)
  for (const section of SECTIONS) {
    const root = `${studio}/evidence/${section.dir}`
    const files = (await listTree(dir, ref, root, { recursive: true }).catch(() => [])).filter((e) => e.type === 'blob' && IMAGE.test(e.name))
    for (const f of files) {
      const entry = { ...f, rel: f.path.slice(root.length + 1) }
      const game = gameOf(entry, section, byLength, aliases)
      const { label, device } = labelOf(entry, game, section, aliases)
      const sections = byGame.get(game) ?? new Map()
      const key = `${section.title}`
      const list = sections.get(key) ?? { id: section.dir, title: section.title, note: section.note, items: [] }
      list.items.push({ sha: f.sha, name: f.name, label, device, path: f.path.slice(studio.length + 1) })
      sections.set(key, list)
      byGame.set(game, sections)
      blobs.set(f.sha, f.name)
    }
  }
  for (const sections of byGame.values()) for (const s of sections.values()) s.items.sort((a, b) => (a.device ?? '').localeCompare(b.device ?? '') || a.label.localeCompare(b.label, undefined, { numeric: true }))
  galleries = { commit: commit.sha, short: commit.short, byGame, blobs }
}

/** One game's gallery: its sections and pictures (names only, nothing fetched yet). */
export function gallery(game) {
  const sections = galleries.byGame.get(game)
  return {
    game,
    revision: galleries.short ?? null,
    sections: sections ? [...sections.values()] : [],
    counts: Object.fromEntries([...galleries.byGame].map(([g, s]) => [g, [...s.values()].reduce((n, x) => n + x.items.length, 0)])),
  }
}

/** Copy the asked-for pictures out of git into the cache; only ones the gallery listed. */
export async function galleryImages(shas) {
  if (!repo) throw new Error('The studio repo has not been read yet.')
  const out = {}
  for (const sha of shas.slice(0, 80)) {
    const name = galleries.blobs.get(sha)
    if (!name) continue
    out[sha] = await cacheBlob(repo.dir, sha, name).catch(() => null)
  }
  return out
}

function titleFromReadme(md, fallback) {
  const h = md.match(/^#\s+(.+)$/m)?.[1] ?? fallback
  return h.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/** The README's own **Status:** line, if it has one. */
function statusFromReadme(md) {
  const m = md.match(/\*\*Status:?\s*([^*]+)\*\*/i)
  return m ? m[1].replace(/[.\s]+$/, '').trim() : null
}

function taglineFromReadme(md) {
  return md.match(/^>\s*"?(.+?)"?\s*$/m)?.[1] ?? null
}

/** Latest dated heading in a playtest report, and how much is runtime-verified. */
function playtestSummary(md) {
  const heads = [...md.matchAll(/^#{1,3}\s+(.+?\((\d{4}-\d{2}-\d{2})[^)]*\).*)$/gm)]
  const latest = heads.map((m) => ({ heading: m[1].trim(), date: m[2] })).sort((a, b) => a.date.localeCompare(b.date)).pop()
  return {
    latest: latest ?? null,
    runtimeVerified: (md.match(/RUNTIME VERIFIED/g) ?? []).length,
    staticallyChecked: (md.match(/STATICALLY CHECKED/g) ?? []).length,
    pass: (md.match(/\bPASS\b/g) ?? []).length,
    fail: (md.match(/\bFAIL\b/g) ?? []).length,
  }
}

function workerOf(t) {
  return t.lease?.worker ?? t.history?.at(-1)?.worker ?? null
}

async function refresh(cfg) {
  const studio = cfg.studioPath.replace(/\/$/, '')
  const ref = `refs/jarvis/${NAME}`
  if (!repo) {
    repo = await locateRepo({
      name: 'traderedge',
      url: cfg.repo,
      branch: cfg.branch,
      candidates: cfg.repoCandidates.map(expand),
    })
  }
  const commit = await fetchRef(repo.dir, NAME, cfg.branch)
  const queue = JSON.parse(await showText(repo.dir, ref, `${studio}/queue/tasks.json`))
  const places = JSON.parse(await showText(repo.dir, ref, `${studio}/publish/places.json`).catch(() => '{}'))
  const gameDirs = (await listTree(repo.dir, ref, `${studio}/games`)).filter((e) => e.type === 'tree')
  const logoDirs = new Map(
    (await listTree(repo.dir, ref, `${studio}/assets/logos`).catch(() => []))
      .filter((e) => e.type === 'tree')
      .map((e) => [e.name, e]),
  )
  const playtests = new Map(
    (await listTree(repo.dir, ref, `${studio}/evidence/playtests`).catch(() => []))
      .filter((e) => e.name.endsWith('.md'))
      .map((e) => [e.name.replace(/\.md$/, ''), e]),
  )

  const tasks = queue.tasks ?? []
  const games = []
  const keepPreviews = []
  for (const dir of gameDirs) {
    const id = dir.name
    const readme = await showText(repo.dir, ref, `${dir.path}/README.md`).catch(() => '')
    const pt = playtests.has(id)
      ? playtestSummary(await showText(repo.dir, ref, playtests.get(id).path).catch(() => ''))
      : null
    let art = {}
    if (logoDirs.has(id)) {
      const files = await listTree(repo.dir, ref, logoDirs.get(id).path)
      const pick = (re) => files.find((f) => re.test(f.name))
      for (const [key, re] of [
        ['thumbnail', /^thumb.*\.(jpe?g|png)$/i],
        ['hero', /^hero.*\.(jpe?g|png)$/i],
        ['icon', /^icon_512\.png$|^icon.*\.png$/i],
      ]) {
        const f = pick(re)
        if (f) art[key] = await cacheBlob(repo.dir, f.sha, f.name).catch(() => null)
      }
      art.alternates = files.filter((f) => /^alt_/i.test(f.name)).map((f) => f.name)
      art.count = files.length
    }
    const mine = tasks.filter((t) => t.game === id)
    const count = (s) => mine.filter((t) => t.state === s).length
    const place = places[id]
    games.push({
      id,
      name: titleFromReadme(readme, id),
      tagline: taglineFromReadme(readme),
      readmeStatus: statusFromReadme(readme),
      published: Boolean(place?.placeId),
      placeId: place?.placeId ?? null,
      playtest: pt,
      art,
      tasks: { running: count('running'), queued: count('ready'), blocked: count('blocked'), done: count('done') },
      active: queue.active_game === id,
      next: queue.next_game === id,
    })
    for (const key of ['hero', 'thumbnail', 'icon']) {
      if (!art[key]) continue
      const pid = `roblox:${id}:${key}`
      keepPreviews.push(pid)
      hub.setPreview({
        id: pid,
        project: 'roblox',
        game: id,
        kind: 'ASSET',
        title: `${key} render`,
        file: art[key],
        revision: commit.short,
        capturedAt: commit.committedAt,
        note: 'Render committed to the studio repo; not a live gameplay capture.',
      })
    }
  }
  hub.prunePreviews('roblox', keepPreviews)
  await buildGalleries(repo.dir, ref, studio, games.map((g) => g.id), commit).catch((err) => console.warn('[hub] roblox gallery:', err.message))

  // Tasks → jobs. Everything still open, plus what finished in the last 3 days.
  const recent = Date.now() - 3 * 86400000
  const jobIds = []
  for (const t of tasks) {
    const lastAt = (t.history?.at(-1)?.at ?? 0) * 1000
    if (t.state === 'done' && lastAt < recent) continue
    const id = `roblox:${t.id}`
    jobIds.push(id)
    const lease = t.lease
      ? { worker: t.lease.worker, claimedAt: t.lease.claimed_at * 1000, expiresAt: t.lease.expires_at * 1000 }
      : null
    hub.upsertJob({
      id,
      source: 'roblox',
      project: 'roblox',
      game: t.game,
      title: t.title,
      taskId: t.id,
      state: STATE_MAP[t.state] ?? 'waiting',
      sourceState: t.state,
      stage: t.current_step,
      nextStep: t.next_step,
      worker: workerOf(t),
      who: t.who,
      model: t.model,
      revision: t.revision,
      priority: t.priority,
      lease,
      // A lease past its expiry with no newer history is a lost heartbeat.
      expectsHeartbeat: t.state === 'running',
      heartbeatAt: lastAt || commit.committedAt,
      staleAfterMs: lease ? Math.max(60000, lease.expiresAt - (lastAt || lease.claimedAt)) : undefined,
      blocker: t.state === 'blocked' ? t.next_step : null,
      summary: (t.objective ?? '').slice(0, 400),
      acceptance: t.acceptance ?? [],
      attempts: t.attempts ?? 0,
      updatedAt: Math.max(lastAt, 1),
      cancel: 'unsupported',
    })
    for (const h of t.history ?? []) {
      if (h.at * 1000 < recent) continue
      hub.activity({
        id: `roblox:${t.id}:${h.at}`,
        ts: h.at * 1000,
        source: 'roblox',
        project: 'roblox',
        title: `${t.id} · ${h.event.split(':')[0]}`,
        detail: `${t.title} — ${h.event}`.slice(0, 500),
        level: /^failed/.test(h.event) ? 'error' : /^done|^passed/.test(h.event) ? 'success' : 'info',
        ref: { kind: 'job', id },
      })
    }
  }
  hub.pruneJobs('roblox', jobIds)

  // The studio's own "needs Markus" list.
  for (const h of queue.human ?? []) {
    hub.upsertItem({
      id: `roblox:${h.id}`,
      source: 'roblox',
      project: 'roblox',
      title: h.what,
      why: h.unlocks ? `Unblocks ${h.unlocks} in the Roblox studio queue.` : 'Requested by the Roblox studio queue.',
      instructions: h.how,
      destination: queue.pc_session ? { label: 'Open the PC Roblox session', url: queue.pc_session } : null,
      prepared: 'The studio queue wrote the exact steps.',
      verify: { kind: 'source', note: 'Resolves when the studio queue marks it done (the PC pushes that to GitHub).' },
      resumes: h.unlocks ? `The studio resumes ${h.unlocks} on its own.` : null,
      // Blocking a named task is P1. Optional asks never are.
      priority: /^optional/i.test(h.what ?? '') ? 'P3' : /\b[A-Z]+-\d+\b/.test(h.unlocks ?? '') ? 'P1' : 'P2',
      state: h.state === 'done' ? 'resolved' : 'open',
      actions: [
        { kind: 'copy', label: 'Copy steps', value: h.how },
        ...(queue.pc_session ? [{ kind: 'open', label: 'Open PC session', url: queue.pc_session }] : []),
        { kind: 'check', label: 'Check again' },
      ],
    })
  }

  hub.setProject('roblox', {
    id: 'roblox',
    name: 'Roblox Studio',
    source: {
      repo: cfg.repo,
      branch: cfg.branch,
      path: repo.managed ? 'managed copy in ~/.jarvis/repos' : repo.dir,
      commit,
      fetchedAt: Date.now(),
    },
    worker: { ...cfg.worker, lastSeenAt: commit.committedAt },
    activeGame: queue.active_game ?? null,
    nextGame: queue.next_game ?? null,
    backlog: queue.backlog ?? [],
    pcSession: queue.pc_session ?? null,
    games,
    live: {
      available: false,
      reason:
        'Live gameplay needs a running Studio session streamed from the Windows PC; no capture path is connected yet. Showing committed renders and the latest playtest report.',
    },
  })
  return commit
}

/** Run now and then every few minutes. Failures become a Needs Markus item. */
export function startRoblox(initial) {
  let cfg = initial
  const run = async () => {
    try {
      cfg = loadConfig().roblox
      const commit = await refresh(cfg)
      if (!last.ok) {
        hub.activity({ source: 'roblox', project: 'roblox', title: `Studio queue read at ${commit.short}`, level: 'success' })
      }
      last = { ok: true, error: null, at: Date.now() }
      const item = hub.getItem('roblox:repo-access')
      if (item && item.state !== 'resolved') hub.upsertItem({ id: 'roblox:repo-access', state: 'resolved' }, { fromSource: false })
    } catch (err) {
      last = { ok: false, error: err.message, at: Date.now() }
      console.warn('[hub] roblox:', err.message)
      hub.setProject('roblox', { ...(hub.snapshot().projects.roblox ?? { id: 'roblox', name: 'Roblox Studio' }), error: err.message })
      hub.upsertItem({
        id: 'roblox:repo-access',
        source: 'jarvis',
        project: 'roblox',
        title: 'Let JARVIS read your Roblox studio repo',
        why: `The studio queue lives in the private GitHub repo markusbrown123/traderedge, and this Mac could not fetch it (${err.message}).`,
        instructions:
          'In Terminal: git clone https://github.com/markusbrown123/traderedge ~/traderedge  — sign in when asked (or run gh auth login first). JARVIS only reads it.',
        destination: { label: 'GitHub repo', url: 'https://github.com/markusbrown123/traderedge' },
        prepared: 'JARVIS already knows the branch and folder to read.',
        verify: { kind: 'roblox-fetch', note: 'Resolves when a fetch of the studio branch succeeds.' },
        resumes: 'The Roblox view fills in automatically.',
        priority: 'P1',
        actions: [
          { kind: 'copy', label: 'Copy clone command', value: 'git clone https://github.com/markusbrown123/traderedge ~/traderedge' },
          { kind: 'check', label: 'Check again' },
        ],
      })
    }
  }
  void run()
  setInterval(run, Math.max(1, cfg.refreshMinutes) * 60000).unref()
  return { refresh: run, status: () => last }
}
