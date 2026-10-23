import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { CONSOLE_R, FOUNDRY, OBSTACLES, onIsland, walkable, ZONES } from './layout'
import { useStation } from './stationStore'

/**
 * Walk mode: the station on foot, first person. W A S D (or the arrows) to
 * move, Shift to run, the mouse to look — click to capture it, or drag.
 * You stand up behind the console; E sits you back down at it, or opens
 * the zone you're facing. The open glass panel straight ahead leads out
 * onto the terrace, round the pool to the balustrade. Talking to JARVIS
 * works as everywhere else.
 *
 * While walking these keys belong to walking: they're taken before the
 * app's own shortcuts (D is diagnostics, E expands panels) see them.
 */

const EYE = 1.65
const WALK = 2.6
const RUN = 5.2
const BODY = 0.3
const TURN = 0.0022
const KEYS = new Set(['w', 'a', 's', 'd', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'])

const typingIn = (e: Event) => {
  const el = e.target as HTMLElement | null
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || Boolean(el?.isContentEditable)
}

export function WalkControls() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const setEvents = useThree((s) => s.setEvents)
  const keys = useRef(new Set<string>())
  const look = useRef({ yaw: 0, pitch: -0.06 })
  // You stand up and step off the back of the platform, facing the desk.
  const pos = useMemo(() => new THREE.Vector3(0, 0, CONSOLE_R + 0.6), [])
  const ground = useRef(0.16)
  const bob = useRef(0)
  const act = useRef<(() => void) | null>(null)

  // Clicking things in the room is for the other modes; here E does it.
  useEffect(() => {
    setEvents({ enabled: false })
    return () => setEvents({ enabled: true })
  }, [setEvents])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingIn(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (!KEYS.has(k)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (k === 'e') {
        if (!e.repeat) act.current?.()
        return
      }
      keys.current.add(k)
    }
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase())
    }
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useEffect(() => {
    const el = gl.domElement
    const { setWalk } = useStation.getState()
    const capture = () => {
      if (document.pointerLockElement !== el) void Promise.resolve(el.requestPointerLock()).catch(() => {})
    }
    const changed = () => setWalk({ locked: document.pointerLockElement === el })
    const move = (e: MouseEvent) => {
      // Captured, or dragging on the room itself.
      if (document.pointerLockElement !== el && !((e.buttons & 1) && e.target === el)) return
      look.current.yaw -= e.movementX * TURN
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - e.movementY * TURN))
    }
    el.addEventListener('click', capture)
    document.addEventListener('pointerlockchange', changed)
    window.addEventListener('mousemove', move)
    return () => {
      el.removeEventListener('click', capture)
      document.removeEventListener('pointerlockchange', changed)
      window.removeEventListener('mousemove', move)
      if (document.pointerLockElement === el) document.exitPointerLock()
      setWalk({ hint: null, locked: false })
    }
  }, [gl])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05)
    const k = keys.current
    const ahead = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0)
    const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0)
    const yaw = look.current.yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const mx = fx * ahead + Math.cos(yaw) * side
    const mz = fz * ahead - Math.sin(yaw) * side
    const len = Math.hypot(mx, mz)
    const running = k.has('shift')
    const was = { x: pos.x, z: pos.z }
    if (len > 0) {
      const step = ((running ? RUN : WALK) * d) / len
      pos.x += mx * step
      pos.z += mz * step
    }
    // Slide round anything solid; walls, glass, pool and rail stop you,
    // sliding along them where they can.
    for (const [ox, oz, r] of OBSTACLES) {
      const dx = pos.x - ox
      const dz = pos.z - oz
      const dist = Math.hypot(dx, dz)
      const min = r + BODY
      if (dist < min && dist > 1e-4) {
        pos.x = ox + (dx / dist) * min
        pos.z = oz + (dz / dist) * min
      }
    }
    if (!walkable(pos.x, pos.z, BODY)) {
      if (walkable(pos.x, was.z, BODY)) pos.z = was.z
      else if (walkable(was.x, pos.z, BODY)) pos.x = was.x
      else pos.set(was.x, 0, was.z)
    }
    const fromCentre = Math.hypot(pos.x, pos.z)
    // Step up onto the island's deck and down off it.
    ground.current += ((onIsland(pos.x, pos.z) ? 0.16 : 0) - ground.current) * Math.min(1, d * 10)
    const still = useHub.getState().prefs.reducedMotion
    bob.current += len > 0 && !still ? d * (running ? 11 : 7.5) : 0
    const sway = len > 0 && !still ? Math.sin(bob.current) * 0.022 : 0
    camera.position.set(pos.x, ground.current + EYE + sway, pos.z)
    camera.rotation.set(look.current.pitch, yaw, 0, 'YXZ')

    // What E does from here: sit at the desk, or open the zone in front.
    const st = useStation.getState()
    let hint: string | null = null
    act.current = null
    if (fromCentre < CONSOLE_R + 1.1 && (-pos.x * fx - pos.z * fz) / fromCentre > 0.5) {
      hint = 'E  ·  sit at the terminal'
      act.current = () => st.setMode('talk')
    } else {
      let best = Infinity
      // The zones, and the build bay (which opens Jobs).
      const spots = [...ZONES.map((z) => ({ x: z.pos[0], z: z.pos[2], label: z.label, id: z.id })), { x: FOUNDRY[0], z: FOUNDRY[2], label: 'the build bay', id: 'jobs' as const }]
      for (const z of spots) {
        const dx = z.x - pos.x
        const dz = z.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist < 3 && dist < best && (dx * fx + dz * fz) / dist > 0.5) {
          best = dist
          hint = `E  ·  open ${z.label}`
          act.current = () => st.select({ kind: 'zone', id: z.id, zone: z.id })
        }
      }
    }
    st.setWalk({ hint })
  })
  return null
}
