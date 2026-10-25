/**
 * JARVIS building Markus's newer projects himself (the bases with a working
 * folder: streams.mjs BASE_PROJECTS).
 *
 * Each run is a background job in the project's base folder: it reads the
 * brief, does the next unticked milestone as far as it can without Markus,
 * ticks it and rewrites the Status line, commits that folder and pushes it.
 * What only Markus can do — a choice that's his, an account, photos, money —
 * comes back as NEED lines and goes on his Needs list; while one of those is
 * open, the project waits for him rather than guessing. What he says about a
 * project goes into its brief (note), so the next run has it.
 *
 * On its own it takes one project at a time, round-robin, a run starting at
 * least GAP after the last one finished, never while three jobs are going,
 * and not while the 5-hour allowance is past 70%. Each project can be
 * paused; JARVIS_NO_AUTOPILOT=1 turns the whole thing off. Every run, and
 * every result, shows on the Projects page and in Jobs.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import { BASE_PROJECTS, STREAMS, baseDir, milestones } from './streams.mjs'

const FILE = join(hub.DATA_DIR, 'autopilot.json')
const GAP = 2 * 3600000
const TICK = 10 * 60000
const MAX_ALLOWANCE = 70

const read = () => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}
let saved = { paused: {}, lastAt: {}, ...read() }
const save = () => writeFileSync(FILE, JSON.stringify(saved, null, 2))

const streamOf = (project) => STREAMS.find((s) => s.project === project)
const jobsOf = (project) => Object.values(hub.snapshot().jobs).filter((j) => j.project === project && j.autopilot)
const running = (project) => jobsOf(project).some((j) => j.state === 'running' || j.state === 'cancel_requested')
/** What's waiting on Markus for this project (open, from these runs). */
const waiting = (project) => Object.values(hub.snapshot().items).filter((i) => i.id.startsWith(`${project}:need:`) && !['resolved', 'canceled'].includes(i.state))

const today = () => new Date().toISOString().slice(0, 10)
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

const BRIEF = (s, next) => `You're working on Markus's "${s.name}" project, in its base folder (this directory). JARVIS runs this on his own, as part of building it; Markus follows the progress on his Projects page.

Read BRIEF.md and CLAUDE.md first, and whatever earlier runs left in this folder.

Do the next unticked milestone: "${next}". Do the real work — write the files, scripts or documents it needs here; research with sources where facts matter. Go as far as you can without Markus. Anything only he can give (a choice that's his, an account, photos, a login, money) you don't guess at: write it as a NEED line (below), and do the parts you can around it.

When you've finished or gone as far as you can:
1. In BRIEF.md tick the milestone if it's done ("- [x]"), add any next steps you now see as unticked "- [ ]" items under First milestones, and replace the line under "## Status" with one line on where it stands, dated ${today()}.
2. Save it: from this folder, \`git add .\` then \`git commit -m "${s.id}: <what you did>"\`, then \`git pull --rebase\` and \`git push\`. Only this folder; never push to main, never force-push. If the push fails, say so.
3. End with a short plain summary for Markus: what you did, and what's next.
4. Then, for each thing only Markus can do, one line exactly: "NEED: <short title> :: <what he needs to do, and why>".
5. If you couldn't move the milestone at all without him, a last line: "BLOCKED".

Never post, publish, upload, send messages or email, sign up for anything or pay. Keep to the brief's rules.`

/** What a run handed back: its NEED lines go on the Needs list. */
function takeResult(project, output) {
  const s = streamOf(project)
  for (const [, title, what] of output.matchAll(/^\s*NEED:\s*(.+?)\s*::\s*(.+)$/gm)) {
    hub.upsertItem({
      id: `${project}:need:${slug(title)}`,
      source: 'jarvis',
      project,
      title: `${s.name}: ${title}`.slice(0, 140),
      why: `JARVIS is building ${s.name} and can't go further on this without you.`,
      instructions: what,
      priority: 'P2',
      resumes: 'He carries on with the project at its next run. Tell him your answer ("Jarvis, for the YouTube channel …") or mark this Done.',
    })
  }
}

/** Run the next milestone of one project now. Returns what happened, in words. */
export function work(project, { runner, by = 'markus' } = {}) {
  const s = streamOf(project)
  if (!s || !BASE_PROJECTS.includes(project)) return { started: false, why: `${project} isn't one JARVIS builds himself.` }
  if (running(project)) return { started: false, why: `Already working on ${s.name}.` }
  const next = milestones(s.id).find((m) => !m.done)
  if (!next) return { started: false, why: `Every milestone in ${s.name}'s brief is done; add the next ones to it.` }
  const { id } = runner.start({
    title: `${s.name}: ${next.text}`.slice(0, 120),
    project,
    instructions: BRIEF(s, next.text),
    notify: 'phone',
    autopilot: true,
    onDone: (output) => takeResult(project, output),
  })
  saved.lastAt[project] = Date.now()
  save()
  hub.activity({ source: 'jarvis', project, title: `${by === 'markus' ? 'Working on' : 'Autopilot: working on'} ${s.name} — ${next.text}` })
  return { started: true, id, milestone: next.text }
}

/** Markus's word on a project, into its brief for the next run. */
export function note(project, text) {
  const s = streamOf(project)
  if (!s || !BASE_PROJECTS.includes(project)) throw new Error(`${project} has no base to note it in.`)
  const file = join(baseDir(project), 'BRIEF.md')
  const body = readFileSync(file, 'utf8')
  const line = `- ${today()}: ${String(text).trim().slice(0, 1000)}`
  if (/^## From Markus$/m.test(body)) writeFileSync(file, body.replace(/^## From Markus\n/m, `## From Markus\n${line}\n`))
  else appendFileSync(file, `\n## From Markus\n${line}\n`)
  return line
}

export function setPaused(project, paused) {
  if (!BASE_PROJECTS.includes(project)) throw new Error(`${project} isn't one JARVIS builds himself.`)
  saved.paused[project] = Boolean(paused)
  save()
}

/** Each base project's autopilot, for the Projects page. */
export function status() {
  return Object.fromEntries(
    BASE_PROJECTS.map((p) => [p, { paused: Boolean(saved.paused[p]), lastAt: saved.lastAt[p] ?? null, waiting: waiting(p).length, off: Boolean(process.env.JARVIS_NO_AUTOPILOT) }]),
  )
}

export function start({ runner }) {
  if (process.env.JARVIS_NO_AUTOPILOT) return
  const tick = () => {
    try {
      const jobs = Object.values(hub.snapshot().jobs)
      if (jobs.filter((j) => j.state === 'running').length >= 2) return
      if (jobs.some((j) => j.autopilot && j.state === 'running')) return
      const last = Math.max(0, ...jobs.filter((j) => j.autopilot).map((j) => j.updatedAt ?? 0))
      if (Date.now() - last < GAP) return
      const used = hub.snapshot().usage?.windows?.five_hour?.usedPct
      if (typeof used === 'number' && used > MAX_ALLOWANCE) return
      // The one that's waited longest, that isn't paused or waiting on him.
      const next = BASE_PROJECTS.filter((p) => !saved.paused[p] && !waiting(p).length && milestones(streamOf(p).id).some((m) => !m.done)).sort(
        (a, b) => (saved.lastAt[a] ?? 0) - (saved.lastAt[b] ?? 0),
      )[0]
      if (next) work(next, { runner, by: 'autopilot' })
    } catch (err) {
      console.warn('[hub] autopilot:', err.message)
    }
  }
  setTimeout(tick, 2 * 60000).unref()
  setInterval(tick, TICK).unref()
}
