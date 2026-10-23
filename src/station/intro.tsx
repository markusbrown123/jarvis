import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { seatCamera } from './layout'
import { SKY_STATE, WEATHER } from './sky'
import { useStation } from './stationStore'

/**
 * The opening, like a game's loading screen: while the house streams in,
 * the camera waits far out over the sea; then it flies — low over the
 * waves past the boats, rising to see the whole estate on its headland, down
 * over the terrace and the pool, in through the open glass, round the stage past the
 * drones and the build bay, and settles behind the chair at the desk, where
 * Talk mode takes over. Letterbox bars, the title and the real place, time
 * and weather over it; any key or a click skips it.
 *
 * It plays once each time the app opens (not when coming back to the
 * station from another tab: the station's store remembers), and not at
 * all with reduced motion.
 */

/** Seconds along the flight for each waypoint. */
const KEYS: { t: number; pos: [number, number, number]; look: [number, number, number]; fov: number }[] = [
  // Low over the waves out in the bay…
  { t: 0, pos: [-470, -23, -360], look: [-60, -6, -20], fov: 30 },
  { t: 3.2, pos: [-290, -16, -230], look: [-10, -4, 5], fov: 32 },
  // …rising to see the whole estate on its headland…
  { t: 6.4, pos: [-150, 32, -90], look: [14, -2, 22], fov: 34 },
  { t: 9.0, pos: [-62, 26, -46], look: [8, 0, 12], fov: 38 },
  // …down over the terrace and the pool, in through the open glass…
  { t: 11.0, pos: [-17, 7.5, -42], look: [0, 1.5, -12], fov: 42 },
  { t: 12.8, pos: [-2.5, 3.3, -24.5], look: [0, 2.3, -10], fov: 46 },
  { t: 14.2, pos: [0, 2.7, -15.4], look: [-1, 2.2, -6], fov: 50 },
  // …round the stage, past the drones and the build bay, to the desk.
  { t: 15.7, pos: [-5.2, 3.3, -8.6], look: [-0.5, 1.5, -3.5], fov: 50 },
  { t: 17.3, pos: [-6.9, 3.1, 0.6], look: [0, 1.3, -1.6], fov: 46 },
]
const SETTLE = 1.6 // from the last waypoint to the seat

function flight(aspect: number) {
  const seat = seatCamera(aspect)
  const keys = [...KEYS, { t: KEYS[KEYS.length - 1].t + SETTLE, pos: seat.pos, look: seat.target, fov: 38 }]
  const pos = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.pos)), false, 'centripetal')
  const look = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.look)), false, 'centripetal')
  return { keys, pos, look, end: keys[keys.length - 1].t }
}

/** The camera during the opening (inside the canvas). */
export function IntroFlight() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const phase = useStation((s) => s.intro)
  const setIntro = useStation((s) => s.setIntro)
  const path = useMemo(() => flight(size.width / Math.max(1, size.height)), [size.width, size.height])
  const start = useRef<number | null>(null)
  const readyAt = useRef<number | null>(null)
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), l: new THREE.Vector3(), d: new THREE.Vector3(), from: new THREE.Vector3() }), [])
  // With reduced motion there's no flight: straight to the desk.
  useEffect(() => {
    const st = useStation.getState()
    if (useHub.getState().prefs.reducedMotion) setIntro('done')
    else if (st.intro !== 'done' && st.mode !== 'talk') st.setMode('talk')
  }, [setIntro])

  useFrame((st) => {
    if (phase === 'done') return
    const now = st.clock.elapsedTime
    const k = path.keys
    if (phase === 'loading') {
      // Hold out over the sea, drifting with the swell, until the house has loaded.
      tmp.d.set(Math.sin(now * 0.21) * 4, Math.sin(now * 0.37) * 0.5, Math.sin(now * 0.13) * 5)
      camera.position.set(...k[0].pos).add(tmp.d)
      camera.lookAt(tmp.l.set(...k[0].look))
      camera.fov = k[0].fov
      camera.updateProjectionMatrix()
      if (!useProgress.getState().active && readyAt.current === null) readyAt.current = now
      // Start once loaded (and the first frames have compiled), or give up waiting after 40 s.
      if ((readyAt.current !== null && now - readyAt.current > 0.8) || now > 40) {
        setIntro('flying')
        start.current = now
        tmp.from.copy(tmp.d)
      }
      return
    }
    if (start.current === null) start.current = now
    // Dev: hold the flight at a moment for a look (window.__introAt = seconds),
    // or put the camera anywhere (window.__introCam = { pos, look, fov }).
    const held = import.meta.env.DEV ? (window as { __introAt?: number }).__introAt : undefined
    const shot = import.meta.env.DEV ? (window as { __introCam?: { pos: [number, number, number]; look: [number, number, number]; fov: number } }).__introCam : undefined
    if (shot) {
      camera.position.set(...shot.pos)
      camera.lookAt(tmp.l.set(...shot.look))
      camera.fov = shot.fov
      camera.updateProjectionMatrix()
      return
    }
    const t = held ?? now - start.current
    if (t >= path.end) {
      setIntro('done')
      return
    }
    // Time → position along the waypoints, eased in at the start and out at the seat.
    let i = 0
    while (i < k.length - 2 && t > k[i + 1].t) i++
    let s = (t - k[i].t) / (k[i + 1].t - k[i].t)
    if (i === 0) s = s * s * (2 - s)
    if (i === k.length - 2) s = 1 - (1 - s) * (1 - s) * (1 - s)
    const u = Math.min(1, (i + s) / (k.length - 1))
    path.pos.getPoint(u, tmp.p)
    path.look.getPoint(u, tmp.l)
    // Carry on from where the drift had got to, easing onto the path.
    tmp.p.addScaledVector(tmp.from, Math.max(0, 1 - t / 2.5))
    camera.position.copy(tmp.p)
    camera.lookAt(tmp.l)
    camera.fov = k[i].fov + (k[i + 1].fov - k[i].fov) * s
    camera.updateProjectionMatrix()
  })

  // Back to the normal lens once it's over.
  useEffect(() => {
    if (phase !== 'done') return
    camera.fov = 38
    camera.updateProjectionMatrix()
  }, [phase, camera])
  return null
}

/**
 * While it loads: stills of the house and the estate rendered in Blender
 * with Cycles (tools/blender/showcase.py) and of the drones, slowly panning
 * and crossfading — the way a game's loading screen shows its artwork —
 * until the flight cuts in. Any that haven't been rendered are just left out.
 */
const SLIDES = ['aerial', 'night', 'hero_quad', 'hero_whoop'].map((n) => `/station/loading/${n}.jpg`)

function Slides({ on }: { on: boolean }) {
  const [ready, setReady] = useState<string[]>([])
  const [i, setI] = useState(0)
  useEffect(() => {
    let live = true
    for (const src of SLIDES) {
      const im = new Image()
      im.onload = () => live && setReady((r) => SLIDES.filter((s) => s === src || r.includes(s)))
      im.src = src
    }
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (ready.length < 2) return
    const t = setInterval(() => setI((n) => n + 1), 5200)
    return () => clearInterval(t)
  }, [ready.length])
  if (!ready.length) return null
  // After dark, start with the estate at night.
  const first = SKY_STATE.sunAlt < -6 ? Math.max(0, ready.findIndex((s) => s.includes('night'))) : 0
  const cur = (first + i) % ready.length
  const prev = (cur - 1 + ready.length) % ready.length
  return (
    <div className={`cine-slides${on ? '' : ' cine-slides-out'}`}>
      {ready.map((src, k) => (
        <div
          key={src}
          className={`cine-slide${k === cur ? ' on' : k === prev && ready.length > 1 && i > 0 ? ' off' : ''}`}
          style={{ backgroundImage: `url(${src})`, ['--pan' as string]: k % 2 ? '-2.5%' : '2.5%' }}
        />
      ))}
    </div>
  )
}

const TIPS = [
  'Say “Hey Jarvis” any time — or hold Space and talk.',
  'F gets you up from the desk to walk the house. The glass ahead opens onto the terrace.',
  'C for Cinematic — then scroll right out to see the house from over the sea.',
  'Every drone flight is real work: a delivery, a data run, or a zone that needs you.',
  'The sky is the real sky where you are: the sun, the moon, the clouds and the rain.',
  'The build bay grows a tower for every job — one floor per step it reports.',
]

/** The letterbox, title and loading read-out over the opening (in the page). */
export function IntroOverlay() {
  const phase = useStation((s) => s.intro)
  const setIntro = useStation((s) => s.setIntro)
  const { progress, active } = useProgress()
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)])
  const [, tick] = useState(0)
  // Stays a moment after landing, so the letterbox can slide away.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (phase !== 'done') return
    setLeaving(true)
    const t = setTimeout(() => setLeaving(false), 1100)
    return () => clearTimeout(t)
  }, [phase])
  useEffect(() => {
    if (phase === 'done') return
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.metaKey || e.ctrlKey || e.altKey)) return
      // The key that skips does nothing else.
      e.stopImmediatePropagation()
      e.preventDefault()
      setIntro('done')
    }
    // Any key or click skips (once there's something to skip to).
    const on = phase === 'flying'
    if (on) {
      window.addEventListener('keydown', skip, true)
      window.addEventListener('pointerdown', skip, true)
    }
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      window.removeEventListener('keydown', skip, true)
      window.removeEventListener('pointerdown', skip, true)
      clearInterval(t)
    }
  }, [phase, setIntro])
  if (phase === 'done' && !leaving) return null
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const place = WEATHER.place || Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace(/_/g, ' ') || ''
  const sky = WEATHER.live ? WEATHER.summary : SKY_STATE.sunAlt > 0 ? 'daylight' : SKY_STATE.sunAlt > -8 ? 'twilight' : 'night'
  return (
    <div className={`cine cine-${phase === 'done' ? 'leave' : phase}`} aria-label="Loading the station">
      {phase !== 'done' && <Slides on={phase === 'loading'} />}
      <div className="cine-bar cine-bar-top" />
      <div className="cine-bar cine-bar-bottom" />
      <div className="cine-title">
        <h1>J.A.R.V.I.S.</h1>
        <p>
          {[place, time, sky].filter(Boolean).join('  ·  ')}
        </p>
      </div>
      {phase === 'loading' ? (
        <div className="cine-load">
          <p className="cine-tip">{tip}</p>
          <div className="cine-progress">
            <span style={{ width: `${Math.round(active ? progress : 100)}%` }} />
          </div>
          <p className="cine-status">
            <i className="cine-spin" /> Loading the house {Math.round(active ? progress : 100)}%
          </p>
        </div>
      ) : (
        <p className="cine-skip">Any key to skip</p>
      )}
    </div>
  )
}
