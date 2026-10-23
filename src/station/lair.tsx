import { useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { MeshReflectorMaterial, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Graphics } from '../hub/client'
import { reactorState } from './shared'
import { useStation } from './stationStore'

/**
 * The room: a lair cut into a sea cliff — rock walls and a rock vault, a
 * polished dark stone floor with the raised stage in the middle, and a
 * 130° wall of glass in steel mullions looking out over the sea.
 *
 * Modelled and lit in Blender (tools/blender/lair.py): every surface comes
 * with a detail map (its colour, crevices darkened) and a lightmap — the
 * moonlight through the window with the mullions' shadows, the blue-hour
 * sky, the warm ceiling coves, the uplights grazing the rock — bounced
 * round the room by Cycles and denoised. The walls and vault show exactly
 * that; the floor and stage add live mirror reflections on top (High and
 * Ultra), so the window, the sky and the holograms shine in the stone.
 *
 * Live: the halo in the vault over the console and the line of light round
 * the stage are JARVIS's colour. In Command mode the front rock and the
 * vault are cut away so the overview can look in from above.
 */

const MODEL = '/station/lair.glb'
// Matches LM_SCALE in lair.py; π because three divides baked light by π.
const LIGHT_SCALE = 4 * Math.PI
const UNLIT = ['rock_left', 'rock_front', 'rock_right', 'window', 'ceiling'] as const
const STONE = ['floor', 'stage'] as const

function useMaps(graphics: Graphics) {
  const names = [...UNLIT, ...STONE]
  const urls = [...names.flatMap((n) => [`/station/${n}_detail_${graphics}.jpg`, `/station/${n}_light_${graphics}.jpg`]), ...STONE.map((n) => `/station/${n}_normal_${graphics}.jpg`)]
  const tex = useLoader(THREE.TextureLoader, urls)
  return useMemo(() => {
    const out: Record<string, { detail: THREE.Texture; light: THREE.Texture; normal?: THREE.Texture }> = {}
    names.forEach((n, i) => {
      const detail = tex[i * 2]
      const light = tex[i * 2 + 1]
      out[n] = { detail, light }
    })
    STONE.forEach((n, i) => (out[n].normal = tex[names.length * 2 + i]))
    for (const t of tex) {
      t.flipY = false // glTF's UVs run top-down
      t.anisotropy = 8
      t.needsUpdate = true
    }
    for (const n of names) {
      out[n].detail.colorSpace = THREE.SRGBColorSpace
      out[n].light.colorSpace = THREE.SRGBColorSpace
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex])
}

/** A node's own placement, for drawing its geometry with our materials. */
const at = (o: THREE.Object3D) => ({ position: o.position, quaternion: o.quaternion, scale: o.scale })

export function Lair({ graphics, reflector }: { graphics: Graphics; reflector: number }) {
  const { nodes } = useGLTF(MODEL, false) as unknown as { nodes: Record<string, THREE.Mesh> }
  const maps = useMaps(graphics)
  const mode = useStation((s) => s.mode)
  const inside = mode !== 'command'
  const unlit = useMemo(
    () => Object.fromEntries(UNLIT.map((n) => [n, new THREE.MeshBasicMaterial({ map: maps[n].detail, lightMap: maps[n].light, lightMapIntensity: LIGHT_SCALE, fog: false })])),
    [maps],
  )
  const halo = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const edge = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const warm = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb877').multiplyScalar(2.2), toneMapped: false }), [])
  const ups = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb070').multiplyScalar(3), toneMapped: false }), [])
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8fb0d8', transparent: true, opacity: 0.07, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.3, depthWrite: false }), [])
  const col = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const st = reactorState()
    col.copy(st.color)
    halo.color.copy(col).multiplyScalar(1.6 + st.level * 1.4)
    edge.color.copy(col).multiplyScalar(1.1 + st.level)
  })

  const stone = (n: (typeof STONE)[number]) => {
    const m = maps[n]
    const common = { map: m.detail, lightMap: m.light, lightMapIntensity: LIGHT_SCALE, normalMap: m.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: n === 'stage' ? 0.28 : 0.34, metalness: 0.0, envMapIntensity: 0.35 }
    return reflector ? (
      <MeshReflectorMaterial
        {...common}
        resolution={reflector}
        blur={reflector >= 1024 ? [380, 120] : [260, 80]}
        mixBlur={0.85}
        mixStrength={n === 'stage' ? 2.6 : 2.0}
        mixContrast={1}
        mirror={0.6}
        depthScale={0.8}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.3}
      />
    ) : (
      <meshStandardMaterial {...common} />
    )
  }

  return (
    <group>
      {STONE.map((n) =>
        nodes[n] ? (
          <mesh key={n} geometry={nodes[n].geometry} {...at(nodes[n])} receiveShadow>
            {stone(n)}
          </mesh>
        ) : null,
      )}
      {UNLIT.map((n) =>
        nodes[n] && (inside || (n !== 'rock_front' && n !== 'ceiling')) ? <mesh key={n} geometry={nodes[n].geometry} {...at(nodes[n])} material={unlit[n]} /> : null,
      )}
      {nodes.glass && <mesh geometry={nodes.glass.geometry} {...at(nodes.glass)} material={glass} renderOrder={5} />}
      {nodes.uplights && <mesh geometry={nodes.uplights.geometry} {...at(nodes.uplights)} material={ups} />}
      {nodes.emit_stage && <mesh geometry={nodes.emit_stage.geometry} {...at(nodes.emit_stage)} material={edge} />}
      {inside && nodes.cove_warm && <mesh geometry={nodes.cove_warm.geometry} {...at(nodes.cove_warm)} material={warm} />}
      {inside && nodes.emit_halo && <mesh geometry={nodes.emit_halo.geometry} {...at(nodes.emit_halo)} material={halo} />}
    </group>
  )
}
