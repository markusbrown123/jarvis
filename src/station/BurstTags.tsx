import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../hub/client'
import { openItems } from '../dash/state'
import { until } from '../hub/format'

/**
 * Small labelled tags floating on the burst. The text is real project data;
 * the 3D scene moves them by writing `transform` on these elements once a
 * frame (see Reactor.tsx). Nothing here reads layout, so dragging a panel or
 * resizing the window never makes them recompute anything.
 */

export const tagEls: (HTMLElement | null)[] = []

type Tag = { key: string; kind: string; line: string; tone: string }

function useTags(): Tag[] {
  const s = useHub((x) => x.state)
  return useMemo(() => {
    if (!s) {
      return [
        { key: 'r', kind: 'ROBLOX', line: 'waiting for the hub', tone: 'mag' },
        { key: 'a', kind: 'AUTOMATON', line: 'waiting for the hub', tone: 'grn' },
        { key: 'j', kind: 'JOBS', line: 'waiting for the hub', tone: 'vio' },
        { key: 'f', kind: 'ALLOWANCE', line: 'unavailable', tone: 'cool' },
        { key: 'n', kind: 'NEEDS MARKUS', line: '—', tone: 'warn' },
        { key: 'q', kind: 'QUANTVUE', line: '—', tone: 'cool' },
      ]
    }
    const games = s.projects.roblox?.games ?? []
    const building = games.filter((g) => g.active || g.tasks.running > 0).length
    const am = s.projects.automaton
    const jobs = Object.values(s.jobs).filter((j) => ['running', 'queued', 'waiting', 'retrying', 'needs_markus'].includes(j.state))
    const running = jobs.filter((j) => j.state === 'running').length
    const five = s.usage.windows.five_hour
    const fresh = five && (!five.resetsAt || five.resetsAt > Date.now())
    const items = openItems(s.items)
    const p1 = items.filter((i) => i.priority === 'P1').length
    const svc = s.projects.finance?.services ?? []
    const up = svc.filter((x) => x.up).length
    return [
      { key: 'r', kind: 'ROBLOX', line: `${games.length} games${building ? ` · ${building} building` : ''}`, tone: 'mag' },
      { key: 'a', kind: 'AUTOMATON', line: `${am?.leads?.total ?? '—'} leads · ${am?.sites?.length ?? 0} sites`, tone: 'grn' },
      { key: 'j', kind: 'JOBS', line: `${running} running · ${jobs.length - running} waiting`, tone: 'vio' },
      { key: 'f', kind: 'ALLOWANCE', line: fresh ? `5h ${Math.round(100 - five!.usedPct)}% · ${until(five!.resetsAt)}` : 'unavailable', tone: 'cool' },
      { key: 'n', kind: 'NEEDS MARKUS', line: `${items.length} open${p1 ? ` · ${p1} urgent` : ''}`, tone: p1 ? 'bad' : 'warn' },
      { key: 'q', kind: 'QUANTVUE', line: svc.length ? `${up}/${svc.length} services up` : 'monitor ready', tone: svc.length && up < svc.length ? 'bad' : 'cool' },
    ]
  }, [s])
}

export function BurstTags() {
  const tags = useTags()
  const root = useRef<HTMLDivElement>(null)
  useEffect(
    () => () => {
      tagEls.length = 0
    },
    [],
  )
  return (
    <div ref={root} className="btags" aria-hidden="true">
      {tags.map((t, i) => (
        <span key={t.key} ref={(el) => void (tagEls[i] = el)} className={`btag btag-${t.tone}`}>
          <b>{t.kind}</b>
          <span>{t.line}</span>
        </span>
      ))}
    </div>
  )
}
