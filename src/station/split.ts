import * as THREE from 'three'

/**
 * A mesh's triangles sorted into pieces by where they lie (`key` of each
 * triangle's centre), each piece its own geometry with its own tight
 * bounds, so the pieces out of view aren't drawn. One big mesh spread round
 * the house is otherwise drawn whole whichever way the camera looks.
 */
export function splitByPlace(src: THREE.BufferGeometry, key: (centre: THREE.Vector3) => number) {
  const g = src.index ? src.toNonIndexed() : src
  const p = g.attributes.position as THREE.BufferAttribute
  const pieces = new Map<number, number[]>()
  const c = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i += 3) {
    c.set(0, 0, 0)
    for (let j = 0; j < 3; j++) c.add(v.fromBufferAttribute(p, i + j))
    const k = key(c.divideScalar(3))
    const list = pieces.get(k) ?? []
    list.push(i)
    pieces.set(k, list)
  }
  return [...pieces.values()].map((tris) => {
    const out = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(g.attributes)) {
      const a = attr as THREE.BufferAttribute
      const n = a.itemSize
      const arr = new (a.array.constructor as Float32ArrayConstructor)(tris.length * 3 * n)
      tris.forEach((i, t) => arr.set((a.array as Float32Array).subarray(i * n, (i + 3) * n), t * 3 * n))
      out.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized))
    }
    out.computeBoundingSphere()
    return out
  })
}

/** Which of `n` slices round the house (the origin) a point is in. */
export const sector = (n: number) => (c: THREE.Vector3) => Math.floor(((Math.atan2(c.z, c.x) + Math.PI) / (Math.PI * 2)) * n) % n
