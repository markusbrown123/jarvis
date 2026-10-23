import { type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useStation, type Sel } from './stationStore'

/** What the station's holograms share: their look, and hovering and clicking them. */

/** Brushed steel for the hardware on the pads. */
export const steel = new THREE.MeshStandardMaterial({ color: '#4a5162', metalness: 0.75, roughness: 0.3, envMapIntensity: 1.2 })

/**
 * The data itself is projected light, not objects: translucent, additive,
 * with a brighter outline — the same holographic look as the console's
 * monitors, standing over solid metal projectors.
 */
export function holo(color: string, opacity = 0.28) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
}
export const boxEdges = (w: number, h: number, d: number) => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))

/** Pointer handlers that hover and select a thing. */
export function useHit(sel: Sel) {
  const hover = useStation((s) => s.hover)
  const select = useStation((s) => s.select)
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      hover(sel)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      hover(null)
      document.body.style.cursor = ''
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      select(sel)
    },
  }
}

/** Is this thing (or its zone) the selected or hovered one? */
export function useEmphasis(kind: Sel['kind'], id: string) {
  return useStation((s) => (s.selected?.kind === kind && s.selected.id === id) || (s.hovered?.kind === kind && s.hovered.id === id))
}

