import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { cameraFor, HOUSE, seatCamera } from './layout'
import { useStation } from './stationStore'

/**
 * The camera. Orbit with damping; presets fly smoothly to a zone (or back
 * to the overview) whenever the station's view changes — a click on a
 * system, a toolbar button, Reset. Grabbing the view mid-flight hands
 * control straight back. Talk mode sits behind the chair at the desk, facing
 * the reactor; Cinematic pulls back and drifts round the whole station. In
 * both the camera stays in the room (keepInRoom); Command, with the roof
 * off, looks in from above.
 */

/**
 * Inside the house (Talk and Cinematic) the camera stays in the room: never
 * up through the ceiling, out through the wall or the glass, or down into
 * the floor. Past any of them it's drawn in along its line to what it looks
 * at — the way zooming in would — until it's clear.
 */
const ROOM_R = HOUSE.r - 0.9
const ROOM_TOP = HOUSE.ceiling - 0.4
const ROOM_FLOOR = 0.7
const fromTarget = new THREE.Vector3()
function keepInRoom(pos: THREE.Vector3, target: THREE.Vector3) {
  const d = fromTarget.copy(pos).sub(target)
  let t = 1
  if (pos.y > ROOM_TOP && d.y > 0) t = Math.min(t, (ROOM_TOP - target.y) / d.y)
  if (pos.y < ROOM_FLOOR && d.y < 0) t = Math.min(t, (ROOM_FLOOR - target.y) / d.y)
  const a = d.x * d.x + d.z * d.z
  if (pos.x * pos.x + pos.z * pos.z > ROOM_R * ROOM_R && a > 1e-6) {
    // Where the line from the target meets the wall's circle.
    const b = 2 * (target.x * d.x + target.z * d.z)
    const c = target.x * target.x + target.z * target.z - ROOM_R * ROOM_R
    t = Math.min(t, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a))
  }
  if (t < 1) pos.copy(target).addScaledVector(d, Math.max(0, t))
  return pos
}

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
  const had = useRef<Orbit | null>(null)

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
    // A zone's view is from above, for Command (roof off); in the room it comes in under the ceiling.
    if (mode !== 'command') keepInRoom(pos, target)
    goal.current = { pos, target }
    // Start where the view is, rather than flying in from nowhere.
    if (first.current && controls) {
      first.current = false
      camera.position.copy(pos)
      controls.target.copy(target)
      controls.update()
    } else if (controls && controls !== had.current && mode === 'talk') {
      // Fresh controls (after the opening flight, or back out of a screen)
      // start at the origin; aim them where the camera already looks.
      controls.target.copy(target)
      controls.update()
    }
    had.current = controls
  }, [view, nonce, mode, size.width, size.height, camera, controls])

  // Development: point the camera anywhere (render tests and screenshots).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __cam?: unknown }).__cam = (pos: [number, number, number], target: [number, number, number]) => {
      goal.current = { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) }
    }
  }, [])

  // Taking hold of the view cancels the flight.
  useEffect(() => {
    if (!controls) return
    const stop = () => (goal.current = null)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, dt) => {
    const st = useStation.getState()
    if (!controls || st.mode === 'walk') return
    const g = goal.current
    if (g) {
      const k = useHub.getState().prefs.reducedMotion ? 1 : 1 - Math.exp(-dt * 2.6)
      camera.position.lerp(g.pos, k)
      controls.target.lerp(g.target, k)
      controls.update()
      if (camera.position.distanceToSquared(g.pos) < 1e-4 && controls.target.distanceToSquared(g.target) < 1e-4) goal.current = null
    }
    // After the controls have moved it (they run first): still in the room.
    if (st.mode !== 'command') keepInRoom(camera.position, controls.target)
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
  const talk = useStation((s) => s.mode === 'talk' && s.intro === 'done' && !s.screen)
  const shown = useRef(0)
  const applied = useRef<string>('')
  // Eased, so the picture glides over as the panel comes in.
  useFrame((_, dt) => {
    if (!size.width || !size.height) return
    // Matches .st-talk: left 24px, width clamp(340px, 28vw, 440px).
    const panel = 24 + Math.min(440, Math.max(340, size.width * 0.28))
    const want = talk && size.width > 900 ? -panel / 2 : 0
    shown.current += (want - shown.current) * Math.min(1, dt * 5)
    if (Math.abs(want - shown.current) < 0.5) shown.current = want
    const key = `${shown.current}|${size.width}|${size.height}`
    if (key === applied.current) return
    applied.current = key
    if (shown.current) camera.setViewOffset(size.width, size.height, shown.current, 0, size.width, size.height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  })
  return null
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const SCREEN_MS = 1150

/**
 * Into one of the desk's monitors and back out, like walking up to a
 * computer in a game: from wherever the camera is, it eases in until the
 * screen fills the view (then the page takes over, Dashboard.tsx), holds
 * there while the page is in use, and eases back to the chair after.
 */
export function ScreenFlight() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const k = useMemo(
    () => ({ key: '', from: null as null | { pos: THREE.Vector3; quat: THREE.Quaternion }, m: new THREE.Matrix4(), face: new THREE.Quaternion(), seat: new THREE.Quaternion(), c: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    [],
  )
  useFrame(() => {
    const sc = useStation.getState().screen
    if (!sc) {
      k.key = ''
      return
    }
    // Each leg starts from wherever the camera is when it begins.
    const key = `${sc.mon}:${sc.phase}`
    if (k.key !== key || !k.from) {
      k.key = key
      k.from = { pos: camera.position.clone(), quat: camera.quaternion.clone() }
    }
    const mesh = scene.getObjectByName(`screen_${sc.mon}`) as THREE.Mesh | undefined
    if (!mesh || !size.width) return
    // The screen's face: its centre, the way it faces (towards the chair), its up.
    mesh.updateWorldMatrix(true, false)
    mesh.getWorldPosition(k.c)
    k.n.set(0, 0, 1).transformDirection(mesh.matrixWorld)
    k.u.set(0, 1, 0).transformDirection(mesh.matrixWorld)
    if (k.n.dot(k.at.copy(k.from.pos).sub(k.c)) < 0 && sc.phase !== 'out') k.n.negate()
    // Close enough that the screen covers the view, edge to edge.
    const { width, height } = (mesh.geometry as THREE.PlaneGeometry).parameters
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const d = Math.min(height / 2 / tan, width / 2 / (tan * (size.width / size.height))) * 0.97
    let toPos: THREE.Vector3
    let toQuat: THREE.Quaternion
    if (sc.phase === 'out') {
      const seat = seatCamera(size.width / size.height)
      toPos = k.at.set(...seat.pos)
      toQuat = k.seat.setFromRotationMatrix(k.m.lookAt(toPos, k.c.set(...seat.target), k.up))
    } else {
      toPos = k.at.copy(k.c).addScaledVector(k.n, d)
      toQuat = k.face.setFromRotationMatrix(k.m.lookAt(toPos, k.c, k.u))
    }
    const reduced = useHub.getState().prefs.reducedMotion
    const raw = sc.phase === 'on' || reduced ? 1 : Math.min(1, (performance.now() - sc.at) / SCREEN_MS)
    const e = ease(raw)
    camera.position.lerpVectors(k.from.pos, toPos, e)
    camera.quaternion.slerpQuaternions(k.from.quat, toQuat, e)
    if (raw >= 1) {
      if (sc.phase === 'in') useStation.getState().screenArrived()
      else if (sc.phase === 'out') useStation.getState().screenLeft()
    }
  })
  return null
}

export function Controls() {
  const mode = useStation((s) => s.mode)
  // The opening flight drives the camera itself (intro.tsx).
  const intro = useStation((s) => s.intro !== 'done')
  // ...and so does going into one of the desk's screens (ScreenFlight).
  const screen = useStation((s) => s.screen !== null)
  const reduced = useHub((s) => s.prefs.reducedMotion)
  const cinematic = mode === 'cinematic'
  const limits = useMemo(() => (cinematic ? { min: -Infinity, max: Infinity } : mode === 'talk' ? { min: -0.6, max: 0.6 } : { min: -1.15, max: 1.15 }), [cinematic, mode])
  if (mode === 'walk' || intro || screen) return null
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.07}
      minDistance={3.5}
      maxDistance={mode === 'command' ? 32 : 14}
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
