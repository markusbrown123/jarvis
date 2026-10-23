import * as THREE from 'three'

/** Shared by the boats (boats.tsx) and the sea's shader (outside.tsx): where each boat is, and its lights. */
export const MAX_BOATS = 8
export const WAKES = {
  /** x, z, heading, speed */
  uBoats: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
  /** length, beam, 1 for a jet ski, 1 if there's a boat here at all */
  uBoatDim: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
  uBoatLights: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
  uBoatLightCol: { value: Array.from({ length: 16 }, () => new THREE.Color()) },
}
