import { useEffect, useRef } from 'react'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import { buildModel, CATS, GraphSim, useGraph, type Cat, type Node } from './graph'
import { link } from './link'

/**
 * Draws the knowledge graph (see graph.ts) on one 2D canvas behind the 3D room.
 *
 * Why it stays smooth while panels move or the window is dragged:
 *  - it runs on requestAnimationFrame at no more than 30 frames a second; the
 *    graph moves slowly, so the other half of the frames go to the 3D scene;
 *  - nothing in the frame reads layout. The size comes from a ResizeObserver
 *    and is redrawn in the same callback, so a resize never flashes empty;
 *  - nodes are pre-rendered glow sprites blitted with drawImage, edges are
 *    batched into one path per colour, and the node count is capped (240);
 *  - once the layout settles the physics stops completely; only the cheap
 *    drift and the draw remain, and nothing runs while the tab is hidden,
 *    the graph is switched off, or the power-up screen is covering it.
 */

const FRAME_MS = 1000 / 30
const MAX_DPR = 1.5

type RGB = [number, number, number]

function sprite(rgb: RGB): HTMLCanvasElement {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const m = S / 2
  const glow = g.createRadialGradient(m, m, 0, m, m, m)
  glow.addColorStop(0, `rgba(${rgb},0.5)`)
  glow.addColorStop(0.32, `rgba(${rgb},0.16)`)
  glow.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = glow
  g.fillRect(0, 0, S, S)
  const R = S * 0.2
  const lit = rgb.map((v) => Math.round(v + (255 - v) * 0.78))
  const dark = rgb.map((v) => Math.round(v * 0.32))
  const body = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.08, m, m, R)
  body.addColorStop(0, `rgb(${lit})`)
  body.addColorStop(0.42, `rgb(${rgb})`)
  body.addColorStop(1, `rgb(${dark})`)
  g.fillStyle = body
  g.beginPath()
  g.arc(m, m, R, 0, Math.PI * 2)
  g.fill()
  return c
}

// The sprite's sphere is 20% of its width, so a node of radius r is drawn 5x as wide.
const SPR = 5

export function GraphLayer() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const on = useGraph((s) => s.on)
  const asleep = useStore((s) => s.phase === 'offline')

  useEffect(() => {
    const el = canvas.current
    if (!el || !on || asleep) return
    const ctx = el.getContext('2d', { alpha: true })
    if (!ctx) return
    const sim = new GraphSim()
    const sprites = CATS.map((c) => sprite(c.color))
    const reduced = () => useHub.getState().prefs.reducedMotion
    let dpr = 1
    let raf = 0
    let last = 0
    let t = 0
    let alive = true
    let visible = true

    const remodel = () => {
      const m = buildModel(useHub.getState().state)
      sim.merge(m)
      useGraph.getState().setCounts(m.counts)
    }
    remodel()
    let lastKey: unknown = useHub.getState().state
    const off = useHub.subscribe((s) => {
      if (s.state !== lastKey) {
        lastKey = s.state
        remodel()
      }
    })

    const draw = () => {
      const W = el.width / dpr
      const H = el.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const hidden = useGraph.getState().hidden
      const cam = link.cam
      const px = (cam.az % Math.PI) * -70
      const py = (cam.polar - 1.457) * 90
      const calm = reduced() ? 0 : 1
      const show = (n: Node) => n.kind === 'root' || !hidden[n.cat]
      for (const n of sim.nodes) {
        n.sx = n.x + Math.sin(t * 0.31 + n.seed * 40) * 3.4 * calm + px * n.depth
        n.sy = n.y + Math.cos(t * 0.27 + n.seed * 31) * 3.4 * calm + py * n.depth
      }

      // edges, one path per category colour
      ctx.lineWidth = 1
      for (let ci = 0; ci < CATS.length; ci++) {
        const rgb = CATS[ci].color
        ctx.beginPath()
        for (const e of sim.edges) {
          if (e.cross || e.b.ci !== ci || e.a.kind === 'root' || !show(e.b) || !show(e.a)) continue
          ctx.moveTo(e.a.sx, e.a.sy)
          ctx.lineTo(e.b.sx, e.b.sy)
        }
        ctx.strokeStyle = `rgba(${rgb},0.2)`
        ctx.stroke()
      }
      // hub spokes to the centre, and job -> game links
      ctx.beginPath()
      for (const e of sim.edges) {
        if (e.a.kind !== 'root' || !show(e.b)) continue
        ctx.moveTo(e.a.sx, e.a.sy)
        ctx.lineTo(e.b.sx, e.b.sy)
      }
      ctx.strokeStyle = 'rgba(150,175,255,0.09)'
      ctx.stroke()
      ctx.beginPath()
      for (const e of sim.edges) {
        if (!e.cross || !show(e.a) || !show(e.b)) continue
        ctx.moveTo(e.a.sx, e.a.sy)
        ctx.lineTo(e.b.sx, e.b.sy)
      }
      ctx.strokeStyle = 'rgba(255,170,100,0.28)'
      ctx.setLineDash([3, 5])
      ctx.lineDashOffset = -t * 14 * calm
      ctx.stroke()
      ctx.setLineDash([])

      // nodes, biggest last so hubs sit on top
      for (const pass of ['dot', 'item', 'group', 'hub'] as const) {
        for (const n of sim.nodes) {
          if (n.kind !== pass || !show(n)) continue
          const beat = n.hot ? 1 + Math.sin(t * 3.1 + n.seed * 20) * 0.1 : 1
          const r = n.r * beat
          const w = r * 2 * SPR
          ctx.globalAlpha = 0.25 + n.live * 0.75
          ctx.drawImage(sprites[n.ci], n.sx - w / 2, n.sy - w / 2, w, w)
          if (n.bad) {
            ctx.globalAlpha = 0.5 + 0.35 * Math.sin(t * 5 + n.seed * 9)
            ctx.strokeStyle = 'rgba(255,80,90,1)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(n.sx, n.sy, r + 3.5, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 1

      // labels: hubs, groups and real items only
      ctx.textBaseline = 'middle'
      for (const n of sim.nodes) {
        if (!n.label || !show(n) || (n.kind === 'dot')) continue
        const hub = n.kind === 'hub'
        ctx.font = hub ? '600 11px ui-monospace, monospace' : '400 10px ui-monospace, monospace'
        const txt = hub ? n.label.toUpperCase() : n.label
        const x = n.sx + n.r + 5
        ctx.fillStyle = 'rgba(3,3,8,0.85)'
        ctx.fillText(txt, x + 1, n.sy + 1)
        ctx.fillStyle = hub ? 'rgba(235,240,255,0.95)' : `rgba(${CATS[n.ci].color.map((v) => Math.round(v + (255 - v) * 0.55))},${0.35 + n.live * 0.5})`
        ctx.fillText(txt, x, n.sy)
      }
    }

    // Resizing clears a canvas, so redraw in the same callback, before the browser paints.
    const fit = (box?: { width: number; height: number }) => {
      const r = box ?? el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      const w = Math.round(r.width * dpr)
      const h = Math.round(r.height * dpr)
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
      }
      sim.setSize(r.width, r.height)
      draw()
    }
    const ro = new ResizeObserver((e) => fit(e[e.length - 1]?.contentRect))
    ro.observe(el)
    const io = new IntersectionObserver((e) => {
      visible = e[e.length - 1]?.isIntersecting ?? true
    })
    io.observe(el)

    const frame = (now: number) => {
      if (!alive) return
      raf = requestAnimationFrame(frame)
      if (document.hidden || !visible) {
        last = 0
        return
      }
      if (now - last < FRAME_MS - 1) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033
      last = now
      t += dt * (reduced() ? 0.15 : 1)
      sim.step(dt)
      draw()
    }
    raf = requestAnimationFrame(frame)
    const unsubHidden = useGraph.subscribe(() => draw())

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      off()
      unsubHidden()
    }
  }, [on, asleep])

  return <canvas ref={canvas} className="bd-graph" style={{ display: on ? 'block' : 'none' }} />
}

const css = (c: readonly number[]) => `rgb(${c.join(',')})`

/** The filter legend. It lives outside the backdrop so the 3D canvas does not swallow its clicks. */
export function GraphLegend() {
  const on = useGraph((s) => s.on)
  const hidden = useGraph((s) => s.hidden)
  const counts = useGraph((s) => s.counts)
  const toggle = useGraph((s) => s.toggle)
  const flip = useGraph((s) => s.flip)
  return (
    <aside className={`gl-legend ${on ? '' : 'gl-off'}`} aria-label="Knowledge graph filter">
      <button className="gl-title" onClick={toggle} title="Show or hide the knowledge graph (G)">
        Graph {on ? '' : '· off'}
      </button>
      {on &&
        CATS.map((c) => (
          <button key={c.id} className={`gl-row ${hidden[c.id as Cat] ? 'gl-dim' : ''}`} onClick={() => flip(c.id)} title={`Show or hide ${c.label.toLowerCase()}`}>
            <i style={{ background: css(c.color), boxShadow: `0 0 8px ${css(c.color)}` }} />
            <span>{c.label}</span>
            <b>{counts[c.id] || ''}</b>
          </button>
        ))}
    </aside>
  )
}
