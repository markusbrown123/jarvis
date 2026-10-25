import { BackdropEngine } from './engine'
import { SCENES } from './scenes'
import { easeWorld, emptyWorld, mapHub, hslToRgb } from './world'
import type { HubState } from '../hub/types'

const q = new URLSearchParams(location.search)
const idx = Number(q.get('scene') ?? 0)
const t = Number(q.get('t') ?? 20)
const mode = q.get('data') ?? 'full'
const hue = Number(q.get('hue') ?? 0.5)
const quality = (q.get('q') ?? 'ultra') as 'low' | 'high' | 'ultra'

const games = Array.from({ length: 14 }, (_, i) => ({
  id: 'g' + i, name: 'Game ' + i, tagline: null, readmeStatus: null, published: i % 5 === 0, placeId: null, playtest: null, art: {},
  tasks: { done: [9, 2, 14, 0, 6, 11, 3, 8, 1, 12, 5, 7, 10, 4][i], running: i % 3 === 0 ? 2 : 0, queued: 4 + (i % 4), blocked: i === 6 ? 2 : 0 },
  active: i === 2 || i === 9, next: false,
}))
const full = {
  version: 1, serverTime: Date.now(), previews: {}, activity: [],
  jobs: Object.fromEntries(['running', 'running', 'running', 'needs_markus', 'retrying', 'queued'].map((st, i) => ['j' + i, { id: 'j' + i, source: 'x', project: 'roblox', title: 't', state: st, game: 'g' + [2, 9, 4, 6, 11, 0][i], updatedAt: Date.now() - i * 1000 }])),
  items: { a: { id: 'a', state: 'open', priority: 'P1', source: 'x', project: 'p', title: 't', createdAt: 0, updatedAt: 0 }, b: { id: 'b', state: 'open', priority: 'P2', source: 'x', project: 'p', title: 't', createdAt: 0, updatedAt: 0 }, c: { id: 'c', state: 'open', priority: 'P3', source: 'x', project: 'p', title: 't', createdAt: 0, updatedAt: 0 } },
  usage: { windows: { five_hour: { usedPct: 38, resetsAt: Date.now() + 3e6, observedAt: 0, source: 'x' }, seven_day: { usedPct: 61, resetsAt: Date.now() + 3e8, observedAt: 0, source: 'x' } }, context: null, requests: { count: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 8 }, status: null, sources: {} },
  projects: {
    roblox: { id: 'roblox', name: 'Roblox', games, updatedAt: 0 },
    automaton: { id: 'automaton', name: 'A', publicUrl: '', routes: [], repo: null, site: null, sites: Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, name: 'x', category: null, location: null, stage: ['generated_draft', 'needs_review', 'approved', 'client_ready', 'deployed'][i % 5], previewUrl: null, publishedUrl: i % 4 === 0 ? 'u' : null, publishStatus: null, publishedAt: null, updatedAt: 0 })), sitesError: null, leads: { total: 44, byStage: { pitched: 20, sample_built: 9, sample_sent: 6, paid: 3, site_live: 4, lost: 2 } }, leadsError: null, board: null, updatedAt: 0 },
    finance: { id: 'finance', name: 'F', mode: 'x', broker: null, services: [1, 1, 1, 0, 1].map((u, i) => ({ id: 's' + i, name: 'svc', url: '', up: !!u, status: 200, ms: 120 + i * 200, repo: null, commit: null, checkedAt: 0 })), research: [], charts: [], quantView: { name: 'QuantVue', url: 'https://www.quantvue.io/' }, note: '', updatedAt: 0 },
  },
} as unknown as HubState

const out = document.createElement('pre')
out.id = 'out'
out.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;color:#0f0;font:11px monospace;display:none'
document.body.append(out)
const canvas = document.getElementById('c') as HTMLCanvasElement
const eng = new BackdropEngine(canvas)
const w = window as unknown as Record<string, unknown>
async function main() {
  if (!eng.init()) { w.__result = { error: 'no webgl2' }; return }
  eng.setQuality(quality)
  eng.setSeed([Number(q.get('s0') ?? 0.31), Number(q.get('s1') ?? 0.62), Number(q.get('s2') ?? 0.47), Number(q.get('s3') ?? 0.83)])
  const ok = await eng.setScene(idx)
  eng.showNow()
  if (!ok) { w.__result = { error: eng.lastError }; return }
  const tgt = mapHub(mode === 'none' ? null : full, 'live', Date.now(), 3, 1)
  tgt.act = Number(q.get('act') ?? 0)
  const cur = emptyWorld()
  easeWorld(cur, tgt, 100)
  const a = hslToRgb(hue, 0.8, 0.55)
  const b = hslToRgb(hue + 0.11, 0.7, 0.55)
  const c = hslToRgb(hue - 0.22, 0.75, 0.58)
  const frame = { t, dt: 0.016, accent: a, b, c, void: [0.016, 0.013, 0.024] as [number, number, number], world: cur }
  eng.draw(frame)
  const probe = document.createElement('canvas')
  probe.width = 160; probe.height = 90
  const ctx = probe.getContext('2d')!
  ctx.drawImage(canvas, 0, 0, 160, 90)
  const d = ctx.getImageData(0, 0, 160, 90).data
  let sum = 0, mx = 0
  const ls: number[] = []
  for (let i = 0; i < d.length; i += 4) { const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; sum += l; mx = Math.max(mx, l); ls.push(l) }
  ls.sort((x, y) => x - y)
  w.__result = { scene: SCENES[idx].id, mean: +(sum / ls.length).toFixed(4), p95: +ls[Math.floor(ls.length * 0.95)].toFixed(3), max: +mx.toFixed(3), w: canvas.width, h: canvas.height }
}
function bench() {
  const gl = canvas.getContext('webgl2')!
  const scale = Number(q.get('bench'))
  const cur2 = emptyWorld(); easeWorld(cur2, mapHub(full, 'live', Date.now(), 3, 1), 100)
  const frame = { t: 10, dt: 0.016, accent: hslToRgb(0.5, 0.8, 0.55), b: hslToRgb(0.61, 0.7, 0.55), c: hslToRgb(0.28, 0.75, 0.58), void: [0.016, 0.013, 0.024] as [number, number, number], world: cur2 }
  canvas.width = Math.round(3840 * scale); canvas.height = Math.round(2160 * scale)
  const px = new Uint8Array(4)
  eng.draw(frame); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const t0 = performance.now()
  for (let i = 0; i < 12; i++) { frame.t += 0.016; eng.draw(frame); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) }
  w.__result = { ...(w.__result as object), bench: `${canvas.width}x${canvas.height}`, msPerFrame: +((performance.now() - t0) / 12).toFixed(2) }
}

void main().then(() => {
  if (q.get('bench')) bench()
})
