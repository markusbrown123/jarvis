/**
 * The streams of work JARVIS is part of, and where each one's base is
 * (bases/<id>/BRIEF.md: what it is, how it works, what comes first, what he
 * must never do, and its status). He reads them from here — streams and
 * stream_brief tools, and a short list in his prompt — so "how's the YouTube
 * channel?" is answered from the base rather than guessed.
 *
 * Three have a project of their own in the hub and a working folder in
 * bases/ (a desk Claude Code session for that project runs in it); the other
 * three are the existing Automaton, Roblox and Finance projects, whose work
 * lives in their own repos.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASES = join(REPO, 'bases')

/** Hub projects whose working folder is a base. */
export const BASE_PROJECTS = ['realestate', 'youtube', 'influencer']

/**
 * The projects JARVIS builds himself (autopilot.mjs), in Markus's order of
 * focus: the bases, and Automaton's client sites, whose runs work in
 * bases/sites and only read the Automaton repos.
 */
export const BUILT = ['realestate', 'automaton', 'youtube', 'influencer']

export const STREAMS = [
  { id: 'realestate', name: 'Real estate AI video walkthroughs', project: 'realestate', line: 'listing photos into video walkthroughs with a voiceover, sold to agents' },
  { id: 'youtube', name: 'YouTube faceless automation channel', project: 'youtube', line: 'a channel run by a pipeline: topic, script, voice, visuals, edit, held for his review' },
  { id: 'sites', name: 'High-end client websites', project: 'automaton', line: 'custom sites for clients, made by the Automaton pipeline and finished with Claude Code' },
  { id: 'roblox', name: 'Roblox games and servers for kids', project: 'roblox', line: 'games for a young audience, earning Robux (Turbo Traffic Town, Sky Spire)' },
  { id: 'finance', name: 'Finance: MNQ trading and portfolio', project: 'finance', line: 'MNQ futures through QuantVue (Tradovate, TradingView); monitoring and research only' },
  { id: 'influencer', name: 'AI virtual influencer', project: 'influencer', line: 'an AI character on Instagram, labelled as AI' },
]

/** A built project's working folder: its base (the client sites' is bases/sites). */
export const baseDir = (project) => join(BASES, STREAMS.find((s) => s.project === project)?.id ?? project)

/** The brief for a stream (by id or by its hub project), or null. */
export function brief(which) {
  const s = STREAMS.find((x) => x.id === which || x.project === which)
  const file = s && join(BASES, s.id, 'BRIEF.md')
  return s && existsSync(file) ? { stream: s, text: readFileSync(file, 'utf8') } : null
}

/** The Status line of a brief: the first non-empty line under "## Status". */
export function status(which) {
  const b = brief(which)
  const m = b?.text.match(/^## Status\s*\n+([^\n]+)/m)
  return m?.[1].trim() ?? 'no status written'
}

/** What a run puts at the end of a milestone's line when it can't go further without Markus. */
export const WAITING = '(waiting on Markus)'
const WAITING_RE = /\s*\(waiting on Markus\)\s*$/i

/** A brief's milestones: its checklist lines, ticked or not, and whether one is waiting on Markus. */
export function milestones(which) {
  const b = brief(which)
  if (!b) return []
  return [...b.text.matchAll(/^- \[( |x)\] (.+)$/gm)].map((m) => ({ done: m[1] === 'x', text: m[2].replace(WAITING_RE, '').trim(), waiting: m[1] !== 'x' && WAITING_RE.test(m[2]) }))
}

/**
 * When each milestone was done, newest first: read from the brief's own git
 * history (the commit a "- [x]" line first appears in), so there's a record
 * from the start, not just from when this was added — and one ticked but not
 * committed yet counts from now. Cached until the brief changes.
 */
const histCache = new Map()
export function history(which) {
  const file = join(BASES, which, 'BRIEF.md')
  if (!existsSync(file)) return []
  const key = statSync(file).mtimeMs
  const hit = histCache.get(which)
  if (hit?.key === key) return hit.list
  const seen = new Map()
  const norm = (t) =>
    t
      .replace(/\s*\(waiting on Markus\)\s*$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 48)
  try {
    const log = execFileSync('git', ['-C', REPO, 'log', '--reverse', '--format=@@%ct', '-p', '--', `bases/${which}/BRIEF.md`], { encoding: 'utf8', maxBuffer: 8 << 20, timeout: 5000 })
    let at = 0
    for (const line of log.split('\n')) {
      if (line.startsWith('@@') && /^@@\d+$/.test(line)) at = Number(line.slice(2)) * 1000
      const m = line.match(/^\+- \[x\] (.+)$/)
      if (m && !seen.has(norm(m[1]))) seen.set(norm(m[1]), at)
    }
  } catch {
    /* not a git checkout, or git missing: what's ticked now still shows below */
  }
  const list = milestones(which)
    .filter((m) => m.done)
    .map((m) => ({ text: m.text, at: seen.get(norm(m.text)) ?? Date.now() }))
    .sort((a, b) => b.at - a.at)
  histCache.set(which, { key, list })
  return list
}

/** Every stream with its status, milestones and brief: the dashboard's Projects page. */
export function all() {
  return STREAMS.map((s) => {
    const b = brief(s.id)
    const base = BUILT.includes(s.project)
    return { ...s, base: base ? `bases/${s.id}` : null, status: status(s.id), milestones: milestones(s.id), history: base ? history(s.id) : [], brief: b?.text ?? '' }
  })
}
