import { useEffect, useRef, useState } from 'react'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import './phonelock.css'

/**
 * The phone's way in, instead of the Mac's start screen and the station's
 * flight from the sea: a lock screen. The time, and JARVIS's emblem — rings
 * of light round a glowing core, arcs of electricity crackling over them.
 * Tap it (Safari needs a tap before he can speak or listen) and it charges
 * up, flashes, and the view dives through the core into the app underneath.
 *
 * Drawn as vectors, so it's sharp at any screen density; the motion is CSS
 * transforms the phone's compositor runs, plus a few arcs redrawn on a timer.
 * If starting him fails it comes back, saying why.
 */

const OPEN_MS = 1400

/** A jagged line from one point to another, like a spark: midpoint displacement. */
function bolt(x1: number, y1: number, x2: number, y2: number, rough: number, depth = 5): string {
  let pts: [number, number][] = [
    [x1, y1],
    [x2, y2],
  ]
  for (let d = 0; d < depth; d++) {
    const next: [number, number][] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      const off = (Math.random() - 0.5) * rough * len
      next.push([ax, ay], [(ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off])
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
}

/** A spark along the rings: between two points on a circle a little way apart. */
function ringBolt(r: number): string {
  const a = Math.random() * Math.PI * 2
  const b = a + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.5)
  const r2 = r + (Math.random() - 0.5) * 30
  return bolt(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r2, Math.sin(b) * r2, 0.45)
}

/** From the core out past the rings, for the surge as it opens. */
function surgeBolt(): string {
  const a = Math.random() * Math.PI * 2
  return bolt(Math.cos(a) * 40, Math.sin(a) * 40, Math.cos(a) * 205, Math.sin(a) * 205, 0.35, 6)
}

const TICKS = Array.from({ length: 120 }, (_, i) => {
  const a = (i / 120) * Math.PI * 2
  const long = i % 10 === 0
  const r0 = long ? 178 : 184
  return `M${(Math.cos(a) * r0).toFixed(1)} ${(Math.sin(a) * r0).toFixed(1)}L${(Math.cos(a) * 192).toFixed(1)} ${(Math.sin(a) * 192).toFixed(1)}`
}).join('')
const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 - Math.PI / 2
  return `${(Math.cos(a) * 64).toFixed(1)},${(Math.sin(a) * 64).toFixed(1)}`
}).join(' ')

export function PhoneLock({ onStart }: { onStart: () => void }) {
  const phase = useStore((s) => s.phase)
  const error = useStore((s) => s.error)
  const link = useHub((s) => s.link)
  // Already running (coming back to the page): no lock.
  const [stage, setStage] = useState<'locked' | 'opening' | 'gone'>(() => (useStore.getState().phase === 'offline' ? 'locked' : 'gone'))
  const [now, setNow] = useState(() => new Date())
  const [bolts, setBolts] = useState<string[]>([])
  const reduced = useHub((s) => s.prefs.reducedMotion)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(t)
  }, [])

  // If starting him failed, back to the lock to say so and try again; if he
  // started some other way while it was up, it opens by itself.
  useEffect(() => {
    if (stage === 'gone' && phase === 'offline' && error) setStage('locked')
    if (stage === 'locked' && phase !== 'offline') setStage('opening')
  }, [stage, phase, error])

  // The sparks: now and then over the rings while locked; a storm from the core while opening.
  useEffect(() => {
    if (stage === 'gone' || reduced) return setBolts([])
    if (stage === 'opening') {
      const t = setInterval(() => setBolts(Array.from({ length: 9 }, surgeBolt)), 55)
      return () => clearInterval(t)
    }
    let live = true
    const flicker = () => {
      if (!live) return
      setBolts(Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => ringBolt([128, 150, 172][Math.floor(Math.random() * 3)])))
      timer.current = window.setTimeout(
        () => {
          setBolts([])
          timer.current = window.setTimeout(flicker, 500 + Math.random() * 1600)
        },
        70 + Math.random() * 110,
      )
    }
    timer.current = window.setTimeout(flicker, 700)
    return () => {
      live = false
      clearTimeout(timer.current)
    }
  }, [stage, reduced])

  useEffect(() => {
    // Dev: hold it open (window.__plockHold) to look at the dive frame by frame.
    if (stage !== 'opening' || (import.meta.env.DEV && (window as { __plockHold?: boolean }).__plockHold)) return
    const t = setTimeout(() => setStage('gone'), reduced ? 350 : OPEN_MS)
    return () => clearTimeout(t)
  }, [stage, reduced])

  if (stage === 'gone') return null

  const open = () => {
    if (stage !== 'locked') return
    setStage('opening')
    onStart()
  }
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const status = phase === 'offline' && error ? `Couldn't start: ${error}` : link === 'live' ? 'Linked to your Mac' : link === 'down' ? "Can't reach your Mac yet" : 'Finding your Mac…'

  return (
    <div className={`plock plock-${stage} ${reduced ? 'plock-still' : ''}`} onClick={open} role="button" aria-label="Unlock JARVIS" tabIndex={0}>
      <div className="plock-bg" aria-hidden />
      <header className="plock-clock">
        <p className="plock-date">{date}</p>
        <p className="plock-time">{time}</p>
      </header>
      <div className="plock-emblem" aria-hidden>
        <svg viewBox="-210 -210 420 420">
          <defs>
            <radialGradient id="plock-core">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.25" stopColor="#d6f1ff" />
              <stop offset="0.55" stopColor="#38bdf8" stopOpacity="0.85" />
              <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
            </radialGradient>
            <filter id="plock-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className="plock-spinup">
            <g className="plock-ring plock-ticks">
              <path d={TICKS} />
              <circle r="196" className="plock-hair" />
            </g>
            <g className="plock-ring plock-arcs">
              <circle r="168" pathLength="100" strokeDasharray="22 11.33" />
            </g>
            <g className="plock-ring plock-dashes">
              <circle r="150" pathLength="240" strokeDasharray="1 3" />
            </g>
            <g className="plock-ring plock-inner" filter="url(#plock-glow)">
              <circle r="128" />
            </g>
            <g className="plock-ring plock-segs">
              <circle r="100" pathLength="120" strokeDasharray="7 3" />
            </g>
          </g>
          <polygon className="plock-hex" points={HEX} />
          <circle className="plock-core" r="54" fill="url(#plock-core)" />
          <g className="plock-bolts" filter="url(#plock-glow)">
            {bolts.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        </svg>
        <p className="plock-name">J.A.R.V.I.S.</p>
      </div>
      <footer className="plock-foot">
        <p className="plock-hint">{phase === 'offline' && error ? 'Tap to try again' : 'Tap to unlock'}</p>
        <p className={`plock-status ${link === 'live' ? 'ok' : ''}`}>
          <i />
          {status}
        </p>
      </footer>
      <div className="plock-flash" aria-hidden />
    </div>
  )
}
