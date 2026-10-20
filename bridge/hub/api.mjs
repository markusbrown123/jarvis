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
import * as hub from './store.mjs'
import { CONFIG_FILE, loadConfig, saveConfig } from './config.mjs'
import { startRoblox } from './roblox.mjs'
import { startAutomaton } from './automaton.mjs'
import { startFinance } from './finance.mjs'

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

export function startHub({ runner, phone } = {}) {
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

  return async function hubApi(req, res, cors, originOk) {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    const authed = originOk || tokenOk(req, token)
    if (!authed) return json(res, cors, 401, { error: 'unauthorized' })

    try {
      if (req.method === 'GET' && path === '/api/state') return json(res, cors, 200, hub.snapshot())

      if (req.method === 'GET' && path === '/api/stream') {
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        const send = (snap) => res.write(`event: state\ndata: ${JSON.stringify(snap)}\n\n`)
        send(hub.snapshot())
        const off = hub.subscribe(send)
        res.write(`event: term\ndata: ${JSON.stringify(hub.termBacklog())}\n\n`)
        const offTerm = hub.termSubscribe((line) => res.write(`event: term\ndata: ${JSON.stringify([line])}\n\n`))
        const ping = setInterval(() => res.write(': ping\n\n'), 25000)
        req.on('close', () => {
          off()
          offTerm()
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
        let n = 0
        for (const a of body.activity ?? []) n += hub.activity({ ...a, source: a.source ?? 'worker' }) ? 1 : 0
        for (const j of body.jobs ?? []) n += hub.upsertJob({ ...j, source: j.source ?? 'worker' }) ? 1 : 0
        return json(res, cors, 200, { ok: true, applied: n })
      }

      let m = path.match(/^\/api\/items\/([^/]+)\/(check|snooze|start|cancel|reopen)$/)
      if (req.method === 'POST' && m) {
        const id = decodeURIComponent(m[1])
        const item = hub.getItem(id)
        if (!item) return json(res, cors, 404, { error: 'no such item' })
        const action = m[2]
        if (action === 'check') {
          hub.upsertItem({ id, state: 'verifying' }, { fromSource: false })
          const result = await verify(item)
          const next = result.ok ? 'resolved' : item.state === 'verifying' ? 'open' : item.state
          hub.upsertItem({ id, state: next, lastCheck: { at: Date.now(), ...result } }, { fromSource: false })
          return json(res, cors, 200, { ok: true, result, item: hub.getItem(id) })
        }
        if (action === 'snooze') {
          const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? 4)))
          hub.upsertItem({ id, state: 'snoozed', snoozedUntil: Date.now() + hours * 3600000 }, { fromSource: false })
        }
        if (action === 'start') hub.upsertItem({ id, state: 'in_progress' }, { fromSource: false })
        if (action === 'cancel') hub.upsertItem({ id, state: 'canceled' }, { fromSource: false })
        if (action === 'reopen') hub.upsertItem({ id, state: 'open', snoozedUntil: null }, { fromSource: false })
        return json(res, cors, 200, { ok: true, item: hub.getItem(id) })
      }

      // Start a background job from the dashboard (same runner as voice).
      if (req.method === 'POST' && path === '/api/jobs/start') {
        if (!runner) return json(res, cors, 503, { error: 'Background jobs are not available.' })
        const body = JSON.parse(await readBody(req))
        const title = String(body.title ?? '').trim().slice(0, 120)
        const instructions = String(body.instructions ?? '').trim().slice(0, 8000)
        const project = ['roblox', 'automaton', 'finance', 'other'].includes(body.project) ? body.project : 'other'
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

      m = path.match(/^\/api\/refresh\/(roblox|automaton|finance)$/)
      if (req.method === 'POST' && m) {
        await sources[m[1]].refresh()
        return json(res, cors, 200, { ok: true })
      }

      if (req.method === 'POST' && path === '/api/presence') {
        hub.observePresence({ where: 'dashboard' })
        return json(res, cors, 200, { ok: true })
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
}
