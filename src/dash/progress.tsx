import type { CSSProperties } from 'react'

/**
 * How far a project has got, drawn: the same build as its pad in the station
 * (projectpads.tsx) — a tower with a level for every milestone in its brief,
 * solid once done, a scaffold for the next (pulsing while JARVIS is on it),
 * a faint outline for the rest — plus a bar of those levels and the steps
 * themselves. Levels done since you last looked rise into place.
 */

export type Step = { done: boolean; text: string; waiting?: boolean }

/** The project colours, as on the station's pads. */
export const PROJECT_COLOR: Record<string, string> = { realestate: '#a3e635', youtube: '#fb7185', influencer: '#e879f9' }
export const colorOf = (project: string) => PROJECT_COLOR[project] ?? '#38bdf8'

/** Which step is next: the first not done and not waiting on Markus, else the first not done. */
export function nextIndex(steps: Step[]) {
  const i = steps.findIndex((m) => !m.done && !m.waiting)
  return i >= 0 ? i : steps.findIndex((m) => !m.done)
}

/** One level of the tower: a hexagonal slab seen from a little above (its top and three front faces). */
function slab(cx: number, yTop: number, r: number, h: number) {
  const ry = r * 0.3
  const pt = (deg: number, y: number) => [cx + r * Math.cos((deg * Math.PI) / 180), y + ry * Math.sin((deg * Math.PI) / 180)] as const
  const face = (a: number, b: number) => {
    const [x1, y1] = pt(a, yTop)
    const [x2, y2] = pt(b, yTop)
    return `${x1},${y1} ${x2},${y2} ${x2},${y2 + h} ${x1},${y1 + h}`
  }
  const top = [0, 60, 120, 180, 240, 300].map((d) => pt(d, yTop).join(',')).join(' ')
  return { top, right: face(0, 60), front: face(60, 120), left: face(120, 180) }
}

export function BuildTower({ steps, color, live = false, rose = 0, size = 96 }: { steps: Step[]; color: string; live?: boolean; rose?: number; size?: number }) {
  const n = Math.max(1, steps.length)
  const W = 120
  const H = 150
  const levelH = Math.min(16, (H - 34) / n - 3)
  const gap = 3
  const next = nextIndex(steps)
  const done = steps.filter((m) => m.done).length
  const levels = Array.from({ length: n }, (_, i) => {
    const r = 44 - (20 * i) / Math.max(1, n - 1)
    const yTop = H - 14 - (i + 1) * (levelH + gap) + gap
    return { i, ...slab(W / 2, yTop, r, levelH), yTop }
  })
  // Done levels in order, wherever their milestone sits in the brief: the tower grows from the ground.
  const state = (i: number) => (i < done ? 'done' : steps[next] && i === done ? (steps[next].waiting ? 'waiting' : 'next') : 'todo')
  const topY = levels[Math.min(done, n - 1)]?.yTop ?? 0
  return (
    <svg className={`tower ${live ? 'tower-live' : ''}`} viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} style={{ '--c': color } as CSSProperties} aria-hidden>
      <ellipse cx={W / 2} cy={H - 10} rx={50} ry={11} className="tower-ground" />
      {live && done < n && <line x1={W / 2} y1={0} x2={W / 2} y2={topY} className="tower-beam" />}
      {levels.map((l) => {
        const st = state(l.i)
        // Levels done since you last looked rise into place, one after another.
        const fresh = st === 'done' && l.i >= done - rose
        return (
          <g key={l.i} className={`tower-level tower-${st} ${fresh ? 'tower-fresh' : ''}`} style={fresh ? ({ animationDelay: `${(l.i - (done - rose)) * 0.35 + 0.3}s` } as CSSProperties) : undefined}>
            <polygon points={l.left} className="f-left" />
            <polygon points={l.right} className="f-right" />
            <polygon points={l.front} className="f-front" />
            <polygon points={l.top} className="f-top" />
          </g>
        )
      })}
    </svg>
  )
}

/** The levels as a bar: done, next, waiting on you, to come. */
export function LevelBar({ steps, color, live = false }: { steps: Step[]; color: string; live?: boolean }) {
  const next = nextIndex(steps)
  return (
    <div className="levelbar" style={{ '--c': color } as CSSProperties} aria-hidden>
      {steps.map((m, i) => (
        <span key={i} className={m.done ? 'lb-done' : m.waiting ? 'lb-wait' : i === next ? `lb-next ${live ? 'lb-live' : ''}` : 'lb-todo'} />
      ))}
    </div>
  )
}

/** The milestones as steps down a line. */
export function MilestoneSteps({ steps, color, live = false }: { steps: Step[]; color: string; live?: boolean }) {
  const next = nextIndex(steps)
  return (
    <ol className="steps" style={{ '--c': color } as CSSProperties}>
      {steps.map((m, i) => {
        const st = m.done ? 'done' : m.waiting ? 'wait' : i === next ? 'next' : 'todo'
        return (
          <li key={m.text} className={`step step-${st}`}>
            <span className="step-node" aria-hidden>
              {st === 'done' ? '✓' : st === 'wait' ? '‖' : ''}
            </span>
            <span className="step-text">
              {/* JARVIS writes "what — the detail": the what to read, the detail under it. */}
              <span className="step-title">{m.text.split(' — ')[0]}</span>
              {st === 'next' && <em className="step-tag">{live ? 'building now' : 'next'}</em>}
              {st === 'wait' && <em className="step-tag">waiting on you</em>}
              {m.text.includes(' — ') && <span className="step-detail">{m.text.split(' — ').slice(1).join(' — ')}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
