/**
 * JARVIS building Markus's newer projects himself (the bases with a working
 * folder: streams.mjs BASE_PROJECTS).
 *
 * Each run is a background job in the project's base folder: it reads the
 * brief, does the next unticked milestone as far as it can without Markus,
 * ticks it and rewrites the Status line, commits that folder and pushes it.
 * What only Markus can do — a choice that's his, an account, photos, money —
 * comes back as NEED lines and goes on his Needs list, and the milestone is
 * marked "(waiting on Markus)" in the brief: later runs pass over it to the
 * next one that can move, until those needs are done or he notes an answer.
 * Only when nothing left can move does a run say BLOCKED, and the project
 * waits for him rather than guessing. What he says about a project goes into
 * its brief (note), so the next run has it.
 *
 * On its own it takes one project at a time, round-robin, a run starting at
 * least GAP after the last one finished (JARVIS_AUTOPILOT_GAP_MIN, default 120), never while three jobs are going,
 * and not while the 5-hour allowance is past 70%. Each project can be
 * paused; JARVIS_NO_AUTOPILOT=1 turns the whole thing off. Every run, and
 * every result, shows on the Projects page and in Jobs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import { BASE_PROJECTS, STREAMS, WAITING, baseDir, milestones } from './streams.mjs'

const FILE = join(hub.DATA_DIR, 'autopilot.json')
const GAP = Math.max(1, Number(process.env.JARVIS_AUTOPILOT_GAP_MIN) || 120) * 60000
const TICK = 10 * 60000
const MAX_ALLOWANCE = 70

const read = () => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}
let saved = { paused: {}, lastAt: {}, blocked: {}, ...read() }
const save = () => writeFileSync(FILE, JSON.stringify(saved, null, 2))

const streamOf = (project) => STREAMS.find((s) => s.project === project)
const jobsOf = (project) => Object.values(hub.snapshot().jobs).filter((j) => j.project === project && j.autopilot)
const running = (project) => jobsOf(project).some((j) => j.state === 'running' || j.state === 'cancel_requested')
/** What's waiting on Markus for this project (open, from these runs). */
const waiting = (project) => Object.values(hub.snapshot().items).filter((i) => i.id.startsWith(`${project}:need:`) && !['resolved', 'canceled'].includes(i.state))

/**
 * The milestone a run takes next: the first unticked one, passing over any a
 * run marked as waiting on Markus while he still has that project's needs
 * open — so one thing only he can give doesn't hold up the rest.
 */
function nextFor(project) {
  const held = waiting(project).length > 0
  return milestones(streamOf(project).id).find((m) => !m.done && !(m.waiting && held)) ?? null
}

const today = () => new Date().toISOString().slice(0, 10)
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

const BRIEF = (s, next, dir = baseDir(s.project)) => `You're working on Markus's "${s.name}" project, in its base folder (this directory). JARVIS runs this on his own, as part of building it; Markus follows the progress on his Projects page.

Read BRIEF.md and CLAUDE.md first, and whatever earlier runs left in this folder.

Do this milestone: "${next}". Do the real work — write the files, scripts or documents it needs here; research with sources where facts matter. Go as far as you can without Markus. Anything only he can give (a choice that's his, an account, photos, a login, money) you don't guess at: write it as a NEED line (below), and do the parts you can around it.

When you've finished or gone as far as you can:
1. In BRIEF.md tick the milestone if it's done ("- [x]"). If it can't go further without Markus, leave it unticked and end its line with "${WAITING}" — the next run takes the next milestone instead of coming back to it until he's answered. Add any next steps you now see as unticked "- [ ]" items under First milestones, and replace the line under "## Status" with one line on where it stands, dated ${today()}.
2. Save it — with the folder's full path, since a \`cd\` in one command carries into the next: \`git -C "${dir}" add .\`, then \`git -C "${dir}" commit -m "${s.id}: <what you did>"\`, then \`git -C "${dir}" pull --rebase\` and \`git -C "${dir}" push\`. Only this folder; never push to main, never force-push. If the push fails, say so.
3. End with a short plain summary for Markus: what you did, and what's next.
4. Then, for each thing only Markus can do, one line exactly: "NEED: <short title> :: <what he needs to do, and why>".
5. If none of the milestones left can move without him — this one or any later one — a last line: "BLOCKED".

Never post, publish, upload, send messages or email, sign up for anything or pay. Keep to the brief's rules.`

/** What a run handed back: its NEED lines go on the Needs list. */
function takeResult(project, output) {
  const s = streamOf(project)
  saved.blocked[project] = /^\s*BLOCKED\s*$/m.test(output)
  save()
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
  const next = nextFor(project)
  if (!next)
    return {
      started: false,
      why: milestones(s.id).some((m) => !m.done) ? `Everything left in ${s.name}'s brief is waiting on you (see Needs).` : `Every milestone in ${s.name}'s brief is done; add the next ones to it.`,
    }
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
  // An answer from him may be what a milestone was waiting on: they're all worth another look.
  const fresh = body.replace(/ *\(waiting on Markus\) *$/gim, '')
  if (/^## From Markus$/m.test(fresh)) writeFileSync(file, fresh.replace(/^## From Markus\n/m, `## From Markus\n${line}\n`))
  else writeFileSync(file, `${fresh.replace(/\n*$/, '\n')}\n## From Markus\n${line}\n`)
  // An answer from him: worth another run even if the last one was stuck.
  saved.blocked[project] = false
  save()
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
    BASE_PROJECTS.map((p) => [
      p,
      { paused: Boolean(saved.paused[p]), lastAt: saved.lastAt[p] ?? null, waiting: waiting(p).length, blocked: Boolean(saved.blocked[p] && waiting(p).length), off: Boolean(process.env.JARVIS_NO_AUTOPILOT), next: nextFor(p)?.text ?? null },
    ]),
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
      // The one that's waited longest, that isn't paused or stuck waiting on him.
      const stuck = (p) => saved.blocked[p] && waiting(p).length > 0
      const next = BASE_PROJECTS.filter((p) => !saved.paused[p] && !stuck(p) && nextFor(p)).sort(
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
