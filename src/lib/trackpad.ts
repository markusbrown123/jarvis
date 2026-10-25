/**
 * Trackpad.
 *
 * Turns a stream of hand measurements into what a trackpad would report: a
 * cursor that moves RELATIVE to the hand, clicks, a drag, a double click, a
 * right click, and a scroll/zoom mode. Pinch is the only gesture it needs.
 *
 * No DOM in here, on purpose. hands.ts measures the hand and dispatches the
 * events; this file only decides what the measurements mean, so the decisions
 * can be exercised with synthetic input (scripts/test-trackpad.mts).
 *
 * The gesture map
 *
 *   move hand ........ cursor moves by how far the hand moved, not to where it is
 *   open palm ........ clutch: cursor stops, reposition freely (as does leaving the frame)
 *   thumb+index tap .. left click
 *   pinch, then move . press and drag
 *   two quick pinches  double click — or, on empty background, toggle scroll mode
 *   thumb+middle ..... right click
 *   scroll mode:  pinch and move  scrolls what is under the cursor
 *                 pinch and twist zooms (turn it like a dial)
 */

export type PinchKind = 'none' | 'index' | 'middle'
export type PadMode = 'move' | 'scroll'
export type CursorState = 'clutch' | 'moving' | 'pressed' | 'dragging' | 'scrolling' | 'zooming'

/* ------------------------------------------------------------------- tuning */

/**
 * Thumb-to-finger gap as a fraction of hand span, with hysteresis: it takes a
 * tighter pinch to start than to keep, so a held pinch cannot flicker on the
 * boundary and a click is never two clicks.
 */
export const PINCH_ON = 0.4
export const PINCH_OFF = 0.6
/** Thumb-to-middle is a little stricter, because a curled middle finger passes close to the thumb. */
const MIDDLE_ON = 0.36
const MIDDLE_OFF = 0.56
/** A middle pinch needs the index finger clearly away: its gap at least this many times the middle's. */
const MIDDLE_INDEX_RATIO = 1.7
/** An index pinch is refused only when the middle finger is clearly the closer one. */
const INDEX_MIDDLE_RATIO = 0.7

/** How long a pinch must persist before it counts — see hands.ts for why. */
const INDEX_CONFIRM_MS = 70
const MIDDLE_CONFIRM_MS = 110
/** After the pose changes or the hand comes back, pinches are ignored this long. */
const POSE_SETTLE_MS = 220
const REENGAGE_SETTLE_MS = 160

/** An open palm for this long is a clutch. */
const OPEN_CLUTCH_MS = 110

/** Per-frame hand movement below this is noise, not intent (soft: the excess still passes). */
const SOFT_DEAD_PX = 0.3
/** Hand span the speed curve is calibrated for, as a fraction of the screen diagonal. */
const REF_SPAN_FRACTION = 0.085
/** Pointer acceleration: precise when slow, long reach when fast. Hand px/s -> gain. */
const GAIN_MIN = 1.0
const GAIN_MAX = 2.8
const SPEED_LO = 120
const SPEED_HI = 1300

/** A press that moves less than this fraction of a hand span is a click, not a drag. */
const DRAG_SLOP_SPAN = 0.1
/** Two taps within this, and this close on screen, are a double. */
const DOUBLE_MS = 450
const DOUBLE_SLOP_PX = 40
/** A press held longer than this is not part of a double. */
const TAP_MAX_MS = 450

const SCROLL_GAIN = 1.8
/** Hand roll before a twist counts as zoom, and how much zoom a degree is. */
const TWIST_DEAD_RAD = (10 * Math.PI) / 180
const ZOOM_PER_DEG = 14
/** Scroll mode hands itself back after this long without a pinch. */
const SCROLL_IDLE_MS = 12000

/* -------------------------------------------------------------------- types */

export type TpInput = {
  /** ms */
  now: number
  /** Stable point on the hand, filtered, in viewport px. */
  ax: number
  ay: number
  /** Wrist to middle knuckle, px. */
  span: number
  /** Thumb tip to finger tip over span. */
  gapIndex: number
  gapMiddle: number
  /** Raw (unsmoothed) open-palm reading. */
  open: boolean
  /** Hand roll about the camera axis, radians. */
  roll: number
  vw: number
  vh: number
}

export type TpEvent =
  | { t: 'down' }
  | { t: 'up'; dragged: boolean; clicks: 0 | 1 | 2 }
  | { t: 'right' }
  | { t: 'mode'; mode: PadMode }

export type TpOut = {
  x: number
  y: number
  state: CursorState
  pinch: PinchKind
  mode: PadMode
  /** 0..1 progress of a thumb+middle pinch towards firing a right click. */
  rightProgress: number
  /** Hand movement this frame in scroll mode, px. Content follows the hand, so scroll by the negative. */
  scrollX: number
  scrollY: number
  /** Zoom to apply this frame; positive zooms in. */
  zoom: number
  events: TpEvent[]
}

type Press = {
  at: number
  travel: number
  dragging: boolean
  lock: 'none' | 'scroll' | 'zoom'
  rollLast: number
  twist: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI

function gainFor(speed: number): number {
  const t = clamp((speed - SPEED_LO) / (SPEED_HI - SPEED_LO), 0, 1)
  return GAIN_MIN + (GAIN_MAX - GAIN_MIN) * t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------- the pad */

export class Trackpad {
  x: number
  y: number
  mode: PadMode = 'move'

  private last: { x: number; y: number } | null = null
  private lastAt = 0
  private spanF = 0
  private openSince: number | null = null
  private settleUntil = 0
  private fresh = true
  private pinch: PinchKind = 'none'
  private cand: { kind: PinchKind; since: number } | null = null
  private press: Press | null = null
  private tap: { at: number; x: number; y: number } | null = null
  private activeAt = 0
  private state: CursorState = 'moving'

  constructor(vw: number, vh: number) {
    this.x = vw / 2
    this.y = vh / 2
  }

  /** The hand has left. Keeps the cursor and the mode: reposition and carry on. */
  lost() {
    this.last = null
    this.openSince = null
    this.pinch = 'none'
    this.cand = null
    this.press = null
    this.tap = null
    this.fresh = true
    this.state = 'clutch'
  }

  /** The finger pose just changed: ignore pinches while the hand finishes rearranging. */
  noteTransition(now: number) {
    this.settleUntil = Math.max(this.settleUntil, now + POSE_SETTLE_MS)
  }

  toggleMode(now: number): PadMode {
    this.mode = this.mode === 'move' ? 'scroll' : 'move'
    this.activeAt = now
    return this.mode
  }

  step(i: TpInput): TpOut {
    const events: TpEvent[] = []
    const { now } = i
    if (this.fresh) {
      this.settleUntil = now + REENGAGE_SETTLE_MS
      this.activeAt = now
      this.fresh = false
    }
    const dt = clamp((now - this.lastAt) / 1000, 1 / 120, 1 / 12)
    this.lastAt = now
    this.spanF = this.spanF ? this.spanF + (i.span - this.spanF) * 0.06 : i.span

    if (this.mode === 'scroll' && this.pinch === 'none' && now - this.activeAt > SCROLL_IDLE_MS) {
      this.mode = 'move'
      events.push({ t: 'mode', mode: 'move' })
    }

    // -- clutch: an open palm is "lift your finger off the trackpad" ----------
    if (i.open && this.pinch === 'none') this.openSince ??= now
    else this.openSince = null
    const clutched = this.openSince !== null && now - this.openSince >= OPEN_CLUTCH_MS
    if (clutched) {
      this.last = null
      this.cand = null
      this.settleUntil = Math.max(this.settleUntil, now + REENGAGE_SETTLE_MS)
    }
    const settled = now >= this.settleUntil

    // -- pinch: hysteresis, then a confirm window -----------------------------
    let want: PinchKind
    if (clutched) want = 'none'
    else if (this.pinch === 'index') want = i.gapIndex < PINCH_OFF ? 'index' : 'none'
    else if (this.pinch === 'middle') want = i.gapMiddle < MIDDLE_OFF ? 'middle' : 'none'
    else if (!settled) want = 'none'
    else {
      const idx = i.gapIndex < PINCH_ON && i.gapMiddle >= i.gapIndex * INDEX_MIDDLE_RATIO
      const mid = i.gapMiddle < MIDDLE_ON && i.gapIndex > Math.max(PINCH_OFF, i.gapMiddle * MIDDLE_INDEX_RATIO)
      want = idx ? 'index' : mid ? 'middle' : 'none'
    }

    if (this.pinch === 'none') {
      if (want === 'none') this.cand = null
      else {
        if (!this.cand || this.cand.kind !== want) this.cand = { kind: want, since: now }
        const need = want === 'index' ? INDEX_CONFIRM_MS : MIDDLE_CONFIRM_MS
        if (now - this.cand.since >= need) {
          this.pinch = want
          this.cand = null
          this.activeAt = now
          if (want === 'index') {
            this.press = { at: now, travel: 0, dragging: false, lock: 'none', rollLast: i.roll, twist: 0 }
            events.push({ t: 'down' })
          } else {
            events.push({ t: 'right' })
          }
        }
      }
    } else if (want === 'none') {
      if (this.pinch === 'index' && this.press) {
        const p = this.press
        let clicks: 0 | 1 | 2 = 0
        if (!p.dragging) {
          const t = this.tap
          const quick = now - p.at <= TAP_MAX_MS
          const again =
            quick && t !== null && now - t.at <= DOUBLE_MS && Math.hypot(this.x - t.x, this.y - t.y) <= DOUBLE_SLOP_PX
          clicks = again ? 2 : 1
          this.tap = again || !quick ? null : { at: now, x: this.x, y: this.y }
        } else {
          this.tap = null
        }
        events.push({ t: 'up', dragged: p.dragging, clicks })
      }
      this.press = null
      this.pinch = 'none'
      this.activeAt = now
    }

    // -- movement --------------------------------------------------------------
    let scrollX = 0
    let scrollY = 0
    let zoom = 0
    const prev = this.last
    this.last = { x: i.ax, y: i.ay }

    if (prev && !clutched) {
      let dx = i.ax - prev.x
      let dy = i.ay - prev.y
      const mag = Math.hypot(dx, dy)
      if (mag > 0) {
        const k = Math.max(0, mag - SOFT_DEAD_PX) / mag
        dx *= k
        dy *= k
      }
      const ref = Math.hypot(i.vw, i.vh) * REF_SPAN_FRACTION
      const norm = clamp(ref / Math.max(this.spanF, 1), 0.7, 1.6)
      dx *= norm
      dy *= norm

      const p = this.press
      if (this.pinch === 'index' && p) {
        p.travel += Math.hypot(dx, dy)
        const slop = DRAG_SLOP_SPAN * ref
        if (this.mode === 'scroll') {
          const dRoll = wrap(i.roll - p.rollLast)
          p.rollLast = i.roll
          p.twist += dRoll
          if (p.lock === 'none') {
            if (Math.abs(p.twist) > TWIST_DEAD_RAD) p.lock = 'zoom'
            else if (p.travel > slop) p.lock = 'scroll'
            if (p.lock !== 'none') p.dragging = true
          } else if (p.lock === 'zoom') {
            zoom = ((dRoll * 180) / Math.PI) * ZOOM_PER_DEG
          } else {
            scrollX = dx * SCROLL_GAIN
            scrollY = dy * SCROLL_GAIN
          }
        } else {
          if (!p.dragging && p.travel > slop) p.dragging = true
          else if (p.dragging) this.move(dx, dy, dt, i)
        }
      } else if (this.pinch === 'none' && !this.cand) {
        this.move(dx, dy, dt, i)
      }
      // A candidate pinch or a middle pinch freezes the cursor: the fingers are
      // busy, and a click must land where the cursor was.
    }

    // -- state, for the indicator ----------------------------------------------
    const p = this.press
    this.state = clutched
      ? 'clutch'
      : this.pinch === 'index' && p
        ? p.lock === 'zoom'
          ? 'zooming'
          : p.lock === 'scroll'
            ? 'scrolling'
            : p.dragging
              ? 'dragging'
              : 'pressed'
        : this.pinch === 'middle' || this.cand
          ? 'pressed'
          : 'moving'

    return {
      x: this.x,
      y: this.y,
      state: this.state,
      pinch: this.pinch,
      mode: this.mode,
      rightProgress:
        this.pinch === 'middle'
          ? 1
          : this.cand?.kind === 'middle'
            ? clamp((now - this.cand.since) / MIDDLE_CONFIRM_MS, 0, 1)
            : 0,
      scrollX,
      scrollY,
      zoom,
      events,
    }
  }

  private move(dx: number, dy: number, dt: number, i: TpInput) {
    const gain = gainFor(Math.hypot(dx, dy) / dt)
    this.x = clamp(this.x + dx * gain, 0, i.vw - 1)
    this.y = clamp(this.y + dy * gain, 0, i.vh - 1)
  }
}
