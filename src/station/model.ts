import { useEffect, useMemo, useState } from 'react'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import type { HubState, Item, Job } from '../hub/types'
import { BRIDGE_HTTP_URL } from '../config'
import { ago } from '../hub/format'
import { zoneOfProject, type ZoneId } from './layout'

/**
 * The one mapping from real state to what the station shows.
 *
 * Every zone, node and link in the scene is built here and nowhere else, so
 * a colour or an animation can't disagree with the data behind it. Each
 * carries an honest status — live, stale, unavailable, error — and the
 * reason, and nothing is ever filled in with an invented number. See
 * docs/STATION.md for the element-by-element table.
 */

export type ZoneState = 'loading' | 'idle' | 'active' | 'attention' | 'error' | 'unavailable'
export type Freshness = { kind: 'live' | 'stale' | 'unavailable' | 'loading'; text: string }

export type ZoneModel = {
  id: ZoneId
  state: ZoneState
  /** 0..1, how much is happening — drives glow and flow speed. */
  level: number
  headline: string
  lines: string[]
  freshness: Freshness
}

export type GameNode = { id: string; name: string; status: 'building' | 'blocked' | 'idle'; active: boolean; next: boolean; published: boolean; running: number; queued: number; blocked: number; playtest: string | null }
export type StageNode = { id: string; label: string; count: number | null; sites: string[] }
export type ServiceNode = { id: string; name: string; up: boolean; detail: string }
export type CapNode = { id: string; label: string; state: 'ok' | 'warn' | 'off' | 'error'; detail: string }
export type JobNode = { id: string; title: string; zone: ZoneId; state: Job['state']; stale: boolean; stage: string; worker: string; updated: number; cancellable: boolean; progress: { done: number; total: number } | null }
export type ItemNode = { id: string; title: string; zone: ZoneId; priority: Item['priority']; why: string }
export type LinkStyle = 'active' | 'queued' | 'idle' | 'attention' | 'disconnected' | 'failed'
export type LinkModel = { id: string; from: ZoneId | 'reactor'; to: ZoneId; style: LinkStyle; label: string }

export type StationModel = {
  ready: boolean
  zones: Record<ZoneId, ZoneModel>
  games: GameNode[]
  stages: StageNode[]
  stagesReason: string | null
  leads: { total: number | null; reason: string | null }
  site: { ok: boolean | null; detail: string }
  services: ServiceNode[]
  quantView: string | null
  caps: CapNode[]
  jobs: { running: JobNode[]; queued: JobNode[]; waiting: JobNode[]; failed: JobNode[]; done: JobNode[] }
  items: ItemNode[]
  links: LinkModel[]
}

export const SITE_STAGES: [string, string][] = [
  ['generated_draft', 'Draft'],
  ['needs_review', 'Review'],
  ['needs_edits', 'Edits'],
  ['approved', 'Approved'],
  ['client_ready', 'Client ready'],
  ['deployed', 'Deployed'],
]

type Health = { tts?: boolean; model?: string; effort?: string; writes?: boolean } | null

/** The bridge's own health (model, voice, write mode), re-read every minute. */
function useHealth(): Health | 'down' | null {
  const [h, setH] = useState<Health | 'down' | null>(null)
  useEffect(() => {
    let live = true
    const read = () =>
      fetch(`${BRIDGE_HTTP_URL}/health`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.json())
        .then((j) => live && setH(j))
        .catch(() => live && setH('down'))
    void read()
    const t = setInterval(read, 60000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return h
}

const HOUR = 3600000
const fresh = (at: number | undefined, label: string, staleAfter = 20 * 60000): Freshness =>
  !at ? { kind: 'unavailable', text: `${label}: never read` } : Date.now() - at > staleAfter ? { kind: 'stale', text: `${label} · ${ago(at)} (stale)` } : { kind: 'live', text: `${label} · ${ago(at)}` }

function jobNode(j: Job): JobNode {
  return {
    id: j.id,
    title: j.taskId ? `${j.taskId} ${j.title}` : j.title,
    zone: j.source === 'roblox' ? 'roblox' : zoneOfProject(j.project),
    state: j.state,
    stale: Boolean(j.stale),
    stage: j.blocker ?? j.stage ?? '',
    worker: j.worker ?? j.source,
    updated: j.heartbeatAt ?? j.updatedAt,
    cancellable: j.cancel === 'supported' && (j.state === 'running' || j.state === 'queued'),
    // Only what the job itself reports; never estimated.
    progress: j.total && j.total > 0 ? { done: Math.max(0, Math.min(j.done ?? 0, j.total)), total: j.total } : null,
  }
}

export function buildModel(s: HubState | null, link: string, voice: { phase: string; error: string | null; micArmed: boolean }, health: Health | 'down' | null): StationModel {
  const now = Date.now()
  const jobs = Object.values(s?.jobs ?? {})
  const items = Object.values(s?.items ?? {}).filter((i) => i.state === 'open' || i.state === 'in_progress')
  const byZone = (z: ZoneId) => ({
    running: jobs.filter((j) => j.state === 'running' && jobNode(j).zone === z),
    queued: jobs.filter((j) => j.state === 'queued' && jobNode(j).zone === z),
    items: items.filter((i) => zoneOfProject(i.project) === z),
  })

  // ---- Roblox
  const rb = s?.projects.roblox
  const rz = byZone('roblox')
  const games: GameNode[] = (rb?.games ?? []).map((g) => ({
    id: g.id,
    name: g.name.replace(/\s*\(prototype\)\s*/i, ''),
    status: g.tasks.running > 0 ? 'building' : g.tasks.blocked > 0 ? 'blocked' : 'idle',
    active: g.active,
    next: g.next,
    published: g.published,
    running: g.tasks.running,
    queued: g.tasks.queued,
    blocked: g.tasks.blocked,
    playtest: g.playtest?.latest?.date ?? null,
  }))
  const building = games.filter((g) => g.status === 'building').length
  const blockedGames = games.filter((g) => g.status === 'blocked').length
  const roblox: ZoneModel = !rb
    ? { id: 'roblox', state: 'loading', level: 0, headline: 'Reading the studio…', lines: [], freshness: { kind: 'loading', text: 'studio queue · reading' } }
    : rb.error
      ? { id: 'roblox', state: 'unavailable', level: 0, headline: 'Studio unreachable', lines: [rb.error], freshness: { kind: 'unavailable', text: rb.error } }
      : {
          id: 'roblox',
          state: rz.items.length || blockedGames ? 'attention' : rz.running.length ? 'active' : 'idle',
          level: Math.min(1, rz.running.length / 3),
          headline: `${games.length} games · ${building ? `${building} building` : 'nothing building'}`,
          lines: [
            rb.activeGame ? `Active: ${games.find((g) => g.id === rb.activeGame)?.name ?? rb.activeGame}` : '',
            rz.queued.length ? `${rz.queued.length} tasks queued` : '',
            blockedGames ? `${blockedGames} games blocked` : '',
            rb.source?.commit ? `Last push ${ago(rb.source.commit.committedAt)}` : '',
          ].filter(Boolean),
          freshness: fresh(rb.source?.fetchedAt ?? rb.updatedAt, 'studio queue'),
        }

  // ---- Automaton
  const am = s?.projects.automaton
  const az = byZone('automaton')
  const stages: StageNode[] = SITE_STAGES.map(([id, label]) => {
    const sites = am?.sites?.filter((x) => x.stage === id) ?? []
    return { id, label, count: am?.sites ? sites.length : null, sites: sites.map((x) => x.name) }
  })
  const siteOk = am?.site ? am.site.ok : null
  const automaton: ZoneModel = !am
    ? { id: 'automaton', state: 'loading', level: 0, headline: 'Checking automaton.llc…', lines: [], freshness: { kind: 'loading', text: 'site probe · checking' } }
    : {
        id: 'automaton',
        state: siteOk === false ? 'error' : az.items.length ? 'attention' : az.running.length ? 'active' : !am.sites && !am.leads ? 'unavailable' : 'idle',
        level: Math.min(1, az.running.length / 2),
        headline: siteOk === false ? 'automaton.llc not answering' : siteOk ? `automaton.llc up · ${am.site!.ms} ms` : 'site unchecked',
        lines: [
          am.sites ? `${am.sites.length} sites in the pipeline` : `Pipeline unavailable — ${am.sitesError ?? 'no access'}`,
          am.leads ? `${am.leads.total} leads` : `Leads unavailable — ${am.leadsError ?? 'no access'}`,
        ],
        freshness: fresh(am.site?.checkedAt, 'site probe'),
      }

  // ---- Finance
  const fi = s?.projects.finance
  const fz = byZone('finance')
  const services: ServiceNode[] = (fi?.services ?? []).map((x) => ({ id: x.id, name: x.name, up: x.up, detail: x.up ? `running · ${x.ms} ms` : 'not running' }))
  const up = services.filter((x) => x.up).length
  const finance: ZoneModel = !fi
    ? { id: 'finance', state: 'loading', level: 0, headline: 'Checking services…', lines: [], freshness: { kind: 'loading', text: 'services · checking' } }
    : {
        id: 'finance',
        state: fz.items.length ? 'attention' : fz.running.length ? 'active' : up === 0 ? 'unavailable' : 'idle',
        level: Math.min(1, fz.running.length / 2 + up * 0.15),
        headline: `${up}/${services.length} services running · monitoring only`,
        lines: [fi.quantView?.name ? `Quant View: ${fi.quantView.name}` : 'Quant View not identified', 'No broker connected — no positions or P&L'],
        freshness: fresh(fi.updatedAt, 'service check'),
      }

  // ---- Jobs
  const recentDone = (st: string) => jobs.filter((j) => j.state === st && now - j.updatedAt < HOUR)
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'retrying' || j.state === 'cancel_requested')
  const queued = jobs.filter((j) => j.state === 'queued')
  const waiting = jobs.filter((j) => j.state === 'needs_markus')
  const failed = recentDone('failed')
  const done = recentDone('completed')
  const staleRunning = running.filter((j) => j.stale).length
  const jobsZone: ZoneModel = {
    id: 'jobs',
    state: !s ? 'loading' : failed.length || staleRunning ? 'error' : waiting.length ? 'attention' : running.length ? 'active' : 'idle',
    level: Math.min(1, running.length / 4),
    headline: !s ? 'Connecting…' : `${running.length} running · ${queued.length} queued`,
    lines: [failed.length ? `${failed.length} failed in the last hour` : '', staleRunning ? `${staleRunning} with no heartbeat` : '', waiting.length ? `${waiting.length} waiting on you` : '', done.length ? `${done.length} finished in the last hour` : ''].filter(Boolean),
    freshness: link === 'live' ? { kind: 'live', text: 'job feed · live' } : { kind: link === 'down' ? 'unavailable' : 'loading', text: link === 'down' ? 'job feed · bridge offline' : 'job feed · connecting' },
  }

  // ---- Needs Markus
  const itemNodes: ItemNode[] = items
    .map((i) => ({ id: i.id, title: i.title, zone: zoneOfProject(i.project), priority: i.priority, why: i.why ?? '' }))
    .sort((a, b) => a.priority.localeCompare(b.priority))
  const p1 = itemNodes.filter((i) => i.priority === 'P1').length
  const needs: ZoneModel = {
    id: 'needs',
    state: !s ? 'loading' : itemNodes.length ? 'attention' : 'idle',
    level: Math.min(1, itemNodes.length / 4 + p1 * 0.3),
    headline: !s ? 'Connecting…' : itemNodes.length ? `${itemNodes.length} need you${p1 ? ` · ${p1} urgent` : ''}` : 'Nothing needs you',
    lines: itemNodes.slice(0, 3).map((i) => i.title),
    freshness: link === 'live' ? { kind: 'live', text: 'queue · live' } : { kind: 'loading', text: 'queue · connecting' },
  }

  // ---- Jarvis Core
  const h = health && health !== 'down' ? health : null
  const five = s?.usage.windows.five_hour
  const fiveFresh = five && (!five.resetsAt || five.resetsAt > now)
  const tg = s?.phone?.telegram
  const caps: CapNode[] = [
    { id: 'bridge', label: 'Bridge', state: link === 'live' ? 'ok' : link === 'down' ? 'error' : 'warn', detail: link === 'live' ? 'connected' : link === 'down' ? 'offline — run jarvis' : 'connecting' },
    { id: 'brain', label: 'Brain', state: h?.model ? 'ok' : health === 'down' ? 'error' : 'warn', detail: h?.model ? `${h.model} · ${h.writes ? 'write access' : 'read-only'}` : 'unknown' },
    { id: 'voice', label: 'Voice', state: h ? (h.tts ? 'ok' : 'warn') : 'off', detail: h ? (h.tts ? 'ElevenLabs' : 'browser voice') : 'unknown' },
    { id: 'mic', label: 'Microphone', state: voice.micArmed ? 'ok' : 'off', detail: voice.micArmed ? 'listening for "Hey Jarvis"' : 'off' },
    { id: 'phone', label: 'Phone', state: tg?.paired ? 'ok' : tg?.configured ? 'warn' : 'off', detail: tg?.paired ? `paired · ${tg.chatName ?? 'Telegram'}` : tg?.configured ? 'not paired' : 'not set up' },
    {
      id: 'allowance',
      label: 'Claude allowance',
      state: fiveFresh ? (five!.usedPct > 85 ? 'warn' : 'ok') : 'off',
      detail: fiveFresh ? `${Math.round(100 - five!.usedPct)}% of 5h left` : 'unavailable — no fresh status-line reading',
    },
  ]
  const busy = voice.phase === 'thinking' || voice.phase === 'tooling' || voice.phase === 'speaking' || voice.phase === 'listening'
  const core: ZoneModel = {
    id: 'core',
    state: link === 'down' || voice.error ? 'error' : voice.phase === 'offline' ? 'unavailable' : busy ? 'active' : 'idle',
    level: busy ? 0.8 : 0.15,
    headline: voice.error ? voice.error : link === 'down' ? 'Bridge offline' : voice.phase === 'dormant' ? 'Standing by' : voice.phase === 'tooling' ? 'Working' : voice.phase.charAt(0).toUpperCase() + voice.phase.slice(1),
    lines: caps.filter((c) => c.state !== 'ok').map((c) => `${c.label}: ${c.detail}`),
    freshness: health === null ? { kind: 'loading', text: 'health · reading' } : health === 'down' ? { kind: 'unavailable', text: 'health · bridge not answering' } : { kind: 'live', text: 'health · live' },
  }

  // ---- Links: what is flowing where, right now.
  const zones = { roblox, automaton, finance, jobs: jobsZone, needs, core }
  const links: LinkModel[] = (['roblox', 'automaton', 'finance', 'jobs', 'needs', 'core'] as ZoneId[]).map((id) => {
    const z = zones[id]
    const q = id === 'jobs' ? queued.length : byZone(id).queued.length
    const style: LinkStyle =
      z.state === 'unavailable' || (id !== 'jobs' && id !== 'needs' && z.state === 'error' && id !== 'core')
        ? id === 'automaton' && siteOk === false
          ? 'failed'
          : 'disconnected'
        : z.state === 'error'
          ? 'failed'
          : z.state === 'attention'
            ? 'attention'
            : z.state === 'active'
              ? 'active'
              : q
                ? 'queued'
                : 'idle'
    return { id: `reactor-${id}`, from: 'reactor', to: id, style, label: `${z.headline}` }
  })
  // Jobs feed the projects they belong to; open items point at theirs.
  for (const zid of ['roblox', 'automaton', 'finance'] as ZoneId[]) {
    const r = byZone(zid)
    if (r.running.length) links.push({ id: `jobs-${zid}`, from: 'jobs', to: zid, style: 'active', label: `${r.running.length} running for ${zid}` })
    if (r.items.length) links.push({ id: `needs-${zid}`, from: 'needs', to: zid, style: 'attention', label: `${r.items.length} waiting on you` })
  }

  return {
    ready: Boolean(s),
    zones,
    games,
    stages,
    stagesReason: am && !am.sites ? (am.sitesError ?? 'no access') : null,
    leads: { total: am?.leads?.total ?? null, reason: am && !am.leads ? (am.leadsError ?? 'no access') : null },
    site: { ok: siteOk, detail: am?.site ? (am.site.ok ? `up · ${am.site.ms} ms` : `not answering${am.site.error ? ` (${am.site.error})` : ''}`) : 'unchecked' },
    services,
    quantView: fi?.quantView?.name ?? null,
    caps,
    jobs: { running: running.map(jobNode), queued: queued.map(jobNode), waiting: waiting.map(jobNode), failed: failed.map(jobNode), done: done.map(jobNode) },
    items: itemNodes,
    links,
  }
}

/** The model, rebuilt whenever the hub or JARVIS's state changes. */
export function useStationModel(): StationModel {
  const s = useHub((x) => x.state)
  const link = useHub((x) => x.link)
  const phase = useStore((x) => x.phase)
  const error = useStore((x) => x.error)
  const micArmed = useStore((x) => x.micArmed)
  const health = useHealth()
  return useMemo(() => buildModel(s, link, { phase, error, micArmed }, health), [s, link, phase, error, micArmed, health])
}
