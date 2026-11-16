import { useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub } from '../hub/client'
import { BURST_QUALITY, TAG_ANCHORS, buildBurst, type BurstQuality } from '../station/burst'
import { BurstTags, tagEls } from '../station/BurstTags'

/**
 * The voice view's centrepiece: the burst (station/burst.ts) — a hollow core
 * with filaments, comets and three node clusters — and the tags floating on
 * it with real figures (station/BurstTags.tsx).
 *
 * What moves it is real: his voice level swells it; thinking, working or
 * speaking spin it up and brighten it; how many of each cluster's nodes are
 * lit follows Roblox games building (magenta), Automaton leads and sites
 * (green) and jobs (violet). Reduced motion slows it to a drift.
 */

const R0 = 0.9
const v = new THREE.Vector3()

/** Share of a cluster lit: a floor so it never looks dead, then the real count against a full house. */
const share = (n: number, full: number) => 0.18 + 0.82 * Math.min(1, n / full)

function BurstScene({ q }: { q: BurstQuality }) {
  const burst = useMemo(() => buildBurst(q), [q])
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    burst.hollow.scale.setScalar(R0)
    burst.rim.scale.setScalar(R0 * 1.02)
    burst.uniforms.uR0.value = R0
    return () => burst.dispose()
  }, [burst])
  const k = useMemo(() => ({ level: 0, energy: 0.2, fill: new THREE.Vector3(0.3, 0.3, 0.3), frame: 0, widths: [] as number[] }), [])
  useFrame((_, dtIn) => {
    const dt = Math.min(dtIn, 0.1)
    const st = useStore.getState()
    const hub = useHub.getState()
    const motion = hub.prefs.reducedMotion ? 0.12 : 1
    const u = burst.uniforms
    u.uT.value = (u.uT.value as number) + dt * motion
    // Voice and work.
    k.level += (st.level - k.level) * Math.min(1, dt * 10)
    const busy = st.phase === 'thinking' || st.phase === 'tooling' || st.phase === 'speaking'
    const want = busy ? 1 : st.phase === 'listening' || st.phase === 'waking' ? 0.55 : st.phase === 'offline' ? 0 : 0.18
    k.energy += (want - k.energy) * Math.min(1, dt * 2)
    u.uLevel.value = k.level
    u.uEnergy.value = k.energy
    u.uSwirl.value = k.energy
    u.uSpeed.value = k.energy * motion
    u.uFill.value = 0.55 + 0.45 * k.energy
    u.uPx.value = (size.height / 900) * dpr
    // The clusters, from the hub: magenta Roblox, violet jobs, green Automaton.
    const s = hub.state
    const games = s?.projects.roblox?.games ?? []
    const building = games.filter((g) => g.active || g.tasks.running > 0).length
    const am = s?.projects.automaton
    const jobs = Object.values(s?.jobs ?? {}).filter((j) => j.state === 'running' || j.state === 'queued').length
    k.fill.lerp(v.set(share(games.length + building * 2, 24), share(jobs, 10), share((am?.leads?.total ?? 0) + (am?.sites?.length ?? 0), 60)), Math.min(1, dt))
    ;(u.uFillC.value as THREE.Vector3).copy(k.fill)
    burst.spin.rotation.y += dt * (0.05 + k.energy * 0.12) * motion
    burst.spin.rotation.x = Math.sin((u.uT.value as number) * 0.07) * 0.12
    // The tags ride on the burst: where each anchor is on screen, written straight to its element.
    burst.spin.updateMatrixWorld()
    // Widths only change with the figures in them: measured now and then, never in the same pass as the moves.
    if (++k.frame % 60 === 1) tagEls.forEach((el, i) => el && (k.widths[i] = el.offsetWidth))
    TAG_ANCHORS.forEach((a, i) => {
      const el = tagEls[i]
      if (!el) return
      v.copy(a).applyMatrix4(burst.spin.matrixWorld).project(camera)
      const behind = v.z > 1
      // Kept on the screen (a tag sits 12px right of its point): on a phone the burst reaches past the edges.
      const x = Math.max(8, Math.min(size.width - (k.widths[i] ?? 0) - 20, ((v.x + 1) / 2) * size.width))
      el.style.transform = `translate(${x}px, ${((1 - v.y) / 2) * size.height}px)`
      el.style.opacity = behind ? '0' : '1'
    })
  })
  return <primitive object={burst.group} />
}

export function BurstView() {
  const graphics = useHub((s) => s.prefs.graphics)
  const lowPower = useHub((s) => s.prefs.lowPower)
  const q = BURST_QUALITY[lowPower ? 'low' : graphics]
  return (
    <div className="burst-view">
      <Canvas camera={{ position: [0, 0.3, 9.5], fov: 42 }} dpr={[1, lowPower ? 1 : 1.75]} gl={{ antialias: true, alpha: true }}>
        <BurstScene q={q} />
      </Canvas>
      <BurstTags />
    </div>
  )
}
