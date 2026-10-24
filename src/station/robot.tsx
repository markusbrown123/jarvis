import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import { CHAIR, DECK_TOP, DUME, FOUNDRY } from './layout'
import { useStation } from './stationStore'

/**
 * Dum-E, Tony's workshop robot arm (modelled in Blender, tools/blender/dume.py),
 * stands by the build bay and keeps an eye on things:
 * - work handed out: he leans over the build bay and works at it, claw going
 * - a job finished: a quick nod or two
 * - a failure: he droops for a few seconds
 * - you wake JARVIS, or he's listening or speaking: he turns to you, claw up
 * - JARVIS thinking or working: he turns to the bay, as if lending a hand
 * - otherwise: idle, breathing, now and then looking round at you
 * Every joint eases to its target, so he moves like a machine with weight.
 */

const MODEL = '/station/dume.glb'
type Pose = { yaw: number; upper: number; fore: number; wrist: number; roll: number; claw: number }
type Mood = 'idle' | 'attend' | 'work' | 'nod' | 'droop' | 'help'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const BAY = V(FOUNDRY[0], FOUNDRY[1] + 0.95, FOUNDRY[2])
const YOU = V(CHAIR[0], 1.2, CHAIR[2])

export function Robot() {
  const { scene } = useGLTF(MODEL, false)
  const parts = useMemo(() => {
    const root = scene.clone(true)
    const get = (n: string) => root.getObjectByName(n) as THREE.Object3D
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return { root, yaw: get('dume_yaw'), upper: get('dume_upper'), fore: get('dume_fore'), wrist: get('dume_wrist'), roll: get('dume_roll'), fingerA: get('dume_finger_a'), fingerB: get('dume_finger_b') }
  }, [scene])
  const group = useRef<THREE.Group>(null)
  const pose = useRef<Pose>({ yaw: 0, upper: -0.35, fore: -1.1, wrist: -0.6, roll: 0, claw: 0.15 })
  const state = useRef<{ mood: Mood; until: number; seen: number; glance: number }>({ mood: 'idle', until: 0, seen: 0, glance: 0 })
  const tmp = useMemo(() => new THREE.Vector3(), [])

  // Only events from now on: what happened before he was here is old news.
  useEffect(() => {
    state.current.seen = useStation.getState().events.at(-1)?.id ?? 0
  }, [])

  /** The yaw (about his own vertical) that faces a point in the room. */
  const yawTo = (p: THREE.Vector3) => {
    const g = group.current
    if (!g) return 0
    g.updateMatrixWorld()
    const l = g.worldToLocal(tmp.copy(p))
    return Math.atan2(-l.x, -l.z)
  }

  useFrame((st, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = st.clock.elapsedTime
    const now = performance.now()
    const s = state.current
    const reduced = useHub.getState().prefs.reducedMotion

    // What's going on: events first (they're brief), then JARVIS's own state.
    for (const e of useStation.getState().events) {
      if (e.id <= s.seen) continue
      s.seen = e.id
      if (e.kind === 'assign' || e.kind === 'studio') Object.assign(s, { mood: 'work', until: now + 4200 })
      else if (e.kind === 'complete') Object.assign(s, { mood: 'nod', until: now + 1800 })
      else if (e.kind === 'fail') Object.assign(s, { mood: 'droop', until: now + 3500 })
    }
    const phase = useStore.getState().phase
    if (now > s.until) {
      s.mood = phase === 'waking' || phase === 'listening' || phase === 'speaking' ? 'attend' : phase === 'thinking' || phase === 'tooling' ? 'help' : 'idle'
    }

    // Targets for this moment.
    const breathe = reduced ? 0 : Math.sin(t * 0.9) * 0.035
    const bay = yawTo(BAY)
    const you = yawTo(YOU)
    let target: Pose
    switch (s.mood) {
      case 'work': {
        const k = Math.sin(t * 5)
        target = { yaw: bay + Math.sin(t * 1.3) * 0.12, upper: -0.62, fore: -0.95 + k * 0.08, wrist: -0.95, roll: Math.sin(t * 2.1) * 0.6, claw: k > 0 ? 0.35 : 0.02 }
        break
      }
      case 'nod': {
        const n = Math.sin((now - (s.until - 1800)) / 1800 * Math.PI * 4)
        target = { yaw: you, upper: -0.15, fore: -0.75, wrist: -0.25 + n * 0.35, roll: 0, claw: 0.3 }
        break
      }
      case 'droop':
        target = { yaw: bay * 0.5, upper: -0.12, fore: -1.65, wrist: -1.05, roll: 0.35, claw: 0.0 }
        break
      case 'attend':
        // Turned to you, claw up like a head, cocked a little.
        target = { yaw: you, upper: -0.08 + breathe, fore: -0.7, wrist: -0.15, roll: 0.25 + Math.sin(t * 0.7) * 0.08, claw: 0.25 }
        break
      case 'help':
        target = { yaw: bay + Math.sin(t * 0.8) * 0.2, upper: -0.45 + breathe, fore: -1.05, wrist: -0.7, roll: Math.sin(t * 1.1) * 0.3, claw: 0.12 + Math.max(0, Math.sin(t * 3)) * 0.15 }
        break
      default: {
        // Idle: mostly on the bay, every so often a look round at you.
        if (t > s.glance + 14) s.glance = t
        const looking = t - s.glance < 3.5
        target = { yaw: looking ? you : bay + Math.sin(t * 0.25) * 0.35, upper: -0.35 + breathe, fore: -1.1 - breathe, wrist: looking ? -0.3 : -0.6, roll: looking ? 0.2 : 0, claw: 0.15 }
      }
    }

    // Ease every joint there: the base turns slowest, the claw quickest.
    const p = pose.current
    const ease = (from: number, to: number, rate: number) => (reduced ? to : from + (to - from) * Math.min(1, dt * rate))
    // The shortest way round for the base.
    const dy = Math.atan2(Math.sin(target.yaw - p.yaw), Math.cos(target.yaw - p.yaw))
    p.yaw = reduced ? target.yaw : p.yaw + dy * Math.min(1, dt * 1.6)
    p.upper = ease(p.upper, target.upper, 2.2)
    p.fore = ease(p.fore, target.fore, 2.6)
    p.wrist = ease(p.wrist, target.wrist, 3.5)
    p.roll = ease(p.roll, target.roll, 3)
    p.claw = ease(p.claw, target.claw, 8)

    const r = parts
    r.yaw.rotation.y = p.yaw
    r.upper.rotation.x = p.upper
    r.fore.rotation.x = p.fore
    r.wrist.rotation.x = p.wrist
    r.roll.rotation.y = p.roll
    // The fingers open about the palm's depth axis (Blender Y, three −Z).
    r.fingerA.rotation.z = p.claw
    r.fingerB.rotation.z = -p.claw
  })

  return (
    <group ref={group} position={[DUME[0], DECK_TOP, DUME[2]]}>
      <primitive object={parts.root} />
    </group>
  )
}

useGLTF.preload(MODEL, false)
