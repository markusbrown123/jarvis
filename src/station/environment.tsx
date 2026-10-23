import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HOUSE } from './layout'
import { ROOM } from './houselight'
import { SKY_STATE, skyMaterial } from './sky'

/**
 * What shiny things reflect, and the soft light they pick up from all
 * round: two small stand-in worlds, rendered into image-based lighting
 * whenever the sky moves on.
 *
 * Indoors: the room as seen from the stage — travertine floor, concrete
 * behind, the white ceiling with its ring of light, the glow round the
 * coffer — lit by the house's lights and the sky, and the real sky and sea
 * through the open front. Outdoors (the terrace, the cliffs, the boats): the
 * sky all round over a dark sea.
 */

/** Materials that live outdoors take the outdoor reflections. */
export const OUTDOOR = new Set<THREE.MeshStandardMaterial>()

const EYE = 1.6

function indoorScene() {
  const s = new THREE.Scene()
  s.add(new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), skyMaterial(false)))
  const m = {
    floor: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    stage: new THREE.MeshBasicMaterial({ color: '#030304', side: THREE.DoubleSide }),
    wall: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    ceiling: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    deck: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    led: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    halo: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
    sea: new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }),
  }
  const flat = (g: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y - EYE
    s.add(mesh)
  }
  const R = HOUSE.r
  flat(new THREE.CircleGeometry(R, 64), m.floor, 0)
  flat(new THREE.CircleGeometry(8.1, 48), m.stage, 0.17)
  flat(new THREE.RingGeometry(R, HOUSE.deck.r, 48, 1, HOUSE.deck.a0, HOUSE.deck.a1 - HOUSE.deck.a0), m.deck, -0.01)
  flat(new THREE.CircleGeometry(60, 32), m.sea, -12)
  flat(new THREE.RingGeometry(4.2, HOUSE.roofBack + 2, 64), m.ceiling, HOUSE.ceiling)
  flat(new THREE.RingGeometry(R - 0.14, R - 0.06, 96), m.led, HOUSE.ceiling - 0.06)
  flat(new THREE.RingGeometry(4.05, 4.2, 64), m.halo, HOUSE.ceiling + 0.05)
  // The concrete back half (cylinder angle θ = house angle + π/2).
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, HOUSE.ceiling, 64, 1, true, 1.5 * Math.PI, Math.PI), m.wall)
  wall.position.y = HOUSE.ceiling / 2 - EYE
  s.add(wall)
  return { s, m }
}

function outdoorScene() {
  const s = new THREE.Scene()
  s.add(new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), skyMaterial(false)))
  const sea = new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide })
  const disc = new THREE.Mesh(new THREE.CircleGeometry(78, 32), sea)
  disc.rotation.x = -Math.PI / 2
  disc.position.y = -6
  s.add(disc)
  return { s, sea }
}

export function HouseEnvironment({ size }: { size: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const env = useMemo(() => ({ pmrem: new THREE.PMREMGenerator(gl), indoor: indoorScene(), outdoor: outdoorScene(), drawn: -1, at: 0, rts: [] as THREE.WebGLRenderTarget[] }), [gl])
  useEffect(
    () => () => {
      env.rts.forEach((rt) => rt.dispose())
      env.pmrem.dispose()
      scene.environment = null
    },
    [env, scene],
  )
  useFrame((st) => {
    // Redrawn when the sky moves on (every few seconds at most).
    if (env.drawn === SKY_STATE.version || st.clock.elapsedTime - env.at < 2) return
    env.drawn = SKY_STATE.version
    env.at = st.clock.elapsedTime
    const sky = SKY_STATE.ambient
    const warm = ROOM.roomWarm.value
    const m = env.indoor.m
    const lit = (base: [number, number, number], kw: number, ks: number) => new THREE.Color(base[0] * (warm.r * kw + sky.r * ks), base[1] * (warm.g * kw + sky.g * ks), base[2] * (warm.b * kw + sky.b * ks))
    m.floor.color.copy(lit([0.5, 0.44, 0.35], 0.35, 1.2))
    m.wall.color.copy(lit([0.29, 0.275, 0.255], 0.7, 0.8))
    m.ceiling.color.copy(lit([0.62, 0.6, 0.56], 0.3, 0.9))
    m.deck.color.copy(lit([0.52, 0.46, 0.37], 0.1, 1.1))
    m.sea.color.copy(sky).multiplyScalar(0.25)
    m.led.color.copy(warm).multiplyScalar(4)
    m.halo.color.copy(ROOM.roomJarvis.value).multiplyScalar(3)
    env.outdoor.sea.color.copy(sky).multiplyScalar(0.25)
    const old = env.rts
    const indoor = env.pmrem.fromScene(env.indoor.s, 0, 0.1, 200, { size })
    const outdoor = env.pmrem.fromScene(env.outdoor.s, 0, 0.1, 200, { size })
    scene.environment = indoor.texture
    for (const mat of OUTDOOR) {
      if (!mat.envMap) mat.needsUpdate = true
      mat.envMap = outdoor.texture
    }
    env.rts = [indoor, outdoor]
    old.forEach((rt) => rt.dispose())
  })
  return null
}
