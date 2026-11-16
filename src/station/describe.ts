import { ago, JOB_LABEL } from '../hub/format'
import { ZONE } from './layout'
import type { Sel } from './stationStore'
import type { JobNode, StationModel } from './model'
import type { TermLine } from '../hub/types'

/**
 * What one thing in the room is, in words: for the hover tooltip and the
 * detail panel. Read straight from the station model, with where it came
 * from, so the words can never say more than the data does.
 */

export type Tone = 'ok' | 'live' | 'warn' | 'bad' | 'off'
export type Description = { title: string; kicker: string; status: string; tone: Tone; lines: string[]; source: string }

const ZONE_STATE: Record<string, [string, Tone]> = {
  loading: ['reading…', 'off'],
  idle: ['idle', 'ok'],
  active: ['active', 'live'],
  attention: ['needs you', 'warn'],
  error: ['error', 'bad'],
  unavailable: ['unavailable', 'off'],
}

export function findJob(m: StationModel, id: string): JobNode | undefined {
  const j = m.jobs
  return [...j.running, ...j.waiting, ...j.queued, ...j.failed, ...j.done].find((x) => x.id === id)
}

export function describe(sel: Sel, m: StationModel): Description | null {
  switch (sel.kind) {
    case 'zone': {
      const z = m.zones[sel.zone]
      const [status, tone] = ZONE_STATE[z.state]
      return { title: ZONE[sel.zone].label, kicker: ZONE[sel.zone].role, status, tone, lines: [z.headline, ...z.lines], source: z.freshness.text }
    }
    case 'game': {
      const g = m.games.find((x) => x.id === sel.id)
      if (!g) return null
      const flags = [g.active && 'active game', g.next && 'next up', g.published && 'published'].filter(Boolean).join(' · ')
      return {
        title: g.name,
        kicker: 'Roblox game',
        status: g.status,
        tone: g.status === 'building' ? 'live' : g.status === 'blocked' ? 'warn' : 'ok',
        lines: [`${g.running} running · ${g.queued} queued · ${g.blocked} blocked`, flags, g.playtest ? `Last playtest ${g.playtest}` : 'No playtest on record'].filter(Boolean),
        source: m.zones.roblox.freshness.text,
      }
    }
    case 'stage': {
      const st = m.stages.find((x) => x.id === sel.id)
      if (!st) return null
      return {
        title: st.label,
        kicker: 'Automaton pipeline stage',
        status: st.count === null ? 'unavailable' : `${st.count} site${st.count === 1 ? '' : 's'}`,
        tone: st.count === null ? 'off' : 'ok',
        lines: st.count === null ? [`Pipeline unavailable — ${m.stagesReason ?? 'no access'}`] : st.sites.length ? st.sites.slice(0, 6) : ['No sites at this stage'],
        source: 'Automaton site pipeline',
      }
    }
    case 'service': {
      const s = m.services.find((x) => x.id === sel.id)
      if (!s) return null
      return { title: s.name, kicker: 'Finance service · monitoring only', status: s.up ? 'running' : 'not running', tone: s.up ? 'ok' : 'off', lines: [s.detail], source: m.zones.finance.freshness.text }
    }
    case 'capability': {
      const c = m.caps.find((x) => x.id === sel.id)
      if (!c) return null
      const tone: Tone = c.state === 'ok' ? 'ok' : c.state === 'warn' ? 'warn' : c.state === 'error' ? 'bad' : 'off'
      return { title: c.label, kicker: 'JARVIS core', status: c.state === 'ok' ? 'ok' : c.state, tone, lines: [c.detail], source: m.zones.core.freshness.text }
    }
    case 'job': {
      const j = findJob(m, sel.id)
      if (!j) return null
      const tone: Tone = j.stale || j.state === 'needs_markus' ? 'warn' : j.state === 'failed' ? 'bad' : j.state === 'completed' ? 'ok' : j.state === 'queued' ? 'off' : 'live'
      return {
        title: j.title,
        kicker: `Job · ${ZONE[j.zone].label}`,
        status: j.stale ? 'no heartbeat' : (JOB_LABEL[j.state] ?? j.state),
        tone,
        lines: [j.stage, `${j.worker} · updated ${ago(j.updated)}`].filter(Boolean),
        source: m.zones.jobs.freshness.text,
      }
    }
    case 'item': {
      const i = m.items.find((x) => x.id === sel.id)
      if (!i) return null
      return { title: i.title, kicker: `${i.priority} · ${ZONE[i.zone].label}`, status: 'needs you', tone: 'warn', lines: [i.why].filter(Boolean), source: m.zones.needs.freshness.text }
    }
  }
}

const ZONE_LINES: Record<string, (l: TermLine) => boolean> = {
  roblox: (l) => l.src === 'roblox' || /roblox|studio/i.test(l.text),
  automaton: (l) => /automaton|lead|site/i.test(l.text) || l.src === 'automaton',
  finance: (l) => /financ|quant|trad|expense|business/i.test(l.text) || l.src === 'business',
  jobs: (l) => l.src.startsWith('job:') || l.src === 'jarvis' || l.src === 'worker',
  needs: (l) => /needs markus|needs you|item/i.test(l.text),
  core: (l) => l.src === 'voice' || l.src === 'phone' || l.src === 'memory',
}

const has = (text: string, needle: string) => Boolean(needle) && text.toLowerCase().includes(needle.toLowerCase().slice(0, 32))

/** Which terminal lines are about the selected thing. */
export function termMatch(sel: Sel, m: StationModel): (l: TermLine) => boolean {
  switch (sel.kind) {
    case 'job': {
      const j = findJob(m, sel.id)
      // Job lines are tagged with the job's own title.
      return (l) => Boolean(j) && l.src.startsWith('job:') && j!.title.endsWith(l.src.slice(4))
    }
    case 'item': {
      const i = m.items.find((x) => x.id === sel.id)
      return (l) => Boolean(i) && has(l.text, i!.title)
    }
    case 'game': {
      const g = m.games.find((x) => x.id === sel.id)
      return (l) => Boolean(g) && has(l.text, g!.name)
    }
    case 'service': {
      const s = m.services.find((x) => x.id === sel.id)
      return (l) => Boolean(s) && has(l.text, s!.name)
    }
    case 'capability':
      return sel.id === 'voice' || sel.id === 'mic' ? (l) => l.src === 'voice' : sel.id === 'phone' ? (l) => l.src === 'phone' : ZONE_LINES.core
    default:
      return ZONE_LINES[sel.zone]
  }
}
