/**
 * Building JARVIS himself in the cloud (tools.mjs: cloud_build).
 *
 * A request becomes a GitHub issue on his own repo, labelled jarvis-build.
 * A scheduled Claude Code session in the cloud picks those up — only ones
 * Markus opened — builds and checks them, pushes them to his branch,
 * comments on the issue and closes it; if a request is unclear or risky it
 * asks instead (label jarvis-question). This side watches the issues it
 * opened and shows each as a job: waiting, asked a question, done. Done
 * reaches the phone like any job of his, and "update yourself" (jarvis
 * update) brings it in.
 *
 * Through the GitHub CLI, as Markus is logged in to it (gh auth login): no
 * token is kept here.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as hub from './store.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = join(hub.DATA_DIR, 'builds.json')
const LABEL = 'jarvis-build'
const ASK = 'jarvis-question'
const EVERY = 5 * 60000

const run = (cmd, args, timeout = 30000) =>
  new Promise((ok, fail) =>
    execFile(cmd, args, { cwd: REPO, timeout, env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` } }, (err, out, errOut) =>
      err ? fail(new Error(String(errOut || err.message).trim().split('\n')[0])) : ok(String(out).trim()),
    ),
  )

let builds = []
try {
  if (existsSync(FILE)) builds = JSON.parse(readFileSync(FILE, 'utf8'))
} catch {
  builds = []
}
const save = () => writeFileSync(FILE, JSON.stringify(builds, null, 2))

/** owner/repo of JARVIS's own checkout, from its origin. */
async function slug() {
  const url = await run('git', ['remote', 'get-url', 'origin'])
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  if (!m) throw new Error(`origin isn't a GitHub repo (${url})`)
  return m[1]
}

/** Whether gh is there and signed in; the reason if not. */
export async function ready() {
  try {
    await run('gh', ['auth', 'status'], 15000)
    return { ok: true }
  } catch (err) {
    const missing = /ENOENT|not found/i.test(err.message)
    return { ok: false, why: missing ? 'The GitHub CLI (gh) is not installed on this Mac.' : 'The GitHub CLI is not signed in.', fix: missing ? 'brew install gh && gh auth login' : 'gh auth login' }
  }
}

const job = (b, patch) => hub.upsertJob({ id: `build:${b.number}`, source: 'jarvis', project: 'jarvis', title: `Cloud build: ${b.title}`, worker: 'Claude Code (cloud)', cancel: 'unsupported', updatedAt: Date.now(), ...patch })

/** File a build request; the cloud picks it up within the hour. */
export async function request({ title, request: body }) {
  const t = String(title ?? '').trim().slice(0, 100)
  const text = String(body ?? '').trim().slice(0, 8000)
  if (!t || !text) throw new Error('A build request needs a title and what to build.')
  const gh = await ready()
  if (!gh.ok) throw new Error(`${gh.why} In Terminal: ${gh.fix}`)
  const repo = await slug()
  // The label, the first time (--force: fine if it's there).
  await run('gh', ['label', 'create', LABEL, '--repo', repo, '--color', '7c8bff', '--description', 'Build request from JARVIS, built by Claude Code in the cloud', '--force']).catch(() => {})
  await run('gh', ['label', 'create', ASK, '--repo', repo, '--color', 'f5a524', '--description', 'The cloud build has a question for Markus', '--force']).catch(() => {})
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')
  const full = `${text}\n\n---\nFiled by JARVIS for Markus. Build on branch \`${branch}\`; when it's pushed, Markus says "Jarvis, update yourself" (jarvis update).`
  const url = await run('gh', ['issue', 'create', '--repo', repo, '--title', t, '--body', full, '--label', LABEL])
  const number = Number(url.match(/\/issues\/(\d+)/)?.[1])
  const b = { number, url, repo, title: t, at: Date.now(), done: false, seen: 0 }
  builds.push(b)
  save()
  job(b, { state: 'queued', stage: 'waiting for the cloud (checked hourly)', summary: text.slice(0, 400), createdAt: b.at, heartbeatAt: b.at })
  hub.activity({ source: 'jarvis', project: 'jarvis', title: `Cloud build requested: ${t}`, ref: url })
  return b
}

/** Look at every open request: a question, a comment, done. */
export async function check() {
  const open = builds.filter((b) => !b.done)
  if (!open.length) return
  for (const b of open) {
    try {
      const v = JSON.parse(await run('gh', ['issue', 'view', String(b.number), '--repo', b.repo, '--json', 'state,stateReason,labels,comments']))
      const comments = v.comments ?? []
      const last = comments.at(-1)
      const asking = (v.labels ?? []).some((l) => l.name === ASK)
      if (v.state === 'CLOSED') {
        b.done = true
        const ok = v.stateReason !== 'NOT_PLANNED'
        job(b, { state: ok ? 'completed' : 'failed', stage: ok ? 'built and pushed — say "update yourself"' : 'closed without building', output: String(last?.body ?? '').slice(0, 4000) })
      } else if (comments.length > b.seen) {
        job(b, asking ? { state: 'needs_markus', stage: 'the cloud has a question (on the issue)', output: String(last?.body ?? '').slice(0, 4000) } : { state: 'running', stage: String(last?.body ?? '').split('\n')[0].slice(0, 140), heartbeatAt: Date.now() })
      }
      b.seen = comments.length
    } catch (err) {
      job(b, { stage: `couldn't check the issue: ${err.message.slice(0, 120)}` })
    }
  }
  save()
}

export function start() {
  setTimeout(() => void check(), 20000)
  setInterval(() => void check(), EVERY)
}

export const list = () => builds
