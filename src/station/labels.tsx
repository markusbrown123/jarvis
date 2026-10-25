import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { CONSOLE_R, HOUSE, linkAnchor, PROJECT_PADS, ZONE, ZONES, type ProjectPad, type ZoneId } from './layout'
import { SCREENS, useStation } from './stationStore'
import { describe } from './describe'
import { useProjectPad } from './projectpads'

/**
 * Labels over the 3D room, in the page rather than the scene: crisp text,
 * no extra render passes. Only the important things get one — each zone's
 * name and its one-line state, plus link labels in Connections View. Each
 * frame they're projected to the screen and laid out most-important-first;
 * one that would overlap is nudged, then hidden. Hovering anything in the
 * room shows a tooltip at the pointer.
 */

type Box = [number, number, number, number]
type Anchor = { el: HTMLElement; pos: THREE.Vector3; pri: () => number; w: number; h: number; seen: number }
const anchors = new Map<string, Anchor>()

function useAnchor(id: string, pos: [number, number, number] | null, pri: () => number) {
  const ref = useRef<HTMLDivElement>(null)
  const key = pos?.join(',')
  useEffect(() => {
    const el = ref.current
    if (!el || !pos) return
    anchors.set(id, { el, pos: new THREE.Vector3(...pos), pri, w: 0, h: 0, seen: 0 })
    return () => void anchors.delete(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key])
  return ref
}

const STATE_WORD: Record<string, string> = { loading: 'reading', idle: 'idle', active: 'active', attention: 'needs you', error: 'error', unavailable: 'unavailable' }

function ZoneLabel({ id }: { id: ZoneId }) {
  const z = ZONE[id]
  const zm = useStation((s) => s.model?.zones[id])
  const mode = useStation((s) => s.mode)
  const select = useStation((s) => s.select)
  const hover = useStation((s) => s.hover)
  const on = useStation((s) => s.selected?.zone === id || s.hovered?.zone === id)
  // Read live each frame: the most urgent zones get placed first.
  const ref = useAnchor(`zone-${id}`, [z.pos[0], 1.95, z.pos[2]], () => {
    const s = useStation.getState()
    const st = s.model?.zones[id].state
    return (s.selected?.zone === id ? 10 : 0) + (st === 'error' ? 5 : st === 'attention' ? 4 : st === 'active' ? 3 : 1)
  })
  // Talk and Cinematic keep the room quiet: names only.
  const cinematic = mode !== 'command'
  return (
    <div
      ref={ref}
      className={`st-label st-label-${zm?.state ?? 'loading'} ${cinematic ? 'cine' : ''} ${on ? 'on' : ''}`}
      style={{ '--zc': z.color } as CSSProperties}
      onClick={() => select({ kind: 'zone', id, zone: id })}
      onPointerEnter={() => hover({ kind: 'zone', id, zone: id })}
      onPointerLeave={() => hover(null)}
    >
      <span className="st-label-name">
        <i className="st-label-dot" />
        {z.label}
        {!cinematic && zm && zm.state !== 'idle' && <em>{STATE_WORD[zm.state]}</em>}
      </span>
      {!cinematic && zm && <span className="st-label-head">{zm.headline}</span>}
      {!cinematic && zm && zm.freshness.kind !== 'live' && <span className={`st-label-fresh f-${zm.freshness.kind}`}>{zm.freshness.text}</span>}
    </div>
  )
}

/** A project JARVIS is building: its name, how far its build has got, and what it's doing. */
function ProjectLabel({ pad }: { pad: ProjectPad }) {
  const { stream, ap, live, done, total } = useProjectPad(pad.id)
  const mode = useStation((s) => s.mode)
  const ref = useAnchor(`project-${pad.id}`, [pad.pos[0], 2.75, pad.pos[2]], () => (live ? 3 : 2))
  const cinematic = mode !== 'command'
  const waiting = Boolean(ap && (ap.blocked || ap.waiting > 0))
  const word = live ? 'building now' : waiting ? 'needs you' : ap?.paused ? 'paused' : null
  const next = stream?.milestones.find((m) => !m.done)?.text
  return (
    <div
      ref={ref}
      className={`st-label st-label-${live ? 'active' : waiting ? 'attention' : 'idle'} ${cinematic ? 'cine' : ''}`}
      style={{ '--zc': pad.color } as CSSProperties}
      onClick={() => useHub.getState().setPrefs({ view: 'projects' })}
      title={`${pad.label}: open it on the Projects page`}
    >
      <span className="st-label-name">
        <i className="st-label-dot" />
        {pad.label}
        {total > 0 && <em>{`${done}/${total}`}</em>}
        {!cinematic && word && <em>{word}</em>}
      </span>
      {!cinematic && <span className="st-label-head">{live ? live.replace(/^[^:]*:\s*/, '') : next ? `next: ${next}` : stream ? 'every milestone done' : 'reading the brief…'}</span>}
    </div>
  )
}

function LinkLabel({ id }: { id: string }) {
  const link = useStation((s) => s.model?.links.find((l) => l.id === id))
  const ref = useAnchor(`link-${id}`, link ? linkAnchor(link) : null, () => 0.5)
  if (!link) return null
  return (
    <div ref={ref} className={`st-link-label l-${link.style}`}>
      <b>{link.style}</b> {link.label}
    </div>
  )
}

const pointer = { x: 0, y: 0 }
const place = (el: HTMLElement | null) => el && (el.style.transform = `translate3d(${pointer.x + 14}px, ${pointer.y + 14}px, 0)`)

function Tooltip() {
  const hovered = useStation((s) => s.hovered)
  const model = useStation((s) => s.model)
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      place(el.current)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])
  const desk = useStation((s) => s.deskHover)
  const screen = useStation((s) => s.screenHover)
  useLayoutEffect(() => void place(el.current), [hovered, desk, screen])
  if (screen !== null && SCREENS[screen])
    return (
      <div ref={el} className="st-tip">
        <b>{SCREENS[screen].name} screen</b>
        <span className="st-tip-state t-live">click to use it</span>
        <span>Opens {SCREENS[screen].what} · Esc comes back</span>
      </div>
    )
  if (desk)
    return (
      <div ref={el} className="st-tip">
        <b>The desk</b>
        <span className="st-tip-state t-live">click to sit down</span>
        <span>Talk to JARVIS, run Claude Code, work on ideas</span>
      </div>
    )
  // Zones already carry a label; the tooltip is for the things on them.
  const d = hovered && model && hovered.kind !== 'zone' ? describe(hovered, model) : null
  if (!d) return null
  return (
    <div ref={el} className="st-tip">
      <b>{d.title}</b>
      <span className={`st-tip-state t-${d.tone}`}>{d.status}</span>
      {d.lines.slice(0, 2).map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  )
}

/** The label layer, drawn over the canvas. */
export function LabelLayer() {
  const connections = useStation((s) => s.connections)
  const mode = useStation((s) => s.mode)
  const linkIds = useStation((s) => s.model?.links.map((l) => l.id).join('|') ?? '')
  return (
    <div className="st-labels" aria-hidden={mode !== 'command'}>
      {ZONES.map((z) => (
        <ZoneLabel key={z.id} id={z.id} />
      ))}
      {PROJECT_PADS.map((p) => (
        <ProjectLabel key={p.id} pad={p} />
      ))}
      {connections && mode === 'command' && linkIds.split('|').filter(Boolean).map((id) => <LinkLabel key={id} id={id} />)}
      <Tooltip />
    </div>
  )
}

/** The console stays clear: no label is ever drawn over the desk, chair or monitors. */
const R = CONSOLE_R - 0.4
const KEEP_CLEAR = [[-R, 0.3, -R, R, 0.3, -R, -R, 0.3, R, R, 0.3, R, -R, 1.95, -R, R, 1.95, -R, -R, 1.95, R, R, 1.95, R]].map((c) =>
  Array.from({ length: c.length / 3 }, (_, i) => new THREE.Vector3(c[i * 3], c[i * 3 + 1], c[i * 3 + 2])),
)

/** Inside the canvas: place every label for this frame. */
export function LabelProjector() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const v = useMemo(() => new THREE.Vector3(), [])
  const frame = useRef(0)
  const hud = useRef<Box[]>([])
  useFrame(() => {
    frame.current++
    // The HUD is in the way too: a label never sits under a panel.
    if (frame.current % 30 === 1)
      hud.current = [...document.querySelectorAll('.st-panels > *, .st-viewbar, .st-top > *, .st-dock')].map((el) => {
        const r = el.getBoundingClientRect()
        return [r.left, r.top, r.right, r.bottom]
      })
    const placed: Box[] = [...hud.current]
    for (const pts of KEEP_CLEAR) {
      const b: Box = [Infinity, Infinity, -Infinity, -Infinity]
      for (const p of pts) {
        v.copy(p).project(camera)
        if (v.z > 1) continue
        const sx = (v.x * 0.5 + 0.5) * size.width
        const sy = (-v.y * 0.5 + 0.5) * size.height
        b[0] = Math.min(b[0], sx)
        b[1] = Math.min(b[1], sy)
        b[2] = Math.max(b[2], sx)
        b[3] = Math.max(b[3], sy)
      }
      if (b[0] < b[2]) placed.push(b)
    }
    const list = [...anchors.values()].sort((a, b) => b.pri() - a.pri())
    // Looking at the house from outside (the roof's on, outside Command):
    // the names would float over the roof, so they wait till you're back in.
    const outside = useStation.getState().mode !== 'command' && (Math.hypot(camera.position.x, camera.position.z) > HOUSE.r + 0.5 || camera.position.y > HOUSE.ceiling)
    for (const a of list) {
      // Sizes only change with content; re-measure now and then.
      if (!a.w || frame.current - a.seen > 30) {
        a.w = a.el.offsetWidth
        a.h = a.el.offsetHeight
        a.seen = frame.current
      }
      v.copy(a.pos).project(camera)
      const behind = v.z > 1
      let x = (v.x * 0.5 + 0.5) * size.width - a.w / 2
      let y = (-v.y * 0.5 + 0.5) * size.height - a.h
      let ok = !behind && !outside && x > -a.w && x < size.width && y > -a.h && y < size.height
      if (ok) {
        // Where it would go; failing that, nudged up or down, or slid
        // sideways clear of whatever it hits; failing all that, hidden.
        const hit = (r: Box) => placed.find((p) => r[0] < p[2] + 6 && r[2] + 6 > p[0] && r[1] < p[3] + 4 && r[3] + 4 > p[1])
        const box = (dx: number, dy: number): Box => [x + dx, y + dy, x + dx + a.w, y + dy + a.h]
        const first = hit(box(0, 0))
        const step = a.h + 6
        const tries: [number, number][] = [[0, 0], [0, -step], [0, step]]
        if (first) tries.push([first[2] + 8 - x, 0], [first[0] - 8 - (x + a.w), 0])
        tries.push([0, -2 * step])
        ok = false
        for (const [dx, dy] of tries) {
          if (Math.abs(dx) > 220) continue
          const r = box(dx, dy)
          if (r[0] < 0 || r[2] > size.width || hit(r)) continue
          x += dx
          y += dy
          placed.push(r)
          ok = true
          break
        }
      }
      a.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      a.el.style.opacity = ok ? '' : '0'
      a.el.style.pointerEvents = ok ? '' : 'none'
    }
  })
  return null
}
