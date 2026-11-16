import { useEffect } from 'react'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import type { HubState } from '../hub/types'
import { zoneOfProject, type ZoneId } from './layout'
import { useStation } from './stationStore'

/**
 * Turns real changes into one-shot scene events. Each comes from comparing
 * one hub snapshot with the next — never from a timer:
 * - a job starts running        → assign (core → its zone)
 * - a job completes / fails     → complete / fail at its zone
 * - Automaton's lead count rises → lead
 * - the studio queue moves      → studio (Roblox → core)
 * - a new item needs Markus     → need
 * - a source starts failing     → fail at that zone
 * - JARVIS hears or answers     → voice
 */

const zoneOf = (source: string, project: string | undefined): ZoneId => (source === 'roblox' ? 'roblox' : zoneOfProject(project))

export function useLiveEvents() {
  useEffect(() => {
    let prev: HubState | null = useHub.getState().state
    const push = useStation.getState().push
    const offHub = useHub.subscribe((st) => {
      const s = st.state
      if (!s || s === prev) return
      const p = prev
      prev = s
      if (!p) return
      for (const j of Object.values(s.jobs)) {
        const before = p.jobs[j.id]?.state
        if (before === j.state) continue
        const zone = zoneOf(j.source, j.project)
        if (j.state === 'running' && before !== 'running') push({ kind: 'assign', zone, from: 'core', label: j.title })
        if (j.state === 'completed') push({ kind: 'complete', zone, label: j.title })
        if (j.state === 'failed') push({ kind: 'fail', zone, label: j.title })
      }
      const leadsBefore = p.projects.automaton?.leads?.total
      const leadsNow = s.projects.automaton?.leads?.total
      if (leadsBefore !== undefined && leadsNow !== undefined && leadsNow > leadsBefore) push({ kind: 'lead', zone: 'automaton', label: `${leadsNow - leadsBefore} new lead${leadsNow - leadsBefore > 1 ? 's' : ''}` })
      if (p.projects.roblox?.source?.commit?.short && s.projects.roblox?.source?.commit?.short !== p.projects.roblox.source.commit.short) push({ kind: 'studio', zone: 'roblox', from: 'roblox', label: 'studio queue moved' })
      if (p.projects.automaton?.site?.ok && s.projects.automaton?.site && !s.projects.automaton.site.ok) push({ kind: 'fail', zone: 'automaton', label: 'automaton.llc stopped answering' })
      for (const i of Object.values(s.items)) {
        if (i.state === 'open' && p.items[i.id]?.state !== 'open') push({ kind: 'need', zone: zoneOfProject(i.project), from: 'needs', label: i.title })
      }
    })
    // Voice: a question heard, an answer given.
    let phase = useStore.getState().phase
    const offVoice = useStore.subscribe((st) => {
      if (st.phase === phase) return
      const was = phase
      phase = st.phase
      if (st.phase === 'thinking' && (was === 'listening' || was === 'waking' || was === 'dormant')) push({ kind: 'voice', zone: 'core', label: 'heard you' })
    })
    return () => {
      offHub()
      offVoice()
    }
  }, [])
}
