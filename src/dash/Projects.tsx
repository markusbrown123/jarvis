import { useEffect, useState } from 'react'
import { useHub, hubActions, type Autopilot, type Stream } from '../hub/client'
import type { Job } from '../hub/types'
import { ago } from '../hub/format'
import { useStation } from '../station/stationStore'
import { Chip, Empty, ItemCard } from './shared'
import { openItems, useTick } from './state'

/**
 * Projects: the six streams of work, from their bases (bases/<id>/BRIEF.md,
 * served by streams.mjs).
 *
 * The three newer ones JARVIS builds himself (autopilot.mjs): each card shows
 * the run going now and the step it's on, what the last run did, what it's
 * waiting on Markus for, and the brief's milestones as they're ticked — with
 * Work on it now, Pause, and a line to tell JARVIS something about it. The
 * three with pages of their own (Roblox, Automaton, Finance) link to them.
 */

const PAGE: Record<string, 'roblox' | 'automaton' | 'finance'> = { roblox: 'roblox', automaton: 'automaton', finance: 'finance' }

/** The desk's Claude Code tab, with this project's brief and a question filled in, for Markus to start. */
function askAtDesk(s: Stream) {
  const next = s.milestones.find((m) => !m.done)
  const prompt = `This is the "${s.name}" stream. Its brief:\n\n${s.brief}\n\nTell me where it stands from what's in this project, and the one next step you'd take${next ? ` (the brief's next milestone: "${next.text}")` : ''}. Don't change anything yet.`
  useHub.getState().setPrefs({ view: 'station', immersive: false })
  const st = useStation.getState()
  if (st.mode !== 'talk') st.setMode('talk')
  st.setDesk({ tab: 'code', session: null, draft: { project: s.project, prompt } })
}

/** The run going now, or the last one, for a project. */
function useRuns(project: string) {
  const jobs = useHub((x) => x.state?.jobs)
  const all = Object.values(jobs ?? {})
    .filter((j: Job) => j.project === project && j.autopilot)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const live = all.find((j) => j.state === 'running' || j.state === 'cancel_requested') ?? null
  const last = all.find((j) => j !== live && ['completed', 'failed', 'canceled'].includes(j.state)) ?? null
  return { live, last, runs: all.length }
}

/** The plain summary a run ended with (before its NEED / LESSON lines). */
const summary = (out = '') =>
  out
    .split('\n')
    .filter((l) => !/^\s*(NEED|LESSON|BLOCKED)\b/.test(l))
    .join('\n')
    .trim()

function Building({ s, ap, writes, onChange }: { s: Stream; ap: Autopilot; writes: boolean; onChange: () => void }) {
  useTick(5000)
  const { live, last, runs } = useRuns(s.project)
  const items = openItems(useHub((x) => x.state?.items), false).filter((i) => i.project === s.project)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const say = useHub((x) => x.say)
  const act = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await f()
      say(done)
      onChange()
    } catch (err) {
      say((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="project-build">
      {live ? (
        <div className="project-live">
          <span className="project-pulse" aria-hidden />
          <div>
            <b>Working now:</b> {live.title.replace(`${s.name}: `, '')}
            <div className="muted small">
              {live.stage ?? 'starting'} · started {ago(live.createdAt ?? live.updatedAt)}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted small project-next">
          {ap.off
            ? 'Autopilot is off on this Mac (JARVIS_NO_AUTOPILOT).'
            : ap.paused
              ? 'Paused — JARVIS leaves it until you say.'
              : ap.waiting
                ? 'Waiting on you (below) before the next run.'
                : `JARVIS works on it in turn${ap.lastAt ? ` · last run ${ago(ap.lastAt)}` : ' · not run yet'}.`}
        </p>
      )}
      {!writes && <p className="project-warn small">JARVIS is in read-only mode, so a run can plan but not write files. Start him with plain `jarvis` (write mode) for real building.</p>}
      {last && (
        <details className="project-last">
          <summary>
            Last run · {last.state === 'completed' ? 'done' : last.state} {ago(last.updatedAt)} · {last.title.replace(`${s.name}: `, '')}
          </summary>
          <pre>{summary(last.output) || last.stage}</pre>
        </details>
      )}
      {items.length > 0 && (
        <div className="project-needs">
          {items.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </div>
      )}
      <div className="item-actions">
        <button className="btn btn-primary" disabled={busy || Boolean(live)} onClick={() => act(() => hubActions.projectWork(s.project), `Working on ${s.name}`)}>
          {live ? 'Working…' : 'Work on it now'}
        </button>
        <button className="btn" disabled={busy} onClick={() => act(() => hubActions.projectPause(s.project, !ap.paused), ap.paused ? 'Back on' : 'Paused')}>
          {ap.paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <form
        className="project-note"
        onSubmit={(e) => {
          e.preventDefault()
          if (!note.trim()) return
          void act(() => hubActions.projectNote(s.project, note), 'Noted in the brief').then(() => setNote(''))
        }}
      >
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell JARVIS something about it (a choice, an answer)…" aria-label={`Note for ${s.name}`} />
        <button className="btn" type="submit" disabled={!note.trim() || busy}>
          Add
        </button>
      </form>
      {runs > 0 && <p className="muted small">{runs} run{runs === 1 ? '' : 's'} so far · every run is in Jobs too</p>}
    </div>
  )
}

function StreamCard({ s, ap, links, writes, onChange }: { s: Stream; ap?: Autopilot; links: { label: string; url: string }[]; writes: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const go = useHub((x) => x.setPrefs)
  const done = s.milestones.filter((m) => m.done).length
  const page = PAGE[s.project]
  const started = done > 0 || !/^not started/i.test(s.status)
  return (
    <section className="card project-card">
      <header className="card-head">
        <h3>{s.name}</h3>
        <Chip tone={started ? 'ok' : 'idle'}>{ap ? 'JARVIS builds it' : started ? 'running' : 'not started'}</Chip>
      </header>
      <p className="project-line">{s.line}</p>
      <p className="project-status">
        <span className="muted">Status</span> {s.status}
      </p>
      {s.milestones.length > 0 && (
        <>
          <div className="project-progress" aria-label={`${done} of ${s.milestones.length} milestones done`}>
            <span style={{ width: `${(done / s.milestones.length) * 100}%` }} />
          </div>
          <ul className="project-milestones">
            {s.milestones.map((m) => (
              <li key={m.text} className={m.done ? 'done' : ''}>
                <span aria-hidden>{m.done ? '✓' : '○'}</span> {m.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.project === 'finance' && links.length > 0 && (
        <p className="project-links">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ))}
        </p>
      )}
      {ap ? (
        <Building s={s} ap={ap} writes={writes} onChange={onChange} />
      ) : (
        <div className="item-actions">
          {page && (
            <button className="btn btn-primary" onClick={() => go({ view: page })}>
              Open {page[0].toUpperCase() + page.slice(1)}
            </button>
          )}
          <button className="btn" onClick={() => askAtDesk(s)}>
            Ask Claude Code where it stands
          </button>
        </div>
      )}
      <button className="btn btn-quiet project-brief-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide the brief' : 'Read the brief'}
      </button>
      {open && <pre className="project-brief">{s.brief}</pre>}
    </section>
  )
}

type Data = { streams: Stream[]; links: { label: string; url: string }[]; autopilot: Record<string, Autopilot> }

export function Projects() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const writes = useHub((x) => x.code.writes)
  // A run finishing ticks milestones in its brief: read them again when one does.
  const finished = useHub((x) => Object.values(x.state?.jobs ?? {}).filter((j) => j.autopilot && j.state !== 'running').length)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    hubActions
      .streams()
      .then((d) => live && (setData(d), setErr(null)))
      .catch((e: Error) => live && setErr(e.message))
    const t = setTimeout(() => setNonce((n) => n + 1), 30000)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [finished, nonce])
  const refresh = () => setNonce((n) => n + 1)
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">
            Everything you're building. JARVIS builds the newer three himself, a step at a time, and shows each run here; the others have pages of their own. Say "Jarvis, where are we with …" for any of them.
          </p>
        </div>
      </header>
      {err && !data && <Empty title="Couldn't read the projects">{err}</Empty>}
      {!data && !err && <Empty title="Reading the projects…" />}
      {data && (
        <div className="projects-grid">
          {[...data.streams]
            .sort((a, b) => Number(Boolean(data.autopilot[b.project])) - Number(Boolean(data.autopilot[a.project])))
            .map((s) => (
              <StreamCard key={s.id} s={s} ap={data.autopilot[s.project]} links={data.links} writes={writes} onChange={refresh} />
            ))}
        </div>
      )}
    </div>
  )
}
