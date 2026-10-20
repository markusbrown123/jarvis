import { useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub } from '../hub/client'
import { ringFor } from '../scene/crystal'

/** What the station's parts share: the core's height, materials, state colour. */

export const CORE_Y = 2.55

// ---------------------------------------------------------------- materials

export function useMaterials() {
  return useMemo(
    () => ({
      gunmetal: new THREE.MeshPhysicalMaterial({ color: '#23262e', metalness: 0.88, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
      graphite: new THREE.MeshStandardMaterial({ color: '#15161c', metalness: 0.7, roughness: 0.55 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#d4d8e2', metalness: 1, roughness: 0.14 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#0b0b0e', metalness: 0, roughness: 0.9 }),
      amber: new THREE.MeshPhysicalMaterial({ color: '#e8962a', metalness: 0.35, roughness: 0.38, clearcoat: 0.8 }),
      panel: new THREE.MeshStandardMaterial({ color: '#101119', metalness: 0.55, roughness: 0.62 }),
      glow: (color: string, i = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i), toneMapped: false }),
    }),
    [],
  )
}

/** The colour JARVIS's state calls for this frame (shared by several parts). */
export function stateColor(out: THREE.Color, k: number) {
  const { phase, error, ui } = useStore.getState()
  const s = useHub.getState().state
  const blocked = s ? Object.values(s.items).some((i) => i.state === 'open' && i.priority === 'P1') : false
  out.lerp(ui.reactor.color ? new THREE.Color(ui.reactor.color) : ringFor(phase, blocked, Boolean(error)), k)
  return out
}

export const motion = () => (useHub.getState().prefs.reducedMotion ? 0.15 : 1)
