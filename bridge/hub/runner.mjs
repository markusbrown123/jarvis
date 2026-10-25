/**
 * Background jobs JARVIS starts himself.
 *
 * Each is its own agent session, separate from the conversation: talking to
 * him, interrupting him or telling him to stop talking never touches one. The
 * job's progress goes into the hub (stage = the tool it is using, heartbeat on
 * every message), and cancelling one aborts that session — the job shows
 * "cancellation requested" until the session has actually stopped, and only
 * then "canceled".
 *
 * The same permission gate as the conversation applies: read-only unless the
 * bridge was started with writes enabled.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as hub from './store.mjs'
import * as memory from './memory.mjs'
import { expand, loadConfig } from './config.mjs'
import { BASE_PROJECTS, baseDir } from './streams.mjs'

const MAX_RUNNING = 3

/** Where a job for this project should run: its local repo if there is one. */
export function cwdFor(project) {
  const cfg = loadConfig()
  const pick = (cands = []) => cands.map(expand).find((p) => p && existsSync(join(p, '.git')))
  if (project === 'automaton') return pick(cfg.automaton.repoCandidates) ?? homedir()
  if (project === 'roblox') {
    const repo = pick(cfg.roblox.repoCandidates)
    return repo && existsSync(join(repo, cfg.roblox.studioPath)) ? join(repo, cfg.roblox.studioPath) : repo ?? homedir()
  }
  if (project === 'finance') return pick(cfg.finance.services.flatMap((s) => s.repoCandidates ?? [])) ?? homedir()
  // The newer streams work in their base (bases/<project>), inside JARVIS's own repo.
  if (BASE_PROJECTS.includes(project)) return baseDir(project)
  return homedir()
}

export function createRunner({ model, effort, canUseTool, mcpServers }) {
  const running = new Map()

  function start({ title, project = 'other', instructions, notify = null }) {
    const live = [...running.keys()].filter((id) => hub.getJob(id)?.state === 'running').length
    if (live >= MAX_RUNNING) {
      throw new Error(`${live} background jobs are already running; wait for one or cancel one first.`)
    }
    const id = `jarvis:${Date.now().toString(36)}`
    const cwd = cwdFor(project)
    const abort = new AbortController()
    const now = Date.now()
    hub.upsertJob({
      id,
      source: 'jarvis',
      project,
      title,
      state: 'running',
      worker: 'JARVIS background agent',
      stage: 'starting',
      summary: instructions.slice(0, 400),
      cwd,
      cancel: 'supported',
      notify,
      expectsHeartbeat: true,
      staleAfterMs: 10 * 60000,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    })
    hub.registerCanceller(id, () => abort.abort())

    const session = query({
      prompt: instructions,
      options: {
        abortController: abort,
        cwd,
        model,
        effort,
        maxTurns: 40,
        settingSources: [],
        permissionMode: 'default',
        mcpServers,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          // What JARVIS has learned and knows goes into every job, and every
          // job hands back what it learned — so the work improves run to run.
          append:
            'You are running as a background job for JARVIS, Markus’s assistant. Nobody is watching this session live. ' +
            'Do the task, then end with a short plain-language result: what you did, what you found, and anything Markus must do. ' +
            'After the result, add one line per lesson worth keeping for next time — a mistake you made and fixed, a dead end, ' +
            'something that worked notably well, a fact about the project you had to dig for — each starting exactly with "LESSON: ". ' +
            'Skip lessons if there are none. ' +
            'Never send messages, emails or calls, never deploy, publish or pay, and never touch live customer data.' +
            memory.promptBlock({ conversation: false }),
        },
        canUseTool,
      },
    })
    running.set(id, session)

    ;(async () => {
      let lastText = ''
      try {
        for await (const msg of session) {
          const at = Date.now()
          if (msg.type === 'assistant') {
            for (const block of msg.message?.content ?? []) {
              if (block.type === 'text' && block.text.trim()) {
                lastText = block.text.trim()
                hub.term(`job:${title}`, lastText, 'text')
              }
              if (block.type === 'tool_use') {
                const what = block.input?.description ? ` — ${String(block.input.description).slice(0, 80)}` : ''
                hub.upsertJob({ id, stage: `using ${block.name}${what}`, heartbeatAt: at, updatedAt: at })
                hub.term(`job:${title}`, `${block.name.replace(/^mcp__\w+?__/, '')}${what}`, 'tool')
              }
            }
          }
          if (msg.type === 'result') {
            hub.observeRequest({
              id: msg.uuid,
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
              cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
              costUsd: msg.total_cost_usd ?? 0,
            })
            const okResult = msg.subtype === 'success' && !msg.is_error
            const output = String(msg.result ?? lastText)
            // Keep what it learned, and the result itself, in JARVIS's memory.
            for (const m of output.matchAll(/^\s*LESSON:\s*(.+)$/gm)) {
              try {
                memory.remember({ text: m[1].trim(), topic: project === 'other' ? 'lesson' : `lesson:${project}`, source: `job:${title}` })
              } catch {
                /* an empty lesson line */
              }
            }
            memory.logTurn({ channel: 'job', role: 'jarvis', text: `Background job "${title}" (${project}) ${okResult ? 'finished' : 'ended early'}: ${output.slice(0, 3500)}` })
            hub.upsertJob({
              id,
              state: okResult ? 'completed' : 'failed',
              stage: okResult ? 'finished' : `ended: ${msg.subtype}`,
              output: String(msg.result ?? lastText).slice(-4000),
              heartbeatAt: at,
              updatedAt: at,
            })
          }
        }
      } catch (err) {
        const at = Date.now()
        hub.upsertJob(
          abort.signal.aborted
            ? { id, state: 'canceled', stage: 'stopped on request', output: lastText.slice(-2000), updatedAt: at }
            : { id, state: 'failed', stage: `error: ${String(err?.message ?? err).slice(0, 200)}`, output: lastText.slice(-2000), updatedAt: at },
        )
      } finally {
        // An abort that lands between messages can end the stream without
        // throwing; the job still has to say it stopped.
        const job = hub.getJob(id)
        if (job && (job.state === 'running' || job.state === 'cancel_requested')) {
          hub.upsertJob({ id, state: abort.signal.aborted ? 'canceled' : 'failed', stage: abort.signal.aborted ? 'stopped on request' : 'ended without a result', updatedAt: Date.now() })
        }
        hub.forgetCanceller(id)
        running.delete(id)
      }
    })()

    return { id, cwd }
  }

  return { start }
}
