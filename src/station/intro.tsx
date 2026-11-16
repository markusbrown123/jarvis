import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { TOUCH, useHub } from '../hub/client'
import { listenForClap, type ClapListener } from '../lib/clap'
import { useStore } from '../store'
import { HOUSE, seatCamera } from './layout'
import { SKY_STATE, WEATHER } from './sky'
import { useStation } from './stationStore'

/**
 * The opening, like a game's loading screen: while the house streams in, the
 * camera waits out over the sea; then, the way GTA Online opens, a run of
 * short shots with hard cuts between them — low over the waves past the
 * boats; the whole estate on its headland; the terrace and the pool; in
 * through the open glass; round the stage to settle behind the chair at the
 * desk, where Talk mode takes over. Each shot is a slow push, two or three
 * seconds; a brief flash marks each cut. Letterbox bars, the title and the
 * real place, time and weather over it; any key, a click, a clap or a finger
 * snap skips it.
 *
 * JARVIS says hello once the camera is inside (the store's `home`), not over
 * the sea — and straight away if the opening is skipped.
 *
 * It plays once each time the app opens (not when coming back to the
 * station from another tab: the station's store remembers), and not at
 * all with reduced motion.
 */

type Cam = { pos: [number, number, number]; look: [number, number, number]; fov: number }
type Shot = { dur: number; from: Cam; to: Cam | 'seat'; via?: Cam[]; ease?: 'out' }

const SHOTS: Shot[] = [
  // Low over the waves out in the bay, past the boats.
  { dur: 2.6, from: { pos: [-420, -21, -330], look: [-40, -5, -10], fov: 30 }, to: { pos: [-330, -16, -255], look: [-10, -4, 5], fov: 32 } },
  // The whole estate on its headland (framed as the aerial loading still, tools/blender/showcase.py).
  { dur: 2.8, from: { pos: [-150, 66, -112], look: [20, -4, 30], fov: 36 }, to: { pos: [-118, 52, -88], look: [16, -3, 26], fov: 38 } },
  // The terrace and the pool.
  { dur: 2.4, from: { pos: [-20, 8, -44], look: [0, 1.5, -12], fov: 42 }, to: { pos: [-8, 4.6, -32], look: [0, 2.2, -11], fov: 45 } },
  // In through the open glass, over the project builds, the desk ahead.
  { dur: 2.2, from: { pos: [-2.5, 3.3, -24.5], look: [0, 2.3, -10], fov: 46 }, to: { pos: [0, 3.9, -11.6], look: [-0.6, 1.6, -4.4], fov: 50 } },
  // Round the stage, past the drones and the build bay, to the chair.
  { dur: 2.6, from: { pos: [-5.4, 3.3, -7.2], look: [-0.5, 1.5, -3.2], fov: 50 }, via: [{ pos: [-6.6, 3.1, 0.2], look: [0, 1.3, -1.6], fov: 46 }], to: 'seat', ease: 'out' },
]

function flight(aspect: number) {
  const seat = seatCamera(aspect)
  let t = 0
  const shots = SHOTS.map((sh) => {
    const to: Cam = sh.to === 'seat' ? { pos: seat.pos, look: seat.target, fov: 38 } : sh.to
    const cams = [sh.from, ...(sh.via ?? []), to]
    const shot = {
      start: t,
      dur: sh.dur,
      ease: sh.ease,
      cams,
      pos: new THREE.CatmullRomCurve3(cams.map((c) => new THREE.Vector3(...c.pos)), false, 'centripetal'),
      look: new THREE.CatmullRomCurve3(cams.map((c) => new THREE.Vector3(...c.look)), false, 'centripetal'),
    }
    t += sh.dur
    return shot
  })
  return { shots, end: t }
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
  const shotNow = useRef(-1)
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), l: new THREE.Vector3(), d: new THREE.Vector3(), from: new THREE.Vector3() }), [])
  // With reduced motion there's no flight: straight to the desk.
  useEffect(() => {
    const st = useStation.getState()
    // Nor on a phone: it opens with its own lock screen (ui/PhoneLock.tsx).
    if (useHub.getState().prefs.reducedMotion || TOUCH) setIntro('done')
    else if (st.intro !== 'done' && st.mode !== 'talk') st.setMode('talk')
  }, [setIntro])

  useFrame((st) => {
    if (phase === 'done') return
    const now = st.clock.elapsedTime
    const first = path.shots[0].cams[0]
    if (phase === 'loading') {
      // Hold out over the sea, drifting with the swell, until the house has loaded.
      tmp.d.set(Math.sin(now * 0.21) * 4, Math.sin(now * 0.37) * 0.5, Math.sin(now * 0.13) * 5)
      camera.position.set(...first.pos).add(tmp.d)
      camera.lookAt(tmp.l.set(...first.look))
      camera.fov = first.fov
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
    const shotCam = import.meta.env.DEV ? (window as { __introCam?: Cam }).__introCam : undefined
    if (shotCam) {
      camera.position.set(...shotCam.pos)
      camera.lookAt(tmp.l.set(...shotCam.look))
      camera.fov = shotCam.fov
      camera.updateProjectionMatrix()
      return
    }
    const t = held ?? now - start.current
    if (t >= path.end) {
      setIntro('done')
      return
    }
    // Which shot, and how far through it: a slow push, eased.
    let i = 0
    while (i < path.shots.length - 1 && t >= path.shots[i + 1].start) i++
    const sh = path.shots[i]
    const r = Math.min(1, (t - sh.start) / sh.dur)
    const u = sh.ease === 'out' ? 1 - Math.pow(1 - r, 3) : r * r * (3 - 2 * r) * 0.35 + r * 0.65
    if (i !== shotNow.current) {
      shotNow.current = i
      // A cut: the overlay flashes.
      if (i > 0) useStation.getState().cutIntro()
    }
    sh.pos.getPoint(u, tmp.p)
    sh.look.getPoint(u, tmp.l)
    // The first shot carries on from where the drift had got to, easing onto the path.
    if (i === 0) tmp.p.addScaledVector(tmp.from, Math.max(0, 1 - t / 1.5))
    camera.position.copy(tmp.p)
    camera.lookAt(tmp.l)
    const seg = Math.min(sh.cams.length - 2, Math.floor(u * (sh.cams.length - 1)))
    const su = u * (sh.cams.length - 1) - seg
    camera.fov = sh.cams[seg].fov + (sh.cams[seg + 1].fov - sh.cams[seg].fov) * su
    camera.updateProjectionMatrix()
    // In through the glass: home.
    if (Math.hypot(tmp.p.x, tmp.p.z) < HOUSE.r - 0.3 && tmp.p.y < HOUSE.ceiling) useStation.getState().arriveHome()
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

/** Has the microphone been allowed already? Never prompts. */
async function micAllowed() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state === 'granted'
  } catch {
    return false
  }
}

/** The letterbox, title and loading read-out over the opening (in the page). */
const BOOT_WORD: Record<string, string> = {
  offline: 'starting',
  idle: 'starting',
  audio: 'warming up',
  bridge: 'linking the brain',
  microphone: 'opening the microphone',
  voice: 'starting the voice loop',
  ready: 'online',
}

export function IntroOverlay() {
  const phase = useStation((s) => s.intro)
  // The phase while he's off, the boot stage while he powers up, then online.
  const jarvis = useStore((s) => (s.phase === 'offline' ? 'offline' : s.phase === 'boot' ? s.bootStage : 'ready'))
  const setIntro = useStation((s) => s.setIntro)
  const cut = useStation((s) => s.introCut)
  const { progress, active } = useProgress()
  // The loader recounts as each new batch of files starts (60% → 0%); the
  // bar only ever moves forward.
  const most = useRef(0)
  if (active) most.current = Math.max(most.current, Math.round(progress))
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)])
  const [, tick] = useState(0)
  // Stays a moment after landing, so the letterbox can slide away.
  const [leaving, setLeaving] = useState(false)
  // Listening for a clap or a snap to skip.
  const [hears, setHears] = useState(false)
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
    // ...and so does a clap or a finger snap, on the Mac, once the microphone's
    // already allowed (the opening never asks for it). Lower than a clap to
    // start him: a snap is quieter, and its shape is just as sharp.
    let clap: ClapListener | null = null
    let gone = false
    if (on && !TOUCH)
      void micAllowed().then(async (ok) => {
        if (!ok || gone) return
        const l = await listenForClap(() => setIntro('done'), { minPeak: 0.02 })
        if (gone) return l.stop()
        clap = l
        setHears(l.listening)
      })
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      gone = true
      clap?.stop()
      setHears(false)
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
      {cut > 0 && phase === 'flying' && <div key={cut} className="cine-cut" aria-hidden />}
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
            <span style={{ width: `${most.current}%` }} />
          </div>
          <p className="cine-status">
            <i className="cine-spin" /> Loading the house {most.current}%
            {/* He powers up meanwhile (no start screen on the Mac): say how far. */}
            <span className="cine-jarvis"> · JARVIS {BOOT_WORD[jarvis] ?? 'starting'}</span>
          </p>
        </div>
      ) : (
        <p className="cine-skip">{hears ? 'Any key, clap or snap to skip' : 'Any key to skip'}</p>
      )}
    </div>
  )
}
