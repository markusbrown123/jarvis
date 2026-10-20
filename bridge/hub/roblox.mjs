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
