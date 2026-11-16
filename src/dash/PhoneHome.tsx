import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useHub, type View } from '../hub/client'
import { useStreamsLive } from '../hub/streams'
import { useStore } from '../store'
import { ago } from '../hub/format'
import { BuildTower, colorOf, nextIndex } from './progress'
import { inputState, openItems, useTick } from './state'

/**
 * The phone's Home: how things are moving, at a glance. JARVIS and his state;
 * the four projects he builds as a skyline of towers, a level per milestone
 * done (the same builds as their pads in the station); what's moved this
 * week; and the milestones done lately, newest first. Levels done since you
 * last opened it rise into place, and say so.
 */

// Markus's focus first: real estate and the client sites.
const PROJECTS = [
  { id: 'realestate', label: 'Real estate' },
  { id: 'automaton', label: 'Sites' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'influencer', label: 'Influencer' },
]
const WEEK = 7 * 24 * 3600 * 1000
const SEEN = 'jarvis.phone.seen'

const readSeen = (): Record<string, number> | null => {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? 'null')
  } catch {
    return null
  }
}

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** JARVIS's emblem, small: rings round a core in the colour of what he's doing. */
function Core({ tone }: { tone: string }) {
  return (
    <svg className={`home-core home-core-${tone}`} viewBox="-50 -50 100 100" aria-hidden>
      <g className="hc-spin">
        <circle r="44" pathLength="100" strokeDasharray="22 11.33" className="hc-arcs" />
      </g>
      <g className="hc-spin-rev">
        <circle r="34" pathLength="120" strokeDasharray="7 3" className="hc-segs" />
      </g>
      <circle r="24" className="hc-ring" />
      <circle r="15" className="hc-glow" />
    </svg>
  )
}

export function PhoneHome() {
  useTick(30000)
  const { data } = useStreamsLive()
  const s = useHub((x) => x.state)
  const go = useHub((x) => x.go)
  useStore((x) => x.phase)
  const st = inputState()
  const jobs = Object.values(s?.jobs ?? {})
  const needs = openItems(s?.items).length

  const projects = useMemo(
    () =>
      PROJECTS.map((p) => {
        const stream = data?.streams.find((x) => x.project === p.id)
        const steps = stream?.milestones ?? []
        const live = jobs.find((j) => j.project === p.id && j.autopilot && j.state === 'running') ?? null
        const ap = data?.autopilot[p.id]
        return { ...p, stream, steps, done: steps.filter((m) => m.done).length, live, waiting: Boolean(ap && (ap.blocked || ap.waiting > 0)), next: steps[nextIndex(steps)]?.text ?? null }
      }),
    [data, jobs],
  )

  // Levels done since you last looked: they rise in, then count as seen.
  const [seen] = useState(readSeen)
  const rose = (id: string, done: number) => (seen && seen[id] !== undefined ? Math.max(0, done - seen[id]) : 0)
  const doneKey = data ? projects.map((p) => `${p.id}:${p.done}`).join(',') : ''
  useEffect(() => {
    if (!doneKey) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries(doneKey.split(',').map((kv) => [kv.split(':')[0], Number(kv.split(':')[1])]))))
      } catch {
        /* private mode: it just won't remember */
      }
    }, 4000)
    return () => clearTimeout(t)
  }, [doneKey])
  const fresh = projects.filter((p) => rose(p.id, p.done) > 0)

  const history = projects.flatMap((p) => (p.stream?.history ?? []).map((h) => ({ ...h, project: p.id, label: p.label }))).sort((a, b) => b.at - a.at)
  const now = Date.now()
  const doneWeek = history.filter((h) => now - h.at < WEEK).length
  const runsWeek = jobs.filter((j) => j.autopilot && now - (j.createdAt ?? j.updatedAt) < WEEK).length
  const levels = projects.reduce((n, p) => n + p.done, 0)
  const total = projects.reduce((n, p) => n + p.steps.length, 0)
  const building = projects.filter((p) => p.live)
  const running = jobs.filter((j) => j.state === 'running')

  const open = (v: View, anchor?: string) => {
    go(v)
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
  }

  return (
    <div className="view home">
      <header className="home-hero">
        <div>
          <p className="home-hello">{greeting()}, Markus</p>
          <p className={`home-state home-state-${st.tone}`}>
            <i />
            {st.label.split(' — ')[0]}
            {building.length > 0 && <span> · building {building.map((b) => b.label).join(', ')}</span>}
          </p>
        </div>
        <Core tone={st.tone} />
      </header>

      {fresh.length > 0 && (
        <button className="home-new" onClick={() => open('projects', `project-${fresh[0].id}`)}>
          <b>New since you last looked</b>
          {fresh.map((p) => (
            <span key={p.id} style={{ '--c': colorOf(p.id) } as CSSProperties}>
              {p.label} rose {rose(p.id, p.done) === 1 ? 'a level' : `${rose(p.id, p.done)} levels`}: {p.stream?.history[0]?.text.split(' — ')[0]}
            </span>
          ))}
        </button>
      )}

      <section className="home-card home-skyline">
        <header>
          <h2>Projects</h2>
          <span className="home-meta">
            {levels} of {total || '…'} levels built
          </span>
        </header>
        <div className="skyline">
          {projects.map((p) => (
            <button key={p.id} className="sky" onClick={() => open('projects', `project-${p.id}`)} style={{ '--c': colorOf(p.id) } as CSSProperties}>
              <BuildTower steps={p.steps} color={colorOf(p.id)} live={Boolean(p.live)} rose={rose(p.id, p.done)} size={84} />
              <span className="sky-name">{p.label}</span>
              <span className="sky-level">
                Lv <b>{p.done}</b>/{p.steps.length || '–'}
              </span>
              <span className={`sky-state ${p.live ? 'is-live' : p.waiting ? 'is-wait' : ''}`}>
                {p.live ? 'building now' : p.waiting ? 'needs you' : p.done === p.steps.length && p.steps.length ? 'all built' : 'next up'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="home-stats">
        <button className="stat" onClick={() => open('projects')}>
          <b>+{doneWeek}</b>
          <span>levels this week</span>
        </button>
        <button className="stat" onClick={() => open('jobs')}>
          <b>{runsWeek}</b>
          <span>runs this week</span>
        </button>
        <button className={`stat ${needs ? 'stat-need' : ''}`} onClick={() => open('needs')}>
          <b>{needs}</b>
          <span>need{needs === 1 ? 's' : ''} you</span>
        </button>
      </div>

      {running.length > 0 && (
        <section className="home-card home-running">
          <h2>Working now</h2>
          {running.slice(0, 3).map((j) => (
            <button key={j.id} className="run" onClick={() => open('jobs')}>
              <i className="run-pulse" />
              <span className="run-title">{j.title}</span>
              <span className="run-stage">
                {j.stage ?? 'starting'} · {ago(j.createdAt ?? j.updatedAt)}
              </span>
            </button>
          ))}
        </section>
      )}

      <section className="home-card home-recent">
        <h2>Recent progress</h2>
        {history.length ? (
          <ol className="timeline">
            {history.slice(0, 6).map((h) => (
              <li key={`${h.project}:${h.text}`} style={{ '--c': colorOf(h.project) } as CSSProperties}>
                <i aria-hidden />
                <span className="tl-text">{h.text.split(' — ')[0]}</span>
                <span className="tl-meta">
                  {h.label} · {ago(h.at)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="home-empty">{data ? 'Nothing built yet: the first levels are on their way.' : 'Reading the projects…'}</p>
        )}
      </section>
    </div>
  )
}
