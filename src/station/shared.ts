import { useMemo } from 'react'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { useStore } from '../store'

/** What the station's parts share: materials, and how much to move. */

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

/** When Markus last typed to JARVIS (the desk's holo keyboard lights up). */
export const typing = { at: 0 }

export const motion = () => (useHub.getState().prefs.reducedMotion ? 0.15 : 1)

/** The reactor's colours, one per state. */
export const COL = {
  standby: new THREE.Color('#7c8bff'),
  listening: new THREE.Color('#ff9a3c'),
  thinking: new THREE.Color('#b69cff'),
  speaking: new THREE.Color('#5eead4'),
  offline: new THREE.Color('#3b3a52'),
  amber: new THREE.Color('#f5a524'),
  red: new THREE.Color('#ef4444'),
  white: new THREE.Color('#ffffff'),
}

/** What JARVIS is doing this frame, as the reactor and the core pad show it. */
export function reactorState() {
  const { phase, level, error } = useStore.getState()
  const live = phase === 'listening' || phase === 'waking'
  const busy = phase === 'thinking' || phase === 'tooling'
  const color = phase === 'offline' ? COL.offline : live ? COL.listening : phase === 'speaking' ? COL.speaking : busy ? COL.thinking : COL.standby
  return { phase, level: live || phase === 'speaking' ? level : 0, busy, live, error: Boolean(error), color }
}
