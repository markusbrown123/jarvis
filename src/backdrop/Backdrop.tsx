import { useEffect, useRef, useState } from 'react'
import { useHub } from '../hub/client'
import { useStore, accentFor } from '../store'
import { openItems } from '../dash/state'
import { BackdropEngine, type Frame, type Quality } from './engine'
import { link, REST_DIST, REST_POLAR } from './link'
import { SCENES } from './scenes'
import { GraphLayer } from './GraphLayer'
import { useGraph } from './graph'
import { cssRgb, easeWorld, emptyWorld, hslToRgb, mapHub, rgbToHsl, type World } from './world'
import './backdrop.css'

/**
 * The station's living backdrop: a procedurally generated scene, picked at
 * random on every page load, with Markus's projects built into it.
 *
 *   Roblox games      structures that grow as their tasks complete
 *   Automaton leads   a fleet of lights; built sites burn brighter
 *   running jobs      energy streams and drones flowing into the core
 *   Claude allowance  a fuel rail along the ground
 *   needs Markus      a beacon that pulses in its own colour
 *   finance           a chain of monitor nodes (QuantVue and services)
 *
 * With no hub data the scene still plays; the structures just stand as dim
 * scaffolds. B cycles scenes, shift-B goes back, ?scene=<id|number> pins one.
 */

type RGB = [number, number, number]

const LAST_KEY = 'jarvis.backdrop.last'
const VOID_DEFAULT: RGB = [0.016, 0.013, 0.024]

function pickScene(): number {
  const q = new URLSearchParams(location.search).get('scene')
  if (q) {
    const byId = SCENES.findIndex((s) => s.id === q)
    if (byId >= 0) return byId
    const n = Number(q)
    if (Number.isInteger(n) && n >= 0 && n < SCENES.length) return n
  }
  const r = new Uint32Array(1)
  crypto.getRandomValues(r)
  let i = r[0] % SCENES.length
  try {
    const last = Number(localStorage.getItem(LAST_KEY))
    if (Number.isInteger(last) && i === last) i = (i + 1 + (r[0] >>> 8) % (SCENES.length - 1)) % SCENES.length
    localStorage.setItem(LAST_KEY, String(i))
  } catch {
    /* a repeat scene is harmless */
  }
  return i
}

function newSeed(): [number, number, number, number] {
  const r = new Uint32Array(4)
  crypto.getRandomValues(r)
  return [r[0] / 4294967296, r[1] / 4294967296, r[2] / 4294967296, r[3] / 4294967296]
}

/** Accent plus two related hues, kept bright enough to glow and saturated enough to read. */
function palette(accent: RGB, offB: number, offC: number): { a: RGB; b: RGB; c: RGB } {
  const [h, s, l] = rgbToHsl(accent)
  const sat = Math.max(0.55, Math.min(0.95, s))
  const lit = Math.max(0.5, Math.min(0.64, l))
  return {
    a: hslToRgb(h, sat, lit),
    b: hslToRgb(h + offB, Math.max(0.5, sat * 0.9), 0.55),
    c: hslToRgb(h + offC, Math.max(0.5, sat * 0.95), 0.58),
  }
}

const lerp3 = (cur: RGB, tgt: RGB, k: number) => {
  cur[0] += (tgt[0] - cur[0]) * k
  cur[1] += (tgt[1] - cur[1]) * k
  cur[2] += (tgt[2] - cur[2]) * k
}

const LEGEND = 'towers · Roblox games   lights · Automaton leads   streams · running jobs   rail · Claude allowance   beacon · needs you   nodes · finance'

export function Backdrop() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fallback, setFallback] = useState(false)
  const [tag, setTag] = useState<{ name: string; n: number } | null>(null)
  const graphics = useHub((s) => s.prefs.graphics)
  const lowPower = useHub((s) => s.prefs.lowPower)
  const asleep = useStore((s) => s.phase === 'offline')
  const engine = useRef<BackdropEngine | null>(null)
  const show = useRef<(i: number) => void>(() => {})

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const eng = new BackdropEngine(el)
    if (!eng.init()) {
      setFallback(true)
      return
    }
    engine.current = eng
    const seed = newSeed()
    eng.setSeed(seed)
    const offB = 0.07 + seed[0] * 0.09
    const offC = -(0.1 + seed[1] * 0.3)

    let scene = pickScene()
    let alive = true
    const styleOf = (i: number) => {
      const code = SCENES[i].code
      link.look.gstyle = Number(/GSTYLE=(\d)/.exec(code)?.[1] ?? 0)
      link.look.lstyle = Number(/LSTYLE=(\d)/.exec(code)?.[1] ?? 0)
    }
    // Try the wanted scene, then its neighbours, until one compiles.
    const tryScene = async (i: number, step: number) => {
      for (let k = 0; k < SCENES.length; k++) {
        const idx = (((i + k * step) % SCENES.length) + SCENES.length) % SCENES.length
        if (await eng.setScene(idx)) {
          if (!alive) return false
          scene = idx
          styleOf(idx)
          return true
        }
      }
      return false
    }
    void tryScene(scene, 1).then((ok) => {
      if (!alive) return
      if (!ok) {
        setFallback(true)
        return
      }
      setTag({ name: SCENES[scene].name, n: scene + 1 })
    })
    show.current = (i) => {
      void tryScene(i, i < scene ? -1 : 1).then((ok) => {
        if (!ok || !alive) return
        try {
          localStorage.setItem(LAST_KEY, String(scene))
        } catch {
          /* ignore */
        }
        setTag({ name: SCENES[scene].name, n: scene + 1 })
      })
    }
    eng.onFail = () => setFallback(true)
    eng.onRecover = () => {
      setFallback(false)
      void tryScene(scene, 1)
    }

    const cur = emptyWorld()
    let tgt = emptyWorld()
    let lastState: unknown = undefined
    let lastLink = ''
    let lastMap = 0
    let t = seed[2] * 240
    const a: RGB = [0.1, 0.85, 0.85]
    const b: RGB = [0.3, 0.5, 0.9]
    const c: RGB = [0.8, 0.4, 0.7]
    const vd: RGB = [...VOID_DEFAULT]
    let primed = false
    const cam: RGB = [0, 0, 0]

    const frame = (dtIn: number): Frame => {
      const nowMs = performance.now()
      const dt = dtIn > 0 ? dtIn : 0
      const hub = useHub.getState()
      const st = useStore.getState()
      const motion = hub.prefs.reducedMotion ? 0.12 : 1
      t += dt * motion

      if (hub.state !== lastState || hub.link !== lastLink || nowMs - lastMap > 15000) {
        lastState = hub.state
        lastLink = hub.link
        lastMap = nowMs
        const items = openItems(hub.state?.items)
        tgt = mapHub(hub.state, hub.link, Date.now(), items.length, items.filter((i) => i.priority === 'P1').length)
      }
      const thinking = st.phase === 'thinking' || st.phase === 'tooling' || st.phase === 'speaking'
      tgt.act = thinking ? 1 : st.phase === 'listening' || st.phase === 'waking' ? 0.5 : 0
      easeWorld(cur, tgt, dt)

      const pal = palette(cssRgb(accentFor(st.phase, st.ui)), offB, offC)
      const bg = st.ui.background ? cssRgb(st.ui.background, VOID_DEFAULT).map((v) => Math.min(0.12, v)) as RGB : VOID_DEFAULT
      if (!primed) {
        a.splice(0, 3, ...pal.a)
        b.splice(0, 3, ...pal.b)
        c.splice(0, 3, ...pal.c)
        primed = true
      } else {
        const k = 1 - Math.exp(-dt * 1.6)
        lerp3(a, pal.a, k)
        lerp3(b, pal.b, k)
        lerp3(c, pal.c, k)
      }
      lerp3(vd, bg, 1 - Math.exp(-dt * 3))
      link.look.a = a
      link.look.b = b
      link.look.c = c
      // The room's orbit camera: a damped, deliberately small share of the real
      // parallax, so the world drifts with the view but never runs out of scene.
      const cc = link.cam
      const wantCam: RGB = [cc.az * 0.2, (REST_POLAR - cc.polar) * 0.16, Math.pow(REST_DIST / Math.max(1, cc.dist), 0.14) - 1]
      lerp3(cam, wantCam, 1 - Math.exp(-dt * 12))
      return { t, dt, accent: a, b, c, void: vd, cam, world: cur as World }
    }

    const quality = (): Quality => {
      const p = useHub.getState().prefs
      return p.lowPower ? 'low' : p.graphics
    }
    eng.setQuality(quality())
    eng.start(frame)

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (key === 'g') useGraph.getState().toggle()
      else if (key === 'b') show.current(scene + (e.shiftKey ? -1 : 1))
    }
    window.addEventListener('keydown', onKey)
    const w = window as unknown as Record<string, unknown>
    w.__backdrop = {
      scenes: SCENES.map((s) => s.id),
      get current() {
        return scene
      },
      set: (i: number | string) => show.current(typeof i === 'number' ? i : SCENES.findIndex((s) => s.id === i)),
      stats: eng.stats,
      get error() {
        return eng.lastError
      },
    }
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
      delete w.__backdrop
      eng.dispose()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.setQuality(lowPower ? 'low' : graphics)
  }, [graphics, lowPower])

  // Under the power-up screen nothing here is visible, so nothing here runs.
  useEffect(() => {
    engine.current?.setPaused(asleep)
  }, [asleep])

  useEffect(() => {
    if (!tag) return
    const id = setTimeout(() => setTag(null), 9000)
    return () => clearTimeout(id)
  }, [tag])

  return (
    <div className={`bd ${fallback ? 'bd-fallback' : ''}`} aria-hidden="true">
      <canvas ref={canvas} className="bd-canvas" />
      <GraphLayer />
      {tag && (
        <p className="bd-tag" key={tag.n}>
          <b>{tag.name}</b>
          <span>{LEGEND}</span>
          <span className="bd-key">B · next scene · G · knowledge graph</span>
        </p>
      )}
    </div>
  )
}
