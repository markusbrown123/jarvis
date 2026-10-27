/**
 * The command center's HTTP surface, mounted on the bridge under /api/.
 *
 * Who may call it: the JARVIS page itself (an allowed Origin, already checked
 * by the bridge before this runs) or a local script presenting the token in
 * ~/.jarvis/token (Claude Code hooks, the status line, a remote worker). A
 * request with neither is refused — reading project state included.
 *
 * Nothing here executes anything a payload asks for. Hook and status line
 * bodies are data: they update jobs, items and usage, and that is all.
 */

import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import { CONFIG_FILE, loadConfig, saveConfig } from './config.mjs'
import { gallery, galleryImages, startRoblox } from './roblox.mjs'
import { startAutomaton } from './automaton.mjs'
import { startFinance } from './finance.mjs'
import * as ledger from './expenses.mjs'
import * as memory from './memory.mjs'
import * as ideas from './ideas.mjs'
import { BASE_PROJECTS, all as allStreams } from './streams.mjs'
import * as walkthroughs from './walkthroughs.mjs'
import * as leadengine from './leadengine.mjs'
import * as review from './review.mjs'
import * as autopilot from './autopilot.mjs'

const MAX_BODY = 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, cors, status, body) {
  res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function tokenOk(req, token) {
  const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!got || got.length !== token.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(token))
}

/** Which project a Claude Code session belongs to, from its folder. */
function projectFor(cwd = '') {
  const c = cwd.toLowerCase()
  if (c.includes('robloxstudio') || c.includes('traderedge')) return 'roblox'
  if (c.includes('automaton')) return 'automaton'
  if (c.includes('master-hub') || c.includes('futures') || c.includes('insideredge')) return 'finance'
  if (c.endsWith('/jarvis') || c.includes('/jarvis/')) return 'jarvis'
  return 'other'
}

const base = (p = '') => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/**
 * Claude Code hook → hub. A session is a job: running while it works,
 * waiting between turns, needs_markus while a permission prompt is up.
 * Only tool names and their human-written descriptions are kept — never
 * commands, file contents or prompts.
 */
function onHook(e) {
  if (!e?.session_id || !e.hook_event_name) return
  const id = `claude:${e.session_id}`
  const project = projectFor(e.cwd)
  const title = `Claude Code · ${base(e.cwd) || 'session'}`
  const at = Date.now()
  const job = { id, source: 'claude', project, title, worker: 'Claude Code', cwd: e.cwd, sessionId: e.session_id, updatedAt: at, heartbeatAt: at, cancel: 'unsupported' }
  const tool = e.tool_name ? `${e.tool_name}${e.tool_input?.description ? ` — ${String(e.tool_input.description).slice(0, 80)}` : ''}` : null
  const permItem = `claude-permission:${e.session_id}`

  switch (e.hook_event_name) {
    case 'SessionStart':
      hub.upsertJob({ ...job, state: 'waiting', stage: 'session started', expectsHeartbeat: false })
      break
    case 'UserPromptSubmit':
      hub.term(`claude:${base(e.cwd) || 'session'}`, 'new prompt — working', 'info')
      hub.upsertJob({ ...job, state: 'running', stage: 'working on a prompt', expectsHeartbeat: true, staleAfterMs: 15 * 60000 })
      break
    case 'PreToolUse':
    case 'PostToolUse':
      hub.upsertJob({ ...job, state: 'running', stage: tool ?? 'using a tool', expectsHeartbeat: true, staleAfterMs: 15 * 60000 })
      // The terminal shows what is being worked on: the tool, its own
      // one-line description, and for file tools the file name — never
      // commands or contents.
      if (e.hook_event_name === 'PreToolUse') {
        const file = e.tool_input?.file_path ? ` ${base(e.tool_input.file_path)}` : ''
        hub.term(`claude:${base(e.cwd) || 'session'}`, `${e.tool_name ?? 'tool'}${file}${e.tool_input?.description ? ` — ${String(e.tool_input.description).slice(0, 100)}` : ''}`, 'tool')
      }
      if (hub.getItem(permItem)?.state === 'open') hub.upsertItem({ id: permItem, state: 'resolved' }, { fromSource: false })
      break
    case 'PostToolUseFailure':
      hub.activity({ source: 'claude', project, title: `${title}: ${e.tool_name ?? 'tool'} failed`, level: 'warn', ref: { kind: 'job', id } })
      break
    case 'PermissionRequest':
    case 'Notification': {
      const isPermission = e.hook_event_name === 'PermissionRequest' || e.notification_type === 'permission_prompt' || /permission/i.test(e.message ?? '')
      if (!isPermission) {
        if (e.notification_type === 'idle_prompt') hub.upsertJob({ ...job, state: 'waiting', stage: 'waiting for your next message', expectsHeartbeat: false })
        break
      }
      hub.upsertJob({ ...job, state: 'needs_markus', stage: `asking to use ${e.tool_name ?? 'a tool'}`, expectsHeartbeat: false })
      hub.upsertItem({
        id: permItem,
        source: 'claude',
        project,
        title: `Claude in ${base(e.cwd) || 'a session'} is asking permission${e.tool_name ? ` to use ${e.tool_name}` : ''}`,
        why: 'That session is paused until you answer its permission prompt.',
        instructions: `Answer it in the Claude Code session running in ${e.cwd}. JARVIS cannot approve it for you — this button only takes you there.`,
        destination: { label: 'Session folder', url: null, path: e.cwd },
        prepared: tool ? `Requested: ${tool}` : null,
        verify: { kind: 'source', note: 'Resolves when that session carries on (its next tool use or turn end).' },
        resumes: 'The session continues by itself once you answer.',
        priority: 'P1',
        state: 'open',
        actions: [{ kind: 'copy', label: 'Copy folder', value: e.cwd ?? '' }],
      })
      break
    }
    case 'PermissionDenied':
      if (hub.getItem(permItem)) hub.upsertItem({ id: permItem, state: 'resolved' }, { fromSource: false })
      break
    case 'Stop':
      hub.upsertJob({ ...job, state: 'waiting', stage: 'turn finished — waiting for you', expectsHeartbeat: false })
      hub.term(`claude:${base(e.cwd) || 'session'}`, 'turn finished', 'success')
      if (hub.getItem(permItem)?.state === 'open') hub.upsertItem({ id: permItem, state: 'resolved' }, { fromSource: false })
      break
    case 'StopFailure':
      hub.upsertJob({ ...job, state: 'failed', stage: 'the turn ended with an error', expectsHeartbeat: false })
      break
    case 'SessionEnd':
      hub.upsertJob({ ...job, state: 'completed', stage: 'session ended', expectsHeartbeat: false })
      if (hub.getItem(permItem)?.state === 'open') hub.upsertItem({ id: permItem, state: 'canceled' }, { fromSource: false })
      break
    case 'SubagentStart':
    case 'SubagentStop':
    case 'TaskCreated':
    case 'TaskCompleted':
      hub.activity({ source: 'claude', project, title: `${title}: ${e.hook_event_name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`, ref: { kind: 'job', id } })
      break
  }
  hub.observeHook(at)
}

/** Claude Code status line JSON → usage. Account-wide windows, newest wins. */
function onStatusLine(s) {
  const at = Date.now()
  if (s?.rate_limits) hub.observeWindows({ windows: s.rate_limits, source: 'Claude Code status line', at })
  if (s?.context_window) hub.observeContext(s.context_window, `session ${String(s.session_id ?? '').slice(0, 8)}`, at)
  hub.observeStatusLine({ at, model: s?.model?.display_name ?? null, version: s?.version ?? null, hasRateLimits: Boolean(s?.rate_limits) })
}

export function startHub({ runner, phone, code } = {}) {
  const token = hub.apiToken()
  let cfg = loadConfig()
  const sources = {
    roblox: startRoblox(cfg.roblox),
    automaton: startAutomaton(cfg.automaton),
    finance: startFinance(cfg.finance),
  }

  // Setup the hub itself needs from Markus, verified rather than assumed.
  const setupItem = () =>
    hub.upsertItem({
      id: 'jarvis:connect-claude-code',
      source: 'jarvis',
      project: 'jarvis',
      title: 'Connect Claude Code to the dashboard (usage + session activity)',
      why: 'Your remaining 5-hour and weekly allowance is only reported to Claude Code’s status line, and session activity only to its hooks. Until they forward to JARVIS, the usage panel shows “unavailable”.',
      instructions:
        'In Terminal: ~/jarvis/bin/jarvis setup-claude  — it backs up ~/.claude/settings.json, keeps any status line you already have, and adds JARVIS’s forwarding (undo with: ~/jarvis/bin/jarvis setup-claude --remove).',
      prepared: 'The status line and hook scripts are written and only forward to this Mac (127.0.0.1).',
      verify: { kind: 'statusline', note: 'Resolves when a status line update arrives from any Claude Code session.' },
      resumes: 'The usage panel fills in on the next Claude Code message.',
      priority: 'P2',
      actions: [
        { kind: 'copy', label: 'Copy setup command', value: '~/jarvis/bin/jarvis setup-claude' },
        { kind: 'check', label: 'Check again' },
      ],
    })
  if (!hub.snapshot().usage.statusLine) setupItem()

  // Live voice from the iPhone: Tailscale, set up once with `jarvis remote`.
  const REMOTE = join(hub.DATA_DIR, 'remote.json')
  if (!existsSync(REMOTE))
    hub.upsertItem({
      id: 'jarvis:iphone-voice',
      source: 'jarvis',
      project: 'jarvis',
      title: 'Talk to JARVIS live from your iPhone',
      why: 'Live voice from the phone needs the page and the bridge on your private Tailscale network over HTTPS — Safari only allows the microphone on a secure page. (Texting and voice notes over Telegram work without this.)',
      instructions:
        'Install Tailscale on this Mac and on your iPhone and sign in to both with the same account; in the Tailscale admin console turn on MagicDNS and HTTPS certificates. Then in Terminal: jarvis remote — it prints the address to open in Safari on the iPhone (Share → Add to Home Screen keeps it one tap away).',
      destination: { label: 'Get Tailscale', url: 'https://tailscale.com/download' },
      prepared: 'The page and bridge already know how to run over Tailscale. Only your own Tailscale login, through Tailscale’s proxy, is accepted; nothing is opened to the internet.',
      verify: { kind: 'remote', note: 'Resolves once jarvis remote has run on this Mac.' },
      resumes: 'Open the address on the iPhone, tap to start, and talk.',
      priority: 'P3',
      actions: [
        { kind: 'copy', label: 'Copy command', value: 'jarvis remote' },
        { kind: 'check', label: 'Check again' },
      ],
    })

  const verify = async (item) => {
    const v = item.verify ?? {}
    const now = Date.now()
    if (v.kind === 'statusline') {
      const at = hub.snapshot().usage.statusLine?.at ?? 0
      return now - at < 15 * 60000 ? { ok: true, detail: 'Status line data received.' } : { ok: false, detail: 'No status line update has arrived yet. Send any message in Claude Code, then check again.' }
    }
    if (v.kind === 'config') {
      cfg = loadConfig()
      const val = v.key.split('.').reduce((o, k) => o?.[k], cfg)
      return val ? { ok: true, detail: `Found ${v.key}.` } : { ok: false, detail: `${v.key} is still empty in ${CONFIG_FILE}.` }
    }
    if (v.kind === 'remote') {
      return existsSync(join(hub.DATA_DIR, 'remote.json')) ? { ok: true, detail: 'Remote access is set up.' } : { ok: false, detail: 'Run jarvis remote in Terminal first.' }
    }
    if (v.kind === 'roblox-fetch') {
      await sources.roblox.refresh()
      const st = sources.roblox.status()
      return st.ok ? { ok: true, detail: 'Fetched the studio branch.' } : { ok: false, detail: st.error }
    }
    // 'source': the source decides; ask it to look again now.
    const src = sources[item.project]
    if (src) await src.refresh()
    const fresh = hub.getItem(item.id)
    return fresh?.state === 'resolved'
      ? { ok: true, detail: 'The source reports it done.' }
      : { ok: null, detail: 'Asked the source to re-check; it still reports this as open.' }
  }

  async function hubApi(req, res, cors, originOk) {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    // A finished walkthrough's review page and cuts: signed links, opened from Needs (walkthroughs.mjs).
    if (req.method === 'GET' && path.startsWith('/api/walkthroughs/') && walkthroughs.serve(req, res, path)) return
    // The lead engine's call sheets, previews and outcome form: signed links, opened from Needs (leadengine.mjs).
    if (path.startsWith('/api/leads/') && (await leadengine.serve(req, res, path))) return
    const authed = originOk || tokenOk(req, token)
    if (!authed) return json(res, cors, 401, { error: 'unauthorized' })

    try {
      if (req.method === 'GET' && path === '/api/state') return json(res, cors, 200, hub.snapshot())

      // A Roblox game's gallery (names from git), and its pictures copied
      // into the cache as they're looked at (only ones the gallery listed).
      if (req.method === 'GET' && path === '/api/roblox/gallery') return json(res, cors, 200, gallery(String(url.searchParams.get('game') ?? '')))
      if (req.method === 'POST' && path === '/api/roblox/images') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const shas = Array.isArray(body.shas) ? body.shas.filter((x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x)) : []
        return json(res, cors, 200, { files: await galleryImages(shas) })
      }

      if (req.method === 'GET' && path === '/api/stream') {
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        const send = (snap) => res.write(`event: state\ndata: ${JSON.stringify(snap)}\n\n`)
        send(hub.snapshot())
        const off = hub.subscribe(send)
        res.write(`event: term\ndata: ${JSON.stringify(hub.termBacklog())}\n\n`)
        const offTerm = hub.termSubscribe((line) => res.write(`event: term\ndata: ${JSON.stringify([line])}\n\n`))
        // The desk's Claude Code sessions: all of them on connect, then each change.
        if (code) res.write(`event: code\ndata: ${JSON.stringify({ op: 'all', writes: code.writes, sessions: code.list() })}\n\n`)
        const offCode = code?.subscribe((e) => res.write(`event: code\ndata: ${JSON.stringify(e)}\n\n`))
        // Ideas: the whole list, now and on every change (it's small).
        res.write(`event: ideas\ndata: ${JSON.stringify(ideas.list())}\n\n`)
        const offIdeas = ideas.subscribe((list) => res.write(`event: ideas\ndata: ${JSON.stringify(list)}\n\n`))
        const ping = setInterval(() => res.write(': ping\n\n'), 25000)
        req.on('close', () => {
          off()
          offTerm()
          offCode?.()
          offIdeas()
          clearInterval(ping)
        })
        return
      }

      if (req.method === 'POST' && path === '/api/hook') {
        onHook(JSON.parse(await readBody(req)))
        return json(res, cors, 200, { ok: true })
      }
      if (req.method === 'POST' && path === '/api/statusline') {
        onStatusLine(JSON.parse(await readBody(req)))
        if (hub.getItem('jarvis:connect-claude-code')?.state === 'open') {
          hub.upsertItem({ id: 'jarvis:connect-claude-code', state: 'resolved' }, { fromSource: false })
        }
        return json(res, cors, 200, { ok: true })
      }

      // A worker posting events: { activity: [...], jobs: [...] }.
      if (req.method === 'POST' && path === '/api/events') {
        const body = JSON.parse(await readBody(req))
        const list = (k) => (Array.isArray(body?.[k]) ? body[k].filter((x) => x && typeof x === 'object') : [])
        if (!body || typeof body !== 'object' || ['activity', 'jobs'].some((k) => body[k] != null && !Array.isArray(body[k]))) {
          return json(res, cors, 400, { error: 'Expected { activity: [...], jobs: [...] }.' })
        }
        let n = 0
        for (const a of list('activity')) n += hub.activity({ ...a, source: a.source ?? 'worker' }) ? 1 : 0
        for (const j of list('jobs')) n += hub.upsertJob({ ...j, source: j.source ?? 'worker' }) ? 1 : 0
        return json(res, cors, 200, { ok: true, applied: n })
      }

      // Undo a Done (store.mjs dismissItem): by its key, from the Needs page's done list.
      if (req.method === 'POST' && path === '/api/dismissed/restore') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const ok = hub.restoreDismissed(String(body.key ?? ''))
        return json(res, cors, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not on the done list.' })
      }

      let m = path.match(/^\/api\/items\/([^/]+)\/(check|snooze|start|cancel|reopen|done)$/)
      if (req.method === 'POST' && m) {
        const id = decodeURIComponent(m[1])
        const item = hub.getItem(id)
        if (!item) return json(res, cors, 404, { error: 'no such item' })
        const action = m[2]
        if (action === 'done') {
          hub.dismissItem(id)
          return json(res, cors, 200, { ok: true, dismissed: id })
        }
        if (action === 'check') {
          hub.upsertItem({ id, state: 'verifying' }, { fromSource: false })
          const result = await verify(item)
          const next = result.ok ? 'resolved' : item.state === 'verifying' ? 'open' : item.state
          hub.upsertItem({ id, state: next, lastCheck: { at: Date.now(), ...result } }, { fromSource: false })
          return json(res, cors, 200, { ok: true, result, item: hub.getItem(id) })
        }
        if (action === 'snooze') {
          // Not a number means the default: NaN would save no wake-up time and snooze it for good.
          const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours')) || 4))
          hub.upsertItem({ id, state: 'snoozed', snoozedUntil: Date.now() + hours * 3600000 }, { fromSource: false })
        }
        if (action === 'start') hub.upsertItem({ id, state: 'in_progress' }, { fromSource: false })
        if (action === 'cancel') hub.upsertItem({ id, state: 'canceled' }, { fromSource: false })
        if (action === 'reopen') hub.upsertItem({ id, state: 'open', snoozedUntil: null }, { fromSource: false })
        return json(res, cors, 200, { ok: true, item: hub.getItem(id) })
      }

      // JARVIS looking back at what Markus has asked for (review.mjs).
      if (req.method === 'POST' && path === '/api/review') {
        if (!runner) return json(res, cors, 503, { error: 'Background jobs are not available.' })
        try {
          return json(res, cors, 200, { ok: true, ...review.run({ runner }) })
        } catch (err) {
          return json(res, cors, 409, { error: err.message })
        }
      }

      // Start a background job from the dashboard (same runner as voice).
      if (req.method === 'POST' && path === '/api/jobs/start') {
        if (!runner) return json(res, cors, 503, { error: 'Background jobs are not available.' })
        const body = JSON.parse(await readBody(req))
        const title = String(body.title ?? '').trim().slice(0, 120)
        const instructions = String(body.instructions ?? '').trim().slice(0, 8000)
        const project = ['roblox', 'automaton', 'finance', ...BASE_PROJECTS, 'other'].includes(body.project) ? body.project : 'other'
        if (!title || !instructions) return json(res, cors, 400, { error: 'Give the job a title and instructions.' })
        try {
          return json(res, cors, 200, { ok: true, ...runner.start({ title, project, instructions }) })
        } catch (err) {
          return json(res, cors, 409, { error: err.message })
        }
      }

      m = path.match(/^\/api\/jobs\/([^/]+)\/cancel$/)
      if (req.method === 'POST' && m) {
        const id = decodeURIComponent(m[1])
        const job = hub.getJob(id)
        if (!job) return json(res, cors, 404, { error: 'no such job' })
        if (job.cancel !== 'supported' || !hub.cancelJob(id)) {
          return json(res, cors, 409, { error: `Cancelling isn't supported for this job (${job.source}). Stop it where it runs.` })
        }
        return json(res, cors, 200, { ok: true, job: hub.getJob(id) })
      }

      // Start or stop a finance research service (its own venv, its own log).
      m = path.match(/^\/api\/finance\/services\/([a-z0-9-]+)\/(start|stop)$/)
      if (req.method === 'POST' && m) {
        try {
          const r = await sources.finance[m[2]](m[1])
          return json(res, cors, 200, { ok: true, ...(r ?? {}) })
        } catch (err) {
          return json(res, cors, 409, { error: err.message })
        }
      }

      m = path.match(/^\/api\/refresh\/(roblox|automaton|finance)$/)
      if (req.method === 'POST' && m) {
        await sources[m[1]].refresh()
        return json(res, cors, 200, { ok: true })
      }

      // The expense ledger, for the dashboard. JARVIS uses the same ledger
      // through its tools.
      // The ledger's own periods only: anything else would be echoed back
      // (and into the CSV's file name) while quietly meaning this month.
      const periodOf = (fallback) => {
        const p = url.searchParams.get('period') ?? fallback
        return /^(this-month|last-month|this-year|all|\d{4}-\d{2})$/.test(p) ? p : fallback
      }
      if (req.method === 'GET' && path === '/api/expenses') {
        const period = periodOf('this-month')
        const list = ledger.listExpenses({ period })
        return json(res, cors, 200, { period, list, summary: ledger.summarize(list) })
      }
      if (req.method === 'GET' && path === '/api/expenses.csv') {
        const period = periodOf('all')
        res.writeHead(200, { ...cors, 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="jarvis-expenses-${period}.csv"` })
        return res.end(ledger.csv(period))
      }
      if (req.method === 'POST' && path === '/api/expenses') {
        try {
          return json(res, cors, 200, { ok: true, expense: ledger.addExpense({ ...JSON.parse(await readBody(req)), source: 'dashboard' }) })
        } catch (err) {
          return json(res, cors, 400, { error: err.message })
        }
      }
      m = path.match(/^\/api\/expenses\/([\w-]+)\/delete$/)
      if (req.method === 'POST' && m) {
        return ledger.deleteExpense(m[1]) ? json(res, cors, 200, { ok: true }) : json(res, cors, 404, { error: 'no such expense' })
      }

      // Memory, for Settings → Memory: add, forget, clear the conversation log.
      if (req.method === 'POST' && path === '/api/memory') {
        const body = JSON.parse(await readBody(req))
        try {
          return json(res, cors, 200, { ok: true, fact: memory.remember({ text: body.text, topic: body.topic, source: 'markus' }) })
        } catch (err) {
          return json(res, cors, 400, { error: err.message })
        }
      }
      m = path.match(/^\/api\/memory\/([\w-]+)\/forget$/)
      if (req.method === 'POST' && m) return memory.forget(m[1]) ? json(res, cors, 200, { ok: true }) : json(res, cors, 404, { error: 'no such memory' })
      if (req.method === 'POST' && path === '/api/memory/clear-conversation') {
        memory.clearConversation()
        return json(res, cors, 200, { ok: true })
      }

      if (req.method === 'POST' && path === '/api/presence') {
        hub.observePresence({ where: 'dashboard' })
        return json(res, cors, 200, { ok: true })
      }

      // The desk's Claude Code terminal (code.mjs).
      if (code && req.method === 'POST' && path === '/api/code/start') {
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          return json(res, cors, 200, { ok: true, session: code.start({ project: body.project, prompt: body.prompt }) })
        } catch (err) {
          return json(res, cors, 409, { error: err.message })
        }
      }
      m = path.match(/^\/api\/code\/([\w-]+)\/(send|stop|approve|close)$/)
      if (code && req.method === 'POST' && m) {
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          if (m[2] === 'send') return json(res, cors, 200, { ok: true, session: code.send(m[1], body.prompt) })
          if (m[2] === 'stop') return json(res, cors, 200, { ok: true, session: code.stop(m[1]) })
          if (m[2] === 'approve') return json(res, cors, 200, { ok: true, session: code.approve(m[1], String(body.ask ?? ''), body.allow === true) })
          code.close(m[1])
          return json(res, cors, 200, { ok: true })
        } catch (err) {
          return json(res, cors, err.status ?? 409, { error: err.message })
        }
      }

      // Ideas (ideas.mjs): add, change, delete. JARVIS works on them through his tools.
      if (req.method === 'GET' && path === '/api/ideas') return json(res, cors, 200, { ideas: ideas.list() })
      // The streams of work, from their bases (streams.mjs): the Projects page.
      if (req.method === 'GET' && path === '/api/streams') return json(res, cors, 200, { streams: allStreams(), links: loadConfig().finance.links ?? [], autopilot: autopilot.status() })
      // JARVIS building a project himself (autopilot.mjs): now, pause/resume, or Markus's word on it.
      const ap = path.match(/^\/api\/autopilot\/([a-z]+)\/(run|pause|note)$/)
      if (req.method === 'POST' && ap) {
        const [, project, what] = ap
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          if (what === 'run') {
            if (!runner) return json(res, cors, 503, { error: 'Background jobs are not available.' })
            const r = autopilot.work(project, { runner })
            return json(res, cors, r.started ? 200 : 409, r.started ? { ok: true, ...r } : { error: r.why })
          }
          if (what === 'pause') autopilot.setPaused(project, body.paused !== false)
          if (what === 'note') autopilot.note(project, String(body.text ?? ''))
          return json(res, cors, 200, { ok: true, autopilot: autopilot.status() })
        } catch (err) {
          return json(res, cors, 400, { error: err.message })
        }
      }
      if (req.method === 'POST' && path === '/api/ideas') {
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          return json(res, cors, 200, { ok: true, idea: ideas.add({ text: body.text, project: body.project, source: 'desk' }) })
        } catch (err) {
          return json(res, cors, 400, { error: err.message })
        }
      }
      m = path.match(/^\/api\/ideas\/([\w-]+)(\/delete)?$/)
      if (req.method === 'POST' && m) {
        if (m[2]) return ideas.remove(m[1]) ? json(res, cors, 200, { ok: true }) : json(res, cors, 404, { error: 'no such idea' })
        try {
          return json(res, cors, 200, { ok: true, idea: ideas.update(m[1], JSON.parse((await readBody(req)) || '{}')) })
        } catch (err) {
          return json(res, cors, err.status ?? 400, { error: err.message })
        }
      }

      m = path.match(/^\/api\/phone\/(pair|unpair|settings|test)$/)
      if (req.method === 'POST' && m) {
        if (!phone) return json(res, cors, 503, { error: 'The phone link is not running.' })
        const body = JSON.parse((await readBody(req)) || '{}')
        if (m[1] === 'pair') return json(res, cors, 200, { ok: true, pairing: phone.newPairingCode() })
        if (m[1] === 'unpair') phone.unpair()
        if (m[1] === 'settings') phone.settings(body)
        if (m[1] === 'test') {
          try {
            await phone.test(String(body.channel ?? 'telegram'))
          } catch (err) {
            return json(res, cors, 409, { error: err.message })
          }
        }
        return json(res, cors, 200, { ok: true })
      }

      if (req.method === 'POST' && path === '/api/config/quant-view') {
        const body = JSON.parse(await readBody(req))
        const link = String(body.url ?? '').trim()
        if (!/^https:\/\/[^\s]+$/.test(link)) return json(res, cors, 400, { error: 'Give an https:// link.' })
        cfg = loadConfig()
        cfg.finance.quantView = { name: String(body.name ?? '').slice(0, 80) || null, url: link }
        saveConfig(cfg)
        await sources.finance.refresh()
        return json(res, cors, 200, { ok: true })
      }

      return json(res, cors, 404, { error: 'not found' })
    } catch (err) {
      return json(res, cors, 400, { error: err.message })
    }
  }
  // The project sources, so JARVIS's tools can ask one to look again.
  hubApi.sources = sources
  return hubApi
}
