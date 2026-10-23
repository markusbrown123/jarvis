import { useState, type CSSProperties } from 'react'
import { hubActions, useHub, type View } from '../hub/client'
import { ItemCard } from '../dash/shared'
import { JobCard } from '../dash/Jobs'
import { ZONE } from './layout'
import { useStation } from './stationStore'
import { describe } from './describe'

/**
 * The selection panel: what was clicked in the room, where its numbers come
 * from, and only the actions that really exist for it — the same ones the
 * dashboard pages use (an item's checks and snooze, a job's cancel, a
 * project refresh), plus a jump to its full page.
 */

const PAGE: Record<string, View> = { roblox: 'roblox', automaton: 'automaton', finance: 'finance', jobs: 'jobs', needs: 'needs', core: 'settings' }

function Refresh({ project }: { project: 'roblox' | 'automaton' | 'finance' }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="st-act"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await hubActions.refresh(project)
          useHub.getState().say(`${ZONE[project].label} refreshed`)
        } catch (e) {
          useHub.getState().say((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Refreshing…' : 'Refresh now'}
    </button>
  )
}

export function Detail() {
  const sel = useStation((s) => s.selected)
  const model = useStation((s) => s.model)
  const select = useStation((s) => s.select)
  const fly = useStation((s) => s.fly)
  const go = useHub((s) => s.go)
  const job = useHub((s) => (sel?.kind === 'job' ? s.state?.jobs[sel.id] : undefined))
  const item = useHub((s) => (sel?.kind === 'item' ? s.state?.items[sel.id] : undefined))
  if (!sel || !model) return null
  const d = describe(sel, model)
  const close = () => {
    select(null)
    fly('overview')
  }
  const project = sel.zone === 'roblox' || sel.zone === 'automaton' || sel.zone === 'finance' ? sel.zone : null
  return (
    <section className="st-detail" style={{ '--zc': ZONE[sel.zone].color } as CSSProperties}>
      <header>
        <span className="st-detail-kicker">{d?.kicker ?? ZONE[sel.zone].label}</span>
        <button className="st-detail-x" onClick={close} aria-label="Close and return to overview">
          ×
        </button>
      </header>
      {!d ? (
        <p className="st-detail-gone">This is no longer in the live data — it may have finished or been removed.</p>
      ) : job ? (
        <JobCard job={job} />
      ) : item ? (
        <ItemCard item={item} />
      ) : (
        <>
          <h3>{d.title}</h3>
          <span className={`st-detail-state t-${d.tone}`}>{d.status}</span>
          <ul>
            {d.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      {d && <p className="st-detail-src">Source: {d.source}</p>}
      <footer>
        {project && (sel.kind === 'zone' || sel.kind === 'service') && <Refresh project={project} />}
        <button className="st-act" onClick={() => go(PAGE[sel.zone])}>
          Open {sel.zone === 'core' ? 'Settings' : ZONE[sel.zone].label} page ›
        </button>
      </footer>
    </section>
  )
}
