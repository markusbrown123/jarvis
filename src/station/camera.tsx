import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { cameraFor, seatCamera } from './layout'
import { useStation } from './stationStore'

/**
 * The camera. Orbit with damping; presets fly smoothly to a zone (or back
 * to the overview) whenever the station's view changes — a click on a
 * system, a toolbar button, Reset. Grabbing the view mid-flight hands
 * control straight back. Talk mode sits behind the chair at the desk, facing
 * the reactor; Cinematic pulls back and drifts round the whole station.
 */

type Orbit = { target: THREE.Vector3; update: () => void; addEventListener: (t: 'start', f: () => void) => void; removeEventListener: (t: 'start', f: () => void) => void }

export function CameraRig() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const view = useStation((s) => s.view)
  const nonce = useStation((s) => s.viewNonce)
  const mode = useStation((s) => s.mode)
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const first = useRef(true)

  useEffect(() => {
    // The first measurement can be 0×0, and a NaN camera never recovers.
    // Walking drives the camera itself (walk.tsx).
    if (!size.width || !size.height || mode === 'walk') return
    const aspect = size.width / size.height
    const c = mode === 'talk' && view === 'overview' ? seatCamera(aspect) : cameraFor(view, aspect)
    const pos = new THREE.Vector3(...c.pos)
    const target = new THREE.Vector3(...c.target)
    if (mode === 'cinematic' && view === 'overview') {
      // Inside the house, up near the ceiling, drifting round the stage.
      pos.set(0, 3.4, 12.2)
      target.set(0, 1.2, 0)
    }
    goal.current = { pos, target }
    // Start where the view is, rather than flying in from nowhere.
    if (first.current && controls) {
      first.current = false
      camera.position.copy(pos)
      controls.target.copy(target)
      controls.update()
    }
  }, [view, nonce, mode, size.width, size.height, camera, controls])

  // Taking hold of the view cancels the flight.
  useEffect(() => {
    if (!controls) return
    const stop = () => (goal.current = null)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, dt) => {
    const g = goal.current
    if (!g || !controls || useStation.getState().mode === 'walk') return
    const k = useHub.getState().prefs.reducedMotion ? 1 : 1 - Math.exp(-dt * 2.6)
    camera.position.lerp(g.pos, k)
    controls.target.lerp(g.target, k)
    controls.update()
    if (camera.position.distanceToSquared(g.pos) < 1e-4 && controls.target.distanceToSquared(g.target) < 1e-4) goal.current = null
  })
  return null
}

/**
 * In Talk mode the conversation panel covers the left of the screen, so the
 * picture's centre shifts right into the open space — the console stays
 * whole and centred where you can see it. (Labels follow automatically:
 * they project through the same camera.)
 */
export function TalkFraming() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const talk = useStation((s) => s.mode === 'talk')
  useEffect(() => {
    if (!size.width || !size.height) return
    // Matches .st-talk: left 24px, width clamp(340px, 28vw, 440px).
    const panel = 24 + Math.min(440, Math.max(340, size.width * 0.28))
    if (talk && size.width > 900) camera.setViewOffset(size.width, size.height, -panel / 2, 0, size.width, size.height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height, talk])
  return null
}

export function Controls() {
  const mode = useStation((s) => s.mode)
  const reduced = useHub((s) => s.prefs.reducedMotion)
  const cinematic = mode === 'cinematic'
  const limits = useMemo(() => (cinematic ? { min: -Infinity, max: Infinity } : mode === 'talk' ? { min: -0.6, max: 0.6 } : { min: -1.15, max: 1.15 }), [cinematic, mode])
  if (mode === 'walk') return null
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.07}
      minDistance={3.5}
      maxDistance={32}
      minPolarAngle={0.45}
      maxPolarAngle={1.42}
      minAzimuthAngle={limits.min}
      maxAzimuthAngle={limits.max}
      autoRotate={cinematic && !reduced}
      autoRotateSpeed={0.28}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
    />
  )
}
