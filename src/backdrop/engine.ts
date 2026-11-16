import { buildFragment } from './glsl'
import { SCENES } from './scenes'
import type { World } from './world'

/**
 * The renderer behind the station's backdrop: one WebGL2 fullscreen triangle,
 * one fragment program per scene.
 *
 * What keeps it smooth while the window is dragged, resized or the camera is
 * orbited:
 *  - The drawing buffer is sized from a pixel budget (the backdrop is soft,
 *    low-frequency art; the browser's bilinear upscale is invisible) instead
 *    of "as many pixels as the display has". The budget only ever steps down,
 *    in slow hysteresis, so resolution never pumps up and down.
 *  - Resizing a canvas clears it. Every resize therefore redraws in the same
 *    callback, before the browser paints, so there is no black flash.
 *  - Shaders compile in parallel off the main thread where the browser can
 *    (KHR_parallel_shader_compile); a scene only appears once it is ready,
 *    and it fades in, so nothing hitches or pops.
 *  - It draws nothing while the tab is hidden, scrolled away or told to rest.
 *  - The page's orbit camera is fed in as `cam`, so the world parallaxes with
 *    the 3D room instead of sitting flat behind it.
 */

export type Quality = 'low' | 'high' | 'ultra'

export type Frame = {
  t: number
  dt: number
  accent: [number, number, number]
  b: [number, number, number]
  c: [number, number, number]
  void: [number, number, number]
  /** Orbit camera as the shader wants it: x/y pan in screen units, z zoom. */
  cam?: [number, number, number]
  world: World
}

const MAX_W = 3840
const MAX_H = 2160
const STEP = 0.82
const MAX_LEVEL = 3

const QUALITY = {
  low: { budgetMp: 0.3, oct: 3 },
  high: { budgetMp: 0.75, oct: 4 },
  ultra: { budgetMp: 1.5, oct: 5 },
} as const

const VERT = `#version 300 es
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  gl_Position=vec4(p*2.-1.,0.,1.);
}`

const UNIFORMS = ['uRes', 'uT', 'uSeed', 'uA', 'uB', 'uC', 'uVoid', 'uOct', 'uAct', 'uLive', 'uGames', 'uLeads', 'uJobs', 'uFin', 'uFuel', 'uNeed', 'uCount', 'uCam', 'uFade'] as const
type Prog = { program: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }

export class BackdropEngine {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext | null = null
  private vao: WebGLVertexArrayObject | null = null
  private parallel: { COMPLETION_STATUS_KHR: number } | null = null
  private progs = new Map<number, Prog>()
  private building = new Map<number, Promise<boolean>>()
  private sceneIndex = -1
  private pending = -1
  private fade = 0
  private quality: Quality = 'ultra'
  private seed: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5]
  private level = 0
  private holdUp = 0
  private raf = 0
  private running = false
  private paused = false
  private onScreen = true
  private last = 0
  private frames = 0
  private ema = 16.7
  private refresh = 16.7
  private minDt = Infinity
  private slow = 0
  private fast = 0
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private lastFrame: Frame | null = null
  private source: ((dt: number) => Frame) | null = null
  private ro: ResizeObserver | null = null
  private io: IntersectionObserver | null = null
  private dprQuery: MediaQueryList | null = null
  private onLost = (e: Event) => {
    e.preventDefault()
    this.progs.clear()
    this.building.clear()
    this.gl = null
    this.onFail?.('lost')
  }
  private onRestored = () => {
    if (this.init()) this.onRecover?.()
  }
  private onDpr = () => {
    this.watchDpr()
    this.measure()
  }
  private onVis = () => {
    this.last = 0
    this.schedule()
  }
  onFail?: (why: string) => void
  onRecover?: () => void
  /** Last shader compile problem, for diagnostics. */
  lastError = ''
  stats = { fps: 0, level: 0, w: 0, h: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null
    if (!gl) return false
    this.gl = gl
    this.vao = gl.createVertexArray()
    this.parallel = gl.getExtension('KHR_parallel_shader_compile')
    this.progs.clear()
    this.building.clear()
    this.applySize()
    return true
  }

  setSeed(seed: [number, number, number, number]) {
    this.seed = seed
  }

  setQuality(q: Quality) {
    this.quality = q
    this.applySize()
    this.renderNow()
  }

  /** Stop drawing (the page is covering the backdrop) or resume. */
  setPaused(p: boolean) {
    if (this.paused === p) return
    this.paused = p
    this.last = 0
    if (!p) this.renderNow()
    this.schedule()
  }

  /**
   * Show scene `i` once its program is ready. The current scene dips out and
   * the new one fades up, so a switch never blinks or stalls a frame.
   */
  async setScene(i: number): Promise<boolean> {
    const n = SCENES.length
    const idx = ((i % n) + n) % n
    if (!(await this.compile(idx))) return false
    if (idx === this.sceneIndex) {
      this.pending = -1
      return true
    }
    if (this.sceneIndex < 0) {
      this.sceneIndex = idx
      this.fade = 0
    } else {
      this.pending = idx
    }
    this.schedule()
    return true
  }

  /** Skip the fade (screenshots and the test page). */
  showNow() {
    if (this.pending >= 0) {
      this.sceneIndex = this.pending
      this.pending = -1
    }
    this.fade = 1
  }

  get scene() {
    return this.pending >= 0 ? this.pending : this.sceneIndex
  }

  private compile(idx: number): Promise<boolean> {
    const gl = this.gl
    if (!gl) return Promise.resolve(false)
    if (this.progs.has(idx)) return Promise.resolve(true)
    const open = this.building.get(idx)
    if (open) return open
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, VERT)
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, buildFragment(SCENES[idx].code))
    gl.compileShader(fs)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    const finish = (): boolean => {
      if (this.gl !== gl) return false
      const ok = gl.getProgramParameter(program, gl.LINK_STATUS)
      if (!ok) {
        const log = gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program) || 'unknown'
        this.lastError = `${SCENES[idx].id}: ${log}`
        console.warn('[backdrop] shader failed', this.lastError)
        gl.deleteProgram(program)
      } else {
        const loc: Record<string, WebGLUniformLocation | null> = {}
        for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(program, u) ?? gl.getUniformLocation(program, `${u}[0]`)
        this.progs.set(idx, { program, loc })
      }
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      return !!ok
    }

    const par = this.parallel
    const p = new Promise<boolean>((resolve) => {
      if (!par) return resolve(finish())
      const poll = () => {
        if (this.gl !== gl) return resolve(false)
        if (gl.getProgramParameter(program, par.COMPLETION_STATUS_KHR)) resolve(finish())
        else setTimeout(poll, 12)
      }
      poll()
    }).finally(() => this.building.delete(idx))
    this.building.set(idx, p)
    return p
  }

  // ---------------------------------------------------------------- sizing

  private watchDpr() {
    this.dprQuery?.removeEventListener('change', this.onDpr)
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    this.dprQuery.addEventListener('change', this.onDpr)
  }

  private measure(box?: { width: number; height: number }) {
    const r = box ?? this.canvas.getBoundingClientRect()
    this.cssW = Math.max(1, r.width)
    this.cssH = Math.max(1, r.height)
    this.dpr = window.devicePixelRatio || 1
    if (this.applySize()) this.renderNow()
  }

  /** Returns true when the drawing buffer changed (and so was cleared). */
  private applySize(): boolean {
    if (!this.cssW || !this.cssH) return false
    let w = this.cssW * this.dpr
    let h = this.cssH * this.dpr
    const clamp = Math.min(1, MAX_W / w, MAX_H / h)
    w *= clamp
    h *= clamp
    const budget = QUALITY[this.quality].budgetMp * 1e6 * Math.pow(STEP, this.level * 2)
    const k = Math.min(1, Math.sqrt(budget / Math.max(1, w * h)))
    w = Math.max(2, Math.round(w * k))
    h = Math.max(2, Math.round(h * k))
    this.stats.level = this.level
    this.stats.w = w
    this.stats.h = h
    if (this.canvas.width === w && this.canvas.height === h) return false
    this.canvas.width = w
    this.canvas.height = h
    return true
  }

  // ------------------------------------------------------------------ loop

  start(source: (dt: number) => Frame) {
    this.source = source
    if (this.running) return
    this.running = true
    this.ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect
      this.measure(box && box.width > 0 && box.height > 0 ? box : undefined)
    })
    this.ro.observe(this.canvas)
    this.io = new IntersectionObserver((e) => {
      this.onScreen = e[e.length - 1]?.isIntersecting ?? true
      this.last = 0
      this.schedule()
    })
    this.io.observe(this.canvas)
    this.watchDpr()
    document.addEventListener('visibilitychange', this.onVis)
    this.measure()
    this.last = 0
    this.schedule()
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
    this.io?.disconnect()
    this.dprQuery?.removeEventListener('change', this.onDpr)
    this.dprQuery = null
    document.removeEventListener('visibilitychange', this.onVis)
  }

  dispose() {
    this.stop()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    const gl = this.gl
    if (gl) {
      for (const p of this.progs.values()) gl.deleteProgram(p.program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    this.progs.clear()
    this.building.clear()
    this.gl = null
  }

  private get active() {
    return this.running && !this.paused && this.onScreen && !document.hidden
  }

  private schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.active) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    this.raf = 0
    if (!this.active) return
    this.raf = requestAnimationFrame(this.tick)
    if (!this.gl || !this.source) return
    const dtMs = this.last ? now - this.last : 16.7
    this.last = now
    // A frame this long means the tab was throttled; measuring it would only
    // push the resolution down for nothing.
    if (dtMs > 250) return
    this.frames++
    this.ema += (dtMs - this.ema) * 0.06
    if (this.frames <= 90 && dtMs > 4) {
      this.minDt = Math.min(this.minDt, dtMs)
      this.refresh = Math.max(6, Math.min(34, this.minDt))
    }
    this.adapt()
    this.stepFade(dtMs / 1000)
    this.stats.fps = 1000 / this.ema
    this.lastFrame = this.source(Math.min(0.1, dtMs / 1000))
    this.draw(this.lastFrame)
  }

  /** Dip the old scene out, swap programs at black, fade the new one in. */
  private stepFade(dt: number) {
    if (this.pending >= 0) {
      this.fade = Math.max(0, this.fade - dt * 4)
      if (this.fade <= 0) {
        this.sceneIndex = this.pending
        this.pending = -1
      }
    } else if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt * 1.1)
    }
  }

  /** Step the buffer down when frames run long; creep back only after a long calm. */
  private adapt() {
    if (this.frames < 60) return
    if (this.holdUp > 0) this.holdUp--
    if (this.ema > this.refresh * 1.32) {
      this.slow++
      this.fast = 0
    } else if (this.ema < this.refresh * 1.1) {
      this.fast++
      this.slow = 0
    } else {
      this.slow = 0
      this.fast = 0
    }
    if (this.slow > 60 && this.level < MAX_LEVEL) {
      this.level++
      this.slow = 0
      this.holdUp = 900
      if (this.applySize()) this.renderNow()
    } else if (this.fast > 600 && this.holdUp <= 0 && this.level > 0) {
      this.level--
      this.fast = 0
      this.holdUp = 900
      if (this.applySize()) this.renderNow()
    }
  }

  /** Repaint the last frame immediately (used after the buffer is cleared). */
  private renderNow() {
    if (!this.gl || !this.running) return
    const f = this.lastFrame ?? this.source?.(0)
    if (f) this.draw(f)
  }

  /** Render one frame with the given inputs (also used by the test page). */
  draw(f: Frame) {
    const gl = this.gl
    if (this.sceneIndex < 0 && this.fade === 0) {
      // Nothing is ready yet: keep the void colour, not stale pixels.
      if (gl) {
        gl.clearColor(f.void[0], f.void[1], f.void[2], 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      return
    }
    const prog = this.progs.get(this.sceneIndex)
    if (!gl || !prog || !this.vao) return
    const L = prog.loc
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(prog.program)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(L.uT, f.t)
    gl.uniform4f(L.uSeed, ...this.seed)
    gl.uniform3f(L.uA, ...f.accent)
    gl.uniform3f(L.uB, ...f.b)
    gl.uniform3f(L.uC, ...f.c)
    gl.uniform3f(L.uVoid, ...f.void)
    gl.uniform3f(L.uCam, ...(f.cam ?? [0, 0, 0]))
    gl.uniform1f(L.uFade, this.fade * this.fade * (3 - 2 * this.fade))
    gl.uniform1i(L.uOct, QUALITY[this.quality].oct)
    gl.uniform1f(L.uAct, f.world.act)
    gl.uniform1f(L.uLive, f.world.live)
    gl.uniform4fv(L.uGames, f.world.games)
    gl.uniform1fv(L.uLeads, f.world.leads)
    gl.uniform3fv(L.uJobs, f.world.jobs)
    gl.uniform2fv(L.uFin, f.world.fin)
    gl.uniform4fv(L.uFuel, f.world.fuel)
    gl.uniform4fv(L.uNeed, f.world.need)
    gl.uniform4fv(L.uCount, f.world.count)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
