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

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASES = join(REPO, 'bases')

/** Hub projects whose working folder is a base. */
export const BASE_PROJECTS = ['realestate', 'youtube', 'influencer']

export const STREAMS = [
  { id: 'realestate', name: 'Real estate AI video walkthroughs', project: 'realestate', line: 'listing photos into video walkthroughs with a voiceover, sold to agents' },
  { id: 'youtube', name: 'YouTube faceless automation channel', project: 'youtube', line: 'a channel run by a pipeline: topic, script, voice, visuals, edit, held for his review' },
  { id: 'sites', name: 'High-end client websites', project: 'automaton', line: 'custom sites for clients, made by the Automaton pipeline and finished with Claude Code' },
  { id: 'roblox', name: 'Roblox games and servers for kids', project: 'roblox', line: 'games for a young audience, earning Robux (Turbo Traffic Town, Sky Spire)' },
  { id: 'finance', name: 'Finance: MNQ trading and portfolio', project: 'finance', line: 'MNQ futures through QuantVue (Tradovate, TradingView); monitoring and research only' },
  { id: 'influencer', name: 'AI virtual influencer', project: 'influencer', line: 'an AI character on Instagram, labelled as AI' },
]

/** A base project's working folder. */
export const baseDir = (project) => join(BASES, project)

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
