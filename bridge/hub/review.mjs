/**
 * JARVIS looking back at himself: what Markus has asked him for, what's
 * there and what isn't, what to do differently.
 *
 * A background job reads what Markus said over the last week and checks it
 * against his own repo and docs. What it learns goes into his memory as
 * lessons (the runner keeps every "LESSON:" line); what's missing and
 * buildable goes to Claude in the cloud as a build request (builds.mjs), at
 * most two a run. Those land on his branch; nothing here changes the JARVIS
 * that's running — "update yourself" is still Markus's say.
 *
 * Runs once a night, early morning, and whenever he asks ("review yourself").
 * JARVIS_NO_REVIEW=1 turns the nightly run off.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import * as memory from './memory.mjs'
import * as builds from './builds.mjs'

const FILE = join(hub.DATA_DIR, 'review.json')
const MAX_BUILDS = 2
/** Local hours the nightly run may start in. */
const NIGHT = [3, 6]

const read = () => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}
const write = (v) => writeFileSync(FILE, JSON.stringify(v, null, 2))

const BRIEF = (turns, days) => `Review JARVIS against what Markus has asked of him. JARVIS is the assistant whose own code you're in (this repo); you can read all of it and its docs (README.md, docs/STATION.md, docs/COMMAND_CENTER.md, bases/).

Below is what Markus said to JARVIS over the last ${days} days, oldest first:

${turns.join('\n')}

Do this, reading only (use Read, Grep and Glob; a shell isn't available):
1. Pick out what he asked JARVIS to add, build, change or fix — features, gestures, projects, behaviour — and the way he likes things done (his corrections, what annoyed him).
2. For each request, check whether it exists now (search the code and docs). Skip chatter, questions, and anything already there.
3. End with a short plain summary for Markus: what's done, what's missing, what you'd do next.
4. Then one line per thing about how he likes things done, starting exactly "LESSON: " — a rule for JARVIS, in one sentence, only what he really said or showed. None if there's nothing.
5. Then, for what's missing and can be built from this repo without anyone's input — at most ${MAX_BUILDS}, the ones he asked for most firmly or most often first — one line each, starting exactly "BUILD: ", as "BUILD: <short title> :: <what to build, where, and how to tell it works>", self-contained, as if for someone who hasn't seen this conversation. Leave out anything unclear, anything that sends messages or email, takes payments, deletes data, handles secrets or goes live, and anything that needs his accounts.
Never guess at what he asked: if a request isn't in the lines above, it doesn't exist.`

/** What the job found, to Claude in the cloud: its BUILD lines, as build requests. */
async function fileBuilds(output) {
  const found = [...output.matchAll(/^\s*BUILD:\s*(.+?)\s*::\s*(.+)$/gm)].slice(0, MAX_BUILDS)
  if (!found.length) return
  const gh = await builds.ready()
  if (!gh.ok) {
    hub.upsertItem({
      id: 'jarvis:review-builds',
      source: 'jarvis',
      project: 'jarvis',
      title: 'Self-review found things to build, but GitHub isn\'t connected',
      why: `${gh.why} The review's build requests can't be filed until it is.`,
      instructions: `In Terminal: ${gh.fix}`,
      priority: 'P2',
      actions: [{ kind: 'copy', label: 'Copy command', value: gh.fix }, { kind: 'check', label: 'Check again' }],
    })
    return
  }
  for (const [, title, request] of found) {
    try {
      await builds.request({ title: title.slice(0, 100), request: `${request}\n\n(Found by JARVIS's own review of what Markus has asked for.)` })
    } catch (err) {
      console.warn('[hub] review build not filed:', err.message)
    }
  }
}

/** Start a review now. Returns what happened, in words. */
export function run({ runner, days = 7, notify = 'phone' }) {
  const turns = memory.recentUserTurns({ days })
  if (turns.length < 5) return { started: false, why: `Only ${turns.length} things said in the last ${days} days: not enough to review.` }
  const { id } = runner.start({
    title: 'Self-review: what he asked for, what\'s missing',
    project: 'jarvis',
    instructions: BRIEF(turns, days),
    notify,
    onDone: (output) => void fileBuilds(output),
  })
  write({ ...read(), lastAt: Date.now() })
  return { started: true, id }
}

/** The nightly run: once a day, in the small hours, with nothing else running. */
export function start({ runner }) {
  if (process.env.JARVIS_NO_REVIEW) return
  const tick = () => {
    const h = new Date().getHours()
    if (h < NIGHT[0] || h >= NIGHT[1]) return
    const last = read().lastAt ?? 0
    if (Date.now() - last < 20 * 3600000) return
    if (Object.values(hub.snapshot().jobs).some((j) => j.state === 'running')) return
    try {
      const r = run({ runner })
      if (!r.started) write({ ...read(), lastAt: Date.now() })
    } catch (err) {
      console.warn('[hub] nightly review not started:', err.message)
    }
  }
  setInterval(tick, 20 * 60000).unref()
}
