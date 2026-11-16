import * as THREE from 'three'

/**
 * Machined metal for the station's hardware (tools/textures/metal.py): panel
 * seams, rivets, vents, brushing and scratches, as colour, ambient
 * occlusion / roughness / metalness and a normal map. Loaded once, shared;
 * each material tiles it at its own scale.
 */

const loader = new THREE.TextureLoader()
const source: Record<'albedo' | 'orm' | 'normal', THREE.Texture | null> = { albedo: null, orm: null, normal: null }

function base(name: keyof typeof source) {
  if (!source[name]) {
    const t = loader.load(`/station/metal_${name}.jpg`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (name === 'albedo') t.colorSpace = THREE.SRGBColorSpace
    source[name] = t
  }
  return source[name]!
}

function tiled(name: keyof typeof source, repeat: number) {
  const t = base(name).clone()
  t.repeat.set(repeat, repeat)
  return t
}

/** A metal material with the plating detail, tinted and tiled as asked. */
export function plated(o: { color: THREE.ColorRepresentation; repeat?: number; roughness?: number; metalness?: number; envMapIntensity?: number; normal?: number }) {
  const r = o.repeat ?? 1
  return new THREE.MeshStandardMaterial({
    color: o.color,
    map: tiled('albedo', r),
    aoMap: tiled('orm', r),
    roughnessMap: tiled('orm', r),
    metalnessMap: tiled('orm', r),
    normalMap: tiled('normal', r),
    normalScale: new THREE.Vector2(o.normal ?? 0.8, o.normal ?? 0.8),
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 1,
    envMapIntensity: o.envMapIntensity ?? 1,
  })
}
