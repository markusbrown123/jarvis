/**
 * The desk's Claude Code terminal.
 *
 * Real Claude Code sessions — the same agent and tools as the CLI — run in
 * one of Markus's project folders and stream into the station's desk as they
 * work: what it says, each tool it uses, and what came back. A follow-up
 * continues the same session (the SDK resumes it by id), Stop aborts the turn
 * in flight, and the session stays open for the next thing.
 *
 * Permissions are the bridge's own gate. With write mode on (plain `jarvis`)
 * Claude Code edits files and runs commands in the project the way it would
 * in a terminal. Read-only (`jarvis --safe`), anything that would change
 * something is put to Markus at the desk — allow once, or deny — since he's
 * right there; a turn that is stopped denies whatever was waiting.
 *
 * The project's CLAUDE.md goes into the system prompt the way the CLI loads
 * it. Its settings files are not loaded, so no allow rule in them can get
 * past the gate.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { cwdFor } from './runner.mjs'
import * as hub from './store.mjs'
import { BASE_PROJECTS } from './streams.mjs'

export const PROJECTS = ['jarvis', 'automaton', 'roblox', 'finance', ...BASE_PROJECTS, 'other']
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_LINES = 800
const MAX_SESSIONS = 8

const APPEND =
  'You are Claude Code running at JARVIS’s desk: Markus is watching this session live and can reply. ' +
  'Work as you would in his terminal. Keep prose short; the work shows in the tool calls. ' +
  'Never send messages, emails or calls, never deploy, publish or pay, and never touch live customer data, ' +
  'unless he asks you to in this session.'

/** CLAUDE.md as the CLI reads it: the file, with its `@path` imports inlined (one level, inside the project). */
function claudeMd(cwd) {
  const file = join(cwd, 'CLAUDE.md')
  if (!existsSync(file)) return ''
  const text = readFileSync(file, 'utf8').replace(/^@(\S+)\s*$/gm, (line, p) => {
    const f = resolve(cwd, p)
    return f.startsWith(cwd) && existsSync(f) ? readFileSync(f, 'utf8') : line
  })
  return `\n\nProject instructions (${join(cwd, 'CLAUDE.md')}):\n${text.slice(0, 40000)}`
}

/** The text a tool result carried. */
function resultText(block) {
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((x) => (x?.type === 'text' ? x.text : '')).join('\n')
  return ''
}

export function createCode({ model, effort, decide, writes }) {
  const sessions = new Map()
  const listeners = new Set()
  let lineSeq = 0
  let askSeq = 0

  const meta = (s) => ({
    id: s.id,
    project: s.project,
    cwd: s.cwd,
    title: s.title,
    state: s.state,
    approval: s.approval ? { id: s.approval.id, tool: s.approval.tool, detail: s.approval.detail } : null,
    cost: s.cost,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })
  const emit = (e) => {
    for (const fn of listeners) fn(e)
  }
  const touch = (s) => {
    s.updatedAt = Date.now()
    emit({ op: 'meta', session: meta(s) })
  }
  const add = (s, kind, text) => {
    if (!text) return
    const line = { n: ++lineSeq, kind, text: String(text).slice(0, 6000), at: Date.now() }
    s.lines.push(line)
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES)
    s.updatedAt = line.at
    emit({ op: 'line', session: meta(s), line })
    // The dashboard's terminal shows it too, a line at a time.
    if (kind === 'text' || kind === 'tool' || kind === 'error') hub.term(`claude:${s.project}`, text, kind === 'tool' ? 'tool' : kind === 'error' ? 'error' : 'text')
  }

  /** Paths read relative to the project, as the CLI shows them. */
  const rel = (s, p) => {
    const r = relative(s.cwd, String(p))
    return r && !r.startsWith('..') ? r : String(p)
  }
  const label = (s, name, input = {}) => {
    const path = input.file_path ?? input.notebook_path ?? input.path
    const arg = path ? rel(s, path) : input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? ''
    return `${name}(${String(arg).replace(/\s+/g, ' ').slice(0, 140)})`
  }
  /** What a held action would do, for Markus to decide on. */
  const detail = (s, name, input = {}) => {
    if (name === 'Bash') return String(input.command ?? '').slice(0, 1200)
    if (name === 'Edit' || name === 'MultiEdit') {
      const edits = input.edits ?? [{ old_string: input.old_string, new_string: input.new_string }]
      return edits
        .slice(0, 3)
        .map((e) => `- ${String(e.old_string ?? '').slice(0, 300)}\n+ ${String(e.new_string ?? '').slice(0, 300)}`)
        .join('\n')
    }
    if (name === 'Write') return `${rel(s, input.file_path ?? '')}\n${String(input.content ?? '').slice(0, 600)}`
    return JSON.stringify(input).slice(0, 800)
  }
  /** One short line for what a tool brought back, like the CLI's ⎿. */
  const summary = (name, text, isError) => {
    const lines = text.split('\n').filter((l) => l.trim())
    if (isError) return lines[0] ?? 'failed'
    if (name === 'Read') return `${lines.length} lines`
    if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') return 'done'
    if (name === 'Grep' || name === 'Glob') return lines.length ? `${lines.length} found` : 'nothing found'
    if (name === 'TodoWrite') return ''
    if (!lines.length) return '(no output)'
    const head = lines.slice(0, 4).join('\n')
    return lines.length > 4 ? `${head}\n… ${lines.length - 4} more lines` : head
  }

  /** The gate, with Markus in the loop for anything it wouldn't allow by itself. */
  async function gate(s, name, input, opts = {}) {
    if (decide(name)) return { behavior: 'allow', updatedInput: input }
    const id = `${s.id}:ask${++askSeq}`
    const allow = await new Promise((res) => {
      s.approval = { id, tool: label(s, name, input), detail: detail(s, name, input), resolve: res }
      s.state = 'approval'
      touch(s)
      opts.signal?.addEventListener('abort', () => res(false), { once: true })
    })
    s.approval = null
    if (s.state === 'approval') s.state = 'working'
    add(s, 'note', `${allow ? 'Allowed once' : 'Denied'}: ${label(s, name, input)}`)
    touch(s)
    return allow
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Markus denied this at the desk. Do not retry it; say what you would have done instead.' }
  }

  function turn(s, text) {
    const abort = new AbortController()
    s.abort = abort
    s.state = 'working'
    add(s, 'you', text)
    touch(s)
    const session = query({
      prompt: text,
      options: {
        abortController: abort,
        cwd: s.cwd,
        model,
        effort,
        ...(s.sdkId ? { resume: s.sdkId } : {}),
        maxTurns: 80,
        settingSources: [],
        permissionMode: 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND + claudeMd(s.cwd) },
        canUseTool: (name, input, opts) => gate(s, name, input, opts),
      },
    })
    ;(async () => {
      const tools = new Map()
      try {
        for await (const msg of session) {
          if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) s.sdkId = msg.session_id
          else if (msg.type === 'assistant') {
            for (const b of msg.message?.content ?? []) {
              if (b.type === 'text' && b.text.trim()) add(s, 'text', b.text.trim())
              if (b.type === 'tool_use') {
                tools.set(b.id, b.name)
                if (b.name === 'TodoWrite') add(s, 'tool', `Plan: ${(b.input?.todos ?? []).map((t) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'} ${t.content}`).join('  ')}`)
                else add(s, 'tool', label(s, b.name, b.input))
              }
            }
          } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
            for (const b of msg.message.content) {
              if (b.type !== 'tool_result') continue
              const out = summary(tools.get(b.tool_use_id) ?? '', resultText(b), b.is_error)
              if (out) add(s, b.is_error ? 'error' : 'out', out)
            }
          } else if (msg.type === 'result') {
            s.cost += msg.total_cost_usd ?? 0
            hub.observeRequest({
              id: msg.uuid,
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
              cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
              costUsd: msg.total_cost_usd ?? 0,
            })
            if (msg.subtype !== 'success' || msg.is_error) add(s, 'error', `Ended early: ${msg.subtype}`)
          }
        }
      } catch (err) {
        if (abort.signal.aborted) add(s, 'note', 'Stopped.')
        else add(s, 'error', String(err?.message ?? err).slice(0, 400))
      } finally {
        if (abort.signal.aborted && s.lines.at(-1)?.text !== 'Stopped.') add(s, 'note', 'Stopped.')
        s.approval?.resolve(false)
        s.approval = null
        s.abort = null
        s.state = 'ready'
        touch(s)
      }
    })()
  }

  const prompt = (p) => {
    const text = String(p ?? '').trim().slice(0, 20000)
    if (!text) throw new Error('Say what Claude Code should do.')
    return text
  }
  const busy = (s) => s.state === 'working' || s.state === 'approval'
  const need = (id) => {
    const s = sessions.get(id)
    if (!s) throw Object.assign(new Error('No such session.'), { status: 404 })
    return s
  }

  return {
    writes,
    projects: PROJECTS,
    list: () => [...sessions.values()].map((s) => ({ ...meta(s), lines: s.lines })),
    start({ project, prompt: p }) {
      const text = prompt(p)
      const proj = PROJECTS.includes(project) ? project : 'other'
      // Room for one more: the oldest idle session goes.
      if (sessions.size >= MAX_SESSIONS) {
        const idle = [...sessions.values()].filter((x) => !busy(x)).sort((a, b) => a.updatedAt - b.updatedAt)[0]
        if (!idle) throw new Error(`${MAX_SESSIONS} sessions are working; stop one first.`)
        sessions.delete(idle.id)
        emit({ op: 'gone', id: idle.id })
      }
      const now = Date.now()
      const s = {
        id: `code-${now.toString(36)}`,
        project: proj,
        cwd: proj === 'jarvis' ? REPO : cwdFor(proj),
        title: text.split('\n')[0].slice(0, 80),
        sdkId: null,
        state: 'ready',
        lines: [],
        approval: null,
        abort: null,
        cost: 0,
        createdAt: now,
        updatedAt: now,
      }
      sessions.set(s.id, s)
      add(s, 'note', `Claude Code in ${s.cwd} · ${writes ? 'write mode: it can edit files and run commands' : 'read-only: changes ask you first'}`)
      turn(s, text)
      return meta(s)
    },
    send(id, p) {
      const s = need(id)
      const text = prompt(p)
      if (busy(s)) throw new Error('Still working on the last one: wait, or stop it first.')
      turn(s, text)
      return meta(s)
    },
    stop(id) {
      const s = need(id)
      s.abort?.abort()
      return meta(s)
    },
    approve(id, askId, allow) {
      const s = need(id)
      if (!s.approval || s.approval.id !== askId) throw new Error('Nothing is waiting on that.')
      s.approval.resolve(Boolean(allow))
      return meta(s)
    },
    close(id) {
      const s = need(id)
      s.abort?.abort()
      sessions.delete(id)
      emit({ op: 'gone', id })
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
