import { useEffect, useMemo, useRef, useState } from 'react'
import { useHub, fileUrl, type View } from '../hub/client'
import type { HubState, Job } from '../hub/types'
import { ago, until, tone } from '../hub/format'
import { CoreView } from '../scene/CoreView'
import { useStore } from '../store'
import { openItems, useTick } from './state'

/**
 * The overview: one look answers what is running, what changed, what there is
 * to see, what needs Markus, and how much allowance is left.
 *
 * The constellation is built from live data only. A node's colour is its real
 * state — violet working, amber needs you, red failed, cyan healthy, grey
 * dashed not connected — and a line carries moving light only while work is
 * actually running down it.
 */

type Tone = ReturnType<typeof tone>
type Node = {
  id: string
  label: string
  sub: string
  tone: Tone
  go: () => void
}
type Sector = { id: string; label: string; sub: string; tone: Tone; angle: number; go: () => void; children: Node[] }

function worst(tones: Tone[]): Tone {
  for (const t of ['fail', 'need', 'work', 'ok', 'idle', 'off'] as Tone[]) if (tones.includes(t)) return t
  return 'idle'
}

function buildSectors(s: HubState, go: (v: View, extra?: Record<string, string>) => void): Sector[] {
  const jobs = Object.values(s.jobs)
  const items = openItems(s.items)
  const now = s.serverTime

  // Roblox
  const rb = s.projects.roblox
  const games = rb?.games ?? []
  const jobFor = (g: string) => jobs.filter((j) => j.project === 'roblox' && j.game === g)
  const gameTone = (g: string): Tone => {
    const js = jobFor(g)
    if (js.some((j) => j.state === 'failed')) return 'fail'
    if (js.some((j) => j.stale || j.state === 'needs_markus')) return 'need'
    if (js.some((j) => j.state === 'running')) return 'work'
    if (js.some((j) => j.state === 'waiting')) return 'need'
    return 'idle'
  }
  const ranked = [...games].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(b.next) - Number(a.next) ||
      b.tasks.running - a.tasks.running ||
      b.tasks.blocked - a.tasks.blocked ||
      b.tasks.done - a.tasks.done,
  )
  const shown = ranked.slice(0, 4)
  const robloxChildren: Node[] = shown.map((g) => {
    const running = jobFor(g.id).find((j) => j.state === 'running')
    return {
      id: `game:${g.id}`,
      label: g.name.replace(/\s*\(.*\)\s*$/, '').replace(/!$/, ''),
      sub: running ? `${running.taskId} · ${running.title.slice(0, 34)}` : g.active ? 'active game' : g.next ? 'up next' : g.playtest?.latest ? `playtest ${g.playtest.latest.date}` : `${g.tasks.done} tasks done`,
      tone: gameTone(g.id),
      go: () => go('roblox', { selectedGame: g.id }),
    }
  })
  if (games.length > shown.length) {
    robloxChildren.push({ id: 'game:more', label: `+${games.length - shown.length} more games`, sub: 'open the studio', tone: 'idle', go: () => go('roblox') })
  }
  const rbRunning = jobs.filter((j) => j.project === 'roblox' && j.state === 'running').length
  const rbTone: Tone = rb?.error ? 'fail' : !rb ? 'off' : worst([...robloxChildren.map((c) => c.tone), rbRunning ? 'work' : 'ok'])

  // Automaton
  const am = s.projects.automaton
  const siteTone: Tone = !am?.site ? 'off' : am.site.ok ? 'ok' : 'fail'
  const inReview = am?.sites?.filter((x) => ['needs_review', 'needs_edits'].includes(x.stage)).length ?? 0
  const deployed = am?.sites?.filter((x) => x.stage === 'deployed').length ?? 0
  const automatonChildren: Node[] = [
    { id: 'am:site', label: 'automaton.llc', sub: am?.site ? (am.site.ok ? `up · ${am.site.ms} ms` : `down (${am.site.status || 'no answer'})`) : 'not checked', tone: siteTone, go: () => go('automaton') },
    {
      id: 'am:pipeline',
      label: 'Site pipeline',
      sub: am?.sites ? `${am.sites.length} sites · ${inReview} to review · ${deployed} live` : 'not connected',
      tone: am?.sites ? (inReview ? 'need' : 'ok') : 'off',
      go: () => go('automaton'),
    },
    {
      id: 'am:repo',
      label: 'Repo',
      sub: am?.repo?.commit ? `${am.repo.branch} @ ${am.repo.commit.short}${am.repo.changedFiles ? ` · ${am.repo.changedFiles} changed` : ''}` : 'folder not found',
      tone: am?.repo?.commit ? 'ok' : 'off',
      go: () => go('automaton'),
    },
    { id: 'am:board', label: 'Task board', sub: am?.board ? `${am.board.active.length} active tasks` : 'not read', tone: am?.board ? 'idle' : 'off', go: () => go('automaton') },
  ]

  // Finance
  const fi = s.projects.finance
  const financeChildren: Node[] = [
    ...(fi?.services ?? []).map<Node>((sv) => ({
      id: `fi:${sv.id}`,
      label: sv.name,
      sub: sv.up ? `running · ${sv.ms} ms` : 'not running',
      tone: sv.up ? 'ok' : 'off',
      go: () => go('finance'),
    })),
    { id: 'fi:charts', label: 'Charts', sub: (fi?.charts ?? []).map((c) => c.symbol.split(':')[1]).join(' · ') || '—', tone: 'idle', go: () => go('finance') },
    { id: 'fi:quant', label: 'Quant View', sub: fi?.quantView?.url ? 'linked' : 'which service?', tone: fi?.quantView?.url ? 'ok' : 'need', go: () => go('finance') },
  ]

  // You: allowance, sessions, the queue
  const five = s.usage.windows.five_hour
  const fiveOk = five && (!five.resetsAt || five.resetsAt > now)
  const sessions = jobs.filter((j) => j.source === 'claude' && j.state !== 'completed')
  const youChildren: Node[] = [
    {
      id: 'you:needs',
      label: 'Needs you',
      sub: items.length ? `${items.length} open · ${items[0].title.slice(0, 30)}` : 'nothing waiting',
      tone: items.length ? 'need' : 'ok',
      go: () => go('needs'),
    },
    {
      id: 'you:usage',
      label: 'Claude allowance',
      sub: fiveOk ? `${Math.round(100 - five!.usedPct)}% of 5h left · resets ${until(five!.resetsAt)}` : 'unavailable',
      tone: !fiveOk ? 'off' : five!.usedPct >= 90 ? 'fail' : five!.usedPct >= 70 ? 'need' : 'ok',
      go: () => go('settings'),
    },
    {
      id: 'you:sessions',
      label: 'Claude sessions',
      sub: sessions.length ? `${sessions.filter((j) => j.state === 'running').length} working · ${sessions.length} open` : s.usage.sources.hooks ? 'none open' : 'hooks not connected',
      tone: sessions.some((j) => j.state === 'needs_markus') ? 'need' : sessions.some((j) => j.state === 'running') ? 'work' : s.usage.sources.hooks ? 'idle' : 'off',
      go: () => go('activity'),
    },
  ]

  return [
    { id: 'roblox', label: 'Roblox', sub: rb?.games ? `${games.length} games · ${rbRunning} running` : rb?.error ? 'cannot read repo' : 'loading', tone: rbTone, angle: 212, go: () => go('roblox'), children: robloxChildren },
    { id: 'automaton', label: 'Automaton', sub: am?.site?.ok ? 'site up' : am?.site ? 'site down' : 'loading', tone: worst(automatonChildren.map((c) => c.tone).filter((t) => t !== 'off')), angle: 328, go: () => go('automaton'), children: automatonChildren },
    { id: 'finance', label: 'Finance', sub: 'monitoring only', tone: worst(financeChildren.map((c) => c.tone).filter((t) => t !== 'off')), angle: 32, go: () => go('finance'), children: financeChildren },
    { id: 'you', label: 'You', sub: items.length ? `${items.length} need you` : 'all clear', tone: worst(youChildren.map((c) => c.tone).filter((t) => t !== 'off')), angle: 148, go: () => go('needs'), children: youChildren },
  ]
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Hubs sit just outside the core's ring; their nodes stand in two columns,
 * Roblox and You on the left, Automaton and Finance on the right, with the
 * labels on the outer side so nothing crosses the core or another label.
 * The ring is ~21.5% of the height (CoreView's compact camera), so the
 * geometry here follows it.
 */
function layout(sectors: Sector[], w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  const R = 0.215 * h
  const colX = Math.min(cx - R - 80, Math.max(200, w * 0.21))
  const sides = { left: ['roblox', 'you'], right: ['automaton', 'finance'] }
  const hubAt: Record<string, number> = { roblox: 220, you: 140, automaton: 320, finance: 40 }
  const hubs = new Map<string, { x: number; y: number; above: boolean }>()
  const kids = new Map<string, { x: number; y: number; left: boolean }>()
  for (const sec of sectors) {
    const a = rad(hubAt[sec.id] ?? sec.angle)
    hubs.set(sec.id, { x: cx + Math.cos(a) * (R + 30), y: cy + Math.sin(a) * (R + 30), above: Math.sin(a) < 0 })
  }
  for (const [side, ids] of Object.entries(sides) as [keyof typeof sides, string[]][]) {
    const groups = ids.map((id) => sectors.find((x) => x.id === id)?.children ?? [])
    const n = groups.reduce((k, g) => k + g.length, 0) + (groups.length - 1)
    const top = 34
    const step = n > 1 ? (h - 2 * top) / (n - 1) : 0
    let slot = 0
    groups.forEach((g, gi) => {
      for (const c of g) {
        kids.set(c.id, { x: side === 'left' ? colX : w - colX, y: top + step * slot, left: side === 'left' })
        slot++
      }
      if (gi < groups.length - 1) slot++
    })
  }
  return { cx, cy, colX, hubs, kids }
}

function Constellation({ sectors }: { sectors: Sector[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 640 })
  const reduced = useHub((s) => s.prefs.reducedMotion)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const { w, h } = size
  const { cx, cy, colX, hubs, kids } = layout(sectors, w, h)
  const labelMax = Math.max(120, colX - 30)

  return (
    <div className="constellation" ref={ref} style={{ ['--label-max' as string]: `${labelMax}px` }}>
      <svg width={w} height={h} className={reduced ? 'still' : ''} aria-hidden>
        {sectors.map((sec) => {
          const hub = hubs.get(sec.id)!
          return (
            <g key={sec.id}>
              <path d={`M ${cx} ${cy} L ${hub.x} ${hub.y}`} className={`link link-${sec.tone} link-spoke`} />
              {sec.children.map((c) => {
                const p = kids.get(c.id)
                if (!p) return null
                const dir = p.left ? -1 : 1
                return (
                  <path
                    key={c.id}
                    d={`M ${hub.x} ${hub.y} C ${hub.x + dir * 70} ${hub.y}, ${p.x - dir * 90} ${p.y}, ${p.x} ${p.y}`}
                    className={`link link-${c.tone}`}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
      {sectors.map((sec) => {
        const hub = hubs.get(sec.id)!
        return (
          <div key={sec.id}>
            <button className={`node node-hub tone-${sec.tone} ${hub.above ? 'above' : 'below'}`} style={{ left: hub.x, top: hub.y }} onClick={sec.go}>
              <span className="node-dot" />
              <span className="node-text">
                <span className="node-label">{sec.label}</span>
                <span className="node-sub">{sec.sub}</span>
              </span>
            </button>
            {sec.children.map((c) => {
              const p = kids.get(c.id)
              if (!p) return null
              return (
                <button key={c.id} className={`node tone-${c.tone} ${p.left ? 'left' : 'right'}`} style={{ left: p.x, top: p.y }} onClick={c.go} title={`${c.label} — ${c.sub}`}>
                  <span className="node-dot" />
                  <span className="node-text">
                    <span className="node-label">{c.label}</span>
                    <span className="node-sub">{c.sub}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function latestRender(s: HubState) {
  return Object.values(s.previews)
    .filter((p) => p.kind === 'ASSET' && p.file && (p.title.startsWith('hero') || p.title.startsWith('thumbnail')))
    .sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))[0]
}

export function Overview() {
  useTick(20000)
  const s = useHub((x) => x.state)
  const setPrefs = useHub((x) => x.setPrefs)
  const phase = useStore((x) => x.phase)
  const go = (v: View, extra?: Record<string, string>) => setPrefs({ view: v, ...(extra ?? {}) })
  const sectors = useMemo(() => (s ? buildSectors(s, go) : []), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) {
    return (
      <div className="overview">
        <div className="overview-core">
          <CoreView mode="compact" />
        </div>
        <div className="overview-loading">Connecting to the command center…</div>
      </div>
    )
  }
  const running: Job[] = Object.values(s.jobs).filter((j) => j.state === 'running')
  const changed = [...s.activity].reverse().slice(0, 2)
  const needs = openItems(s.items)
  const render = latestRender(s)
  const five = s.usage.windows.five_hour
  const fiveFresh = five && (!five.resetsAt || five.resetsAt > Date.now())
  return (
    <div className="overview">
      <div className="overview-strip">
        <button className="glance" onClick={() => go('activity')}>
          <span className="glance-k">Running</span>
          <span className="glance-v">{running.length ? `${running.length} job${running.length > 1 ? 's' : ''}` : 'Nothing running'}</span>
          <span className="glance-s">{running.slice(0, 2).map((j) => `${j.taskId ?? ''} ${j.title}`.trim()).join(' · ') || 'Background work shows here'}</span>
        </button>
        <button className="glance" onClick={() => go('activity')}>
          <span className="glance-k">Changed</span>
          <span className="glance-v">{changed[0] ? ago(changed[0].ts) : '—'}</span>
          <span className="glance-s">{changed.map((a) => a.title).join(' · ') || 'No activity yet'}</span>
        </button>
        <button className="glance glance-img" onClick={() => go('roblox', { selectedGame: render?.game ?? '' })}>
          {render?.file && <img src={fileUrl(render.file)} alt="" />}
          <span className="glance-k">Latest render</span>
          <span className="glance-s">{render ? `${render.game} · ${render.revision} · ${ago(render.capturedAt)}` : 'No renders yet'}</span>
        </button>
        <button className={`glance ${needs.length ? 'glance-need' : ''}`} onClick={() => go('needs')}>
          <span className="glance-k">Needs you</span>
          <span className="glance-v">{needs.length || 'Nothing'}</span>
          <span className="glance-s">{needs[0]?.title ?? 'All clear'}</span>
        </button>
        <button className="glance" onClick={() => go('settings')}>
          <span className="glance-k">Allowance (5h)</span>
          <span className="glance-v">{fiveFresh ? `${Math.round(100 - five!.usedPct)}% left` : 'Unavailable'}</span>
          <span className="glance-s">{fiveFresh ? `resets in ${until(five!.resetsAt)}` : 'Connect the Claude Code status line'}</span>
        </button>
      </div>
      <div className="overview-map">
        <div className="overview-core">
          <CoreView mode="compact" />
        </div>
        <Constellation sectors={sectors} />
        <div className={`core-label core-label-${phase}`}>{phase === 'dormant' ? 'STANDBY' : phase.toUpperCase()}</div>
      </div>
    </div>
  )
}
