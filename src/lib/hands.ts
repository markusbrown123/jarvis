import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { OneEuroPoint } from './oneEuro'
import { holdCamera, releaseCamera } from './camera'
import {
  PINCH_OFF,
  PINCH_ON,
  Trackpad,
  type CursorState,
  type PadMode,
  type PinchKind,
  type TpOut,
} from './trackpad'

/**
 * Hands.
 *
 * Your hand appears on screen as a skeleton — every joint, every finger — and
 * works like a trackpad: moving the hand moves a cursor by how far the hand
 * moved, and a pinch is the only click there is. The gesture map and every
 * decision about it live in trackpad.ts; this file measures the hand and
 * dispatches the events.
 *
 * Drawing the whole hand rather than a floating dot is not decoration. You
 * cannot see your own hand against the screen, so with only a dot you are
 * aiming something whose orientation and shape you have to infer. With the
 * skeleton you can see the pinch closing before it fires, see which finger the
 * cursor is riding on, and see immediately when tracking has lost you rather
 * than wondering why nothing responds.
 *
 * The architectural decision is that nothing here knows what a blade is. No
 * hit-testing of blades, no calls to close or move them, no knowledge of the
 * header you drag by. It turns a hand into a position and a press and
 * dispatches ordinary PointerEvents there — so every interaction the mouse
 * already has works with a hand for free, and anything added later works
 * without being taught that hands exist.
 *
 * The camera is off until you ask for it, says so on screen the whole time it
 * is on, and nothing leaves the machine: the model runs locally on the GPU and
 * frames are read and discarded.
 */

/**
 * Served from our own origin, copied out of node_modules by scripts/start.mjs.
 *
 * Not a CDN, for two reasons that both bite. The runtime arrives as a script
 * and the page's CSP names no CDN in `script-src` — so a CDN path is simply
 * blocked, and the symptom is gesture control that never starts with nothing
 * obviously wrong. And a CDN import is a live supply-chain dependency:
 * executable code, re-resolved every load, that we neither control nor can pin
 * against being changed underneath us.
 */
const WASM_BASE = '/mediapipe'

/**
 * The weights stay remote, and that is a different call from the runtime above.
 * This is data, not code: it is fetched, so `connect-src` governs it rather
 * than `script-src`, and nothing in it executes. The browser caches it after
 * first use, exactly as the neural voice model is handled.
 */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

/* ------------------------------------------------------------------ anatomy */

export const WRIST = 0
const THUMB_MCP = 2
export const THUMB_TIP = 4
const INDEX_MCP = 5
const INDEX_PIP = 6
export const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_PIP = 14
const RING_TIP = 16
const PINKY_PIP = 18
const PINKY_TIP = 20

/**
 * The skeleton, as pairs of landmark indices.
 *
 * Written out rather than taken from HandLandmarker.HAND_CONNECTIONS so the
 * renderer does not depend on a static that the library is free to reshape, and
 * so the palm arch below reads as a deliberate choice.
 */
export const BONES: readonly [number, number][] = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [9, 10], [10, 11], [11, 12],
  // ring
  [13, 14], [14, 15], [15, 16],
  // pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // the arch across the knuckles, which is what makes it read as a hand
  // rather than as five separate sticks
  [5, 9], [9, 13], [13, 17],
]

export const TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]

/* -------------------------------------------------------------------- tuning */

/**
 * 1€ filter constants, tuned by the published method: beta at zero, drop
 * minCutoff until a resting hand stops shivering, then raise beta until a fast
 * movement stops trailing.
 *
 * The cursor is filtered harder than the skeleton. Aiming is a precision task
 * and benefits from every bit of steadiness; the skeleton is a picture of your
 * hand and only has to look alive, so it is allowed to be looser and more
 * responsive. Filtering both identically made the drawing feel dead.
 */
const CURSOR_MIN_CUTOFF = 1.1
const CURSOR_BETA = 0.012
const SKELETON_MIN_CUTOFF = 2.4
const SKELETON_BETA = 0.02

/** A finger counts as extended when its tip is this much further from the
 *  wrist than its middle joint. Ratio rather than a y-comparison, so it still
 *  works with your hand rotated or upside down. */
const EXTEND_RATIO = 1.12

/**
 * A gesture must hold for this long before it counts.
 *
 * Fingers pass through other shapes on the way to the one you meant — a fist
 * becomes a point by way of several ambiguous frames — and acting on those
 * intermediate readings is what makes gesture interfaces feel possessed.
 */
const GESTURE_HOLD_MS = 200

/**
 * Landmark confidence gating.
 *
 * A detection is only used when the model is sure it is a hand and the points
 * that matter — thumb, index, middle, index knuckles — are inside the picture.
 * MediaPipe happily extrapolates fingertips beyond the frame edge, and a hand
 * leaving the frame is exactly when those numbers are invented. A frame that
 * fails the gate is treated as unseen, and a hand unseen for longer than the
 * grace period is dropped, which lets go of anything it was holding.
 */
const MIN_HAND_SCORE = 0.6
const FRAME_EDGE = 0.01
const LOST_GRACE_MS = 150

/**
 * Fully spread, not just "four fingers up".
 *
 * A pinch with the other three fingers extended also has four fingers up, so
 * the finger count alone would clutch in the middle of a click. The thumb being
 * well away from the index finger is what an open palm has and a pinch does
 * not. Two thresholds so the clutch does not flicker on its boundary.
 */
const OPEN_GAP_ON = 1.0
const OPEN_GAP_OFF = 0.85

export type Gesture = 'point' | 'pinch' | 'frame' | 'open' | 'fist' | 'peace' | 'none'
export type Side = 'left' | 'right'

/**
 * Whether MediaPipe's handedness label needs inverting.
 *
 * False, because that is what the screen actually showed. The older Hands docs
 * note that handedness assumes a mirrored selfie image and should be swapped if
 * your input is not mirrored — we feed the raw camera frame, so a swap looked
 * right on paper and named every hand backwards in practice. This build of the
 * Tasks API already reports the real hand.
 *
 * A constant rather than a hardcoded expression so that a different build, or a
 * genuinely pre-mirrored input, is a one-word change.
 */
const SWAP_HANDEDNESS = false

/**
 * Which tracked hand a detection belongs to.
 *
 * Handedness alone is not enough to key on, and using it that way caused the
 * worst bug in this file. The classifier is confident but not stable: it
 * mislabels a hand for a frame or two fairly often, especially while the hand
 * is rotating or half out of frame. Keyed purely on the label, that single
 * frame moves the hand into the other slot — which drops the old slot, fires
 * pointercancel, and silently ends whatever was being dragged. The symptom is
 * a drag that works once and then refuses to start again.
 *
 * So identity comes from continuity first: a detection belongs to whichever
 * tracked hand was nearest last frame. Your hand cannot teleport across the
 * screen between frames, but its label can flip, so position is the more
 * trustworthy signal by a wide margin. Handedness decides only where a hand
 * that is genuinely new goes.
 */
const MAX_JUMP_FRACTION = 0.28

function slotFor(
  side: Side,
  wrist: { x: number; y: number },
  taken: Set<number>,
  reach: number,
): number {
  let best = -1
  let bestDist = Infinity
  for (const h of hands) {
    if (taken.has(h.id) || !h.points?.[WRIST]) continue
    const d = Math.hypot(h.points[WRIST].x - wrist.x, h.points[WRIST].y - wrist.y)
    if (d < bestDist) {
      bestDist = d
      best = h.id
    }
  }
  if (best !== -1 && bestDist < reach * MAX_JUMP_FRACTION) return best

  // Genuinely new. Prefer the slot its handedness suggests.
  const want = side === 'right' ? 1 : 0
  if (!taken.has(want)) return want
  return want === 1 ? 0 : 1
}

/**
 * A running vote on which hand each slot is.
 *
 * The label is used for display and for the thumb geometry, so a single bad
 * frame renaming "LEFT" to "RIGHT" under the user's wrist is visible and
 * looks broken even when nothing else is wrong. A vote that decays makes the
 * label settle within a few frames and then stay put.
 */
const sideVote = new Map<number, number>()

function votedSide(id: number, saw: Side): Side {
  const prev = sideVote.get(id) ?? 0
  // Clamped so a long run of one label cannot make the other take a second to
  // win once the hand genuinely changes.
  const next = Math.max(-6, Math.min(6, prev + (saw === 'right' ? 1 : -1)))
  sideVote.set(id, next)
  return next >= 0 ? 'right' : 'left'
}

export type Hand = {
  /** Stable across frames: 0 is your left hand, 1 your right. See `slotFor`. */
  id: number
  /** Every joint, in viewport pixels, smoothed and mirrored. */
  points: { x: number; y: number }[]
  /** The pad's cursor in viewport px — moved by the hand, not at the fingertip. */
  x: number
  y: number
  /** Thumb and index are pinched: a press, a drag, or in scroll mode a scroll. */
  pinched: boolean
  pinchKind: PinchKind
  mode: PadMode
  cursor: CursorState
  /** 0..1, a thumb+middle pinch closing on a right click. */
  rightProgress: number
  /** The latest click-like event, for the overlay to flash. */
  flash: { kind: 'click' | 'double' | 'right' | 'mode'; at: number } | null
  /** 0..1, how closed the pinch is. Drives the reticle's tightening ring. */
  closeness: number
  gesture: Gesture
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean }
  handedness: Side
  /** Rough hand size in pixels, so the renderer can scale line weight to it. */
  span: number
}

/**
 * Live hands, mutated in place.
 *
 * Deliberately not React state. This updates at camera rate and is consumed by
 * a canvas that redraws itself; routing it through the store would re-render
 * the entire HUD sixty times a second to move some lines. Same reasoning as the
 * scene's Drive object.
 */
export const hands: Hand[] = []

export const diag = {
  enabled: false,
  loading: false,
  ready: false,
  count: 0,
  fps: 0,
  gesture: '' as string,
  lastError: '',
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__hands = diag
}

let landmarker: HandLandmarker | null = null
let video: HTMLVideoElement | null = null
let running = false
/** Bumped on every enable, so a loop from a previous session stops itself. */
let generation = 0
let frames = 0
let fpsAt = 0
/** detectForVideo rejects a timestamp that does not advance, and performance.now()
 *  restarts its relationship with the model on every enable. Keep our own. */
let stamp = 0

/* ------------------------------------------------------------------ filters */

type Filters = {
  cursor: OneEuroPoint
  joints: OneEuroPoint[]
}

const filters = new Map<number, Filters>()

/** One trackpad per hand slot. Outlives the hand, so the cursor stays put while you reposition. */
const pads = new Map<number, Trackpad>()
/** When each slot last had a confident detection — see LOST_GRACE_MS. */
const lastSeenAt = new Map<number, number>()
/** When each hand was last pinching, so an open hand that has just let go of a drag is not read as a scroll. */
const lastPinchAt = new Map<number, number>()

function padFor(id: number, w: number, h: number): Trackpad {
  let p = pads.get(id)
  if (!p) {
    p = new Trackpad(w, h)
    pads.set(id, p)
  }
  return p
}

function confident(marks: { x: number; y: number }[], score: number | undefined): boolean {
  if (score !== undefined && score < MIN_HAND_SCORE) return false
  for (const k of [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, INDEX_MCP, INDEX_PIP]) {
    const m = marks[k]
    if (m.x < FRAME_EDGE || m.x > 1 - FRAME_EDGE || m.y < FRAME_EDGE || m.y > 1 - FRAME_EDGE) return false
  }
  return true
}

function filtersFor(id: number): Filters {
  let f = filters.get(id)
  if (!f) {
    f = {
      cursor: new OneEuroPoint(CURSOR_MIN_CUTOFF, CURSOR_BETA),
      joints: Array.from({ length: 21 }, () => new OneEuroPoint(SKELETON_MIN_CUTOFF, SKELETON_BETA)),
    }
    filters.set(id, f)
  }
  return f
}

/* ---------------------------------------------------------------- synthetics */

/**
 * setPointerCapture, made safe for pointers that do not exist.
 *
 * A synthetic PointerEvent carries a pointerId the browser has never issued, so
 * any element that calls setPointerCapture with it throws NotFoundError and the
 * interaction dies at the first move. That call is made by framer-motion's drag
 * and by our own resize grip — both of which we very much want a hand to be
 * able to use — and neither is somewhere we can add a try/catch.
 *
 * Capture is an optimisation, not a requirement: it exists so a drag keeps
 * receiving events after the cursor leaves the element. Our events are aimed by
 * hit-testing every frame and routed to the element that took the press, so
 * they land correctly whether or not capture was granted.
 */
let patched = false
function patchPointerCapture() {
  if (patched || typeof Element === 'undefined') return
  patched = true
  const capture = Element.prototype.setPointerCapture
  const release = Element.prototype.releasePointerCapture
  Element.prototype.setPointerCapture = function (id: number) {
    try {
      return capture.call(this, id)
    } catch {
      /* a synthetic pointer; hit-testing covers what capture would have */
    }
  }
  Element.prototype.releasePointerCapture = function (id: number) {
    try {
      return release.call(this, id)
    } catch {
      /* as above */
    }
  }
}

type Press = {
  /** What took the press, so the release and any click agree on their target. */
  captured: Element | null
  /** What a scroll is applied to, latched at the pinch so it cannot wander. */
  scrollEl: Element | null
  /** A pointerdown has been sent and not yet closed. */
  down: boolean
}

const presses = new Map<number, Press>()

function fire(el: Element | null, type: string, h: Hand, pressed: boolean) {
  if (!el) return
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: h.x,
      clientY: h.y,
      // Well clear of any id the browser might issue for a real pointer.
      pointerId: 9000 + h.id,
      pointerType: 'touch',
      isPrimary: h.id === 0,
      button: 0,
      buttons: pressed ? 1 : 0,
      width: 1,
      height: 1,
      pressure: pressed ? 0.5 : 0,
    }),
  )
}

function mouse(el: Element, type: string, h: Hand, init: MouseEventInit = {}) {
  return el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: h.x, clientY: h.y, ...init }),
  )
}

/** Bare background: the 3D scene or the page itself, nothing a click could mean. */
function isEmptyArea(el: Element | null): boolean {
  return !el || el.tagName === 'CANVAS' || el === document.body || el === document.documentElement || el.id === 'root'
}

function scrollableAncestor(el: Element | null): Element | null {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n)
    if (/(auto|scroll|overlay)/.test(s.overflowY + s.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return n
  }
  return document.scrollingElement
}

/**
 * Scroll by (dx, dy) px, positive meaning down/right.
 *
 * A synthetic wheel event does not scroll anything on its own, so it is offered
 * to the page first (anything that handles wheels can claim it) and otherwise
 * applied by hand: to a blade's article through the same message the blade's
 * own palm scroll uses, else to the nearest scrollable ancestor. Never sent to
 * the 3D scene, which would read a wheel as a zoom — zoom has its own twist.
 */
function scrollAt(el: Element | null, h: Hand, dx: number, dy: number) {
  if (!el || el.tagName === 'CANVAS') return
  if (!mouseWheel(el, h, { deltaX: dx, deltaY: dy })) return
  const frame = el instanceof HTMLIFrameElement ? el : (el.closest('.bl-slot')?.querySelector('iframe') ?? null)
  if (frame?.contentWindow) {
    frame.contentWindow.postMessage({ jarvis: 'scroll', dy }, '*')
    return
  }
  scrollableAncestor(el)?.scrollBy(dx, dy)
}

function mouseWheel(el: Element, h: Hand, init: WheelEventInit) {
  return el.dispatchEvent(
    new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: h.x, clientY: h.y, deltaMode: 0, ...init }),
  )
}

/** Zoom as a ctrl+wheel, the convention for pinch-zoom; the 3D scene's orbit controls read it. */
function zoomAt(el: Element | null, h: Hand, amount: number) {
  if (el) mouseWheel(el, h, { deltaY: -amount, ctrlKey: true })
}

function emit(h: Hand, out: TpOut, pad: Trackpad, now: number) {
  let p = presses.get(h.id)
  if (!p) {
    p = { captured: null, scrollEl: null, down: false }
    presses.set(h.id, p)
  }
  const over = document.elementFromPoint(h.x, h.y)
  let sent = false

  for (const ev of out.events) {
    if (ev.t === 'down') {
      sent = true
      if (out.mode === 'scroll') {
        p.scrollEl = over
        continue
      }
      // The cursor is held still from the first closing of the fingers, so the
      // press lands exactly where the cursor was drawn.
      p.captured = over
      p.down = true
      fire(over, 'pointerdown', h, true)
    } else if (ev.t === 'up') {
      sent = true
      const target = p.captured ?? over
      if (p.down) fire(target, 'pointerup', h, false)
      p.captured = null
      p.down = false
      p.scrollEl = null
      if (ev.dragged || !ev.clicks) continue
      // A second quick pinch on bare background (or in scroll mode, anywhere)
      // flips the mode instead of double-clicking nothing.
      if (ev.clicks === 2 && (out.mode === 'scroll' || isEmptyArea(over))) {
        h.mode = pad.toggleMode(now)
        h.flash = { kind: 'mode', at: now }
        continue
      }
      if (out.mode === 'scroll' || !target || target !== over) continue
      mouse(target, 'click', h, { detail: ev.clicks })
      if (ev.clicks === 2) mouse(target, 'dblclick', h, { detail: 2 })
      h.flash = { kind: ev.clicks === 2 ? 'double' : 'click', at: now }
    } else if (ev.t === 'right') {
      // Mouse events only: a touch pointerdown on a blade would grab it.
      if (over) {
        mouse(over, 'mousedown', h, { button: 2, buttons: 2 })
        mouse(over, 'mouseup', h, { button: 2 })
        mouse(over, 'contextmenu', h, { button: 2 })
      }
      h.flash = { kind: 'right', at: now }
    } else {
      h.mode = ev.mode
      h.flash = { kind: 'mode', at: now }
    }
  }

  if (out.scrollX || out.scrollY) scrollAt(p.scrollEl ?? over, h, -out.scrollX, -out.scrollY)
  if (out.zoom) zoomAt(over, h, out.zoom)

  // While pressed, moves go to whatever took the press, so a drag survives the
  // cursor sliding off the header it grabbed. Scroll mode sends no pointer moves
  // while pinched: it is not dragging anything.
  if (!sent && !(out.mode === 'scroll' && out.pinch === 'index')) {
    fire(p.down ? (p.captured ?? over) : over, 'pointermove', h, p.down)
  }
}

/** Let go of anything still held. A press that outlives its hand leaves
 *  whatever was being dragged stuck to a cursor that no longer exists. */
function releasePress(id: number, at: { x: number; y: number }) {
  const p = presses.get(id)
  if (!p) return
  p.scrollEl = null
  if (!p.down) return
  const ghost = { id, x: at.x, y: at.y } as Hand
  fire(p.captured, 'pointerup', ghost, false)
  fire(p.captured, 'pointercancel', ghost, false)
  p.down = false
  p.captured = null
}

/* ------------------------------------------------------------------ geometry */

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Is this finger extended?
 *
 * Compared as distance from the wrist rather than by which landmark is higher
 * on screen. The y-comparison is the common recipe and it is wrong the moment
 * the hand is not upright: turn your hand sideways and every finger reads as
 * curled. Distance from the wrist is rotation-invariant, which is the property
 * the question actually needs.
 */
function isExtended(
  marks: { x: number; y: number }[],
  tip: number,
  pip: number,
): boolean {
  const wrist = marks[WRIST]
  return dist(marks[tip], wrist) > dist(marks[pip], wrist) * EXTEND_RATIO
}

/**
 * Only report a finger pose once it has held.
 *
 * Fingers pass through other shapes on the way to the one you meant: a fist
 * opening into a point spends several frames looking like a pinch, and a hand
 * relaxing looks briefly like every gesture in the list. Acting on those
 * intermediate readings is exactly what makes gesture interfaces feel
 * possessed, so a pose has to survive GESTURE_HOLD_MS before it is believed.
 *
 * A pinch is deliberately exempt. It already carries its own hysteresis, and
 * it is the one gesture where the delay would be felt directly — as a press
 * that lands late.
 */
const settling = new Map<number, { raw: Gesture; since: number; held: Gesture }>()

function stableGesture(id: number, raw: Gesture, now: number): Gesture {
  if (raw === 'pinch') {
    settling.set(id, { raw, since: now, held: raw })
    return raw
  }
  const s = settling.get(id)
  if (!s || s.raw !== raw) {
    settling.set(id, { raw, since: now, held: s?.held === 'pinch' ? 'none' : (s?.held ?? 'none') })
    return settling.get(id)!.held
  }
  if (now - s.since >= GESTURE_HOLD_MS) s.held = raw
  return s.held
}

function classify(
  fingers: Hand['fingers'],
  pinched: boolean,
): Gesture {
  if (pinched) return 'pinch'
  const { thumb, index, middle, ring, pinky } = fingers
  const up = [thumb, index, middle, ring, pinky].filter(Boolean).length
  if (index && middle && !ring && !pinky) return 'peace'
  /**
   * The framing pose — index up, thumb out, the rest curled. The corner of a
   * rectangle, the shape people already make when they mime framing a shot.
   *
   * Tested before `point`, and it has to be: a framing hand also has exactly
   * one finger extended, so the point rule would swallow it. The thumb is the
   * whole difference between "I am aiming at that" and "I am sizing this".
   */
  if (thumb && index && !middle && !ring && !pinky) return 'frame'
  if (index && !middle && !ring && !pinky) return 'point'
  if (up >= 4) return 'open'
  if (up === 0) return 'fist'
  return 'none'
}

/* -------------------------------------------------------------------- camera */

async function ensureModel() {
  if (landmarker) return landmarker
  diag.loading = true
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.55,
    })
    diag.ready = true
    return landmarker
  } catch (err) {
    // A machine with no working GPU delegate should still get hands rather than
    // an error — the CPU path is slower but perfectly usable at this frame size.
    diag.lastError = `GPU delegate failed (${(err as Error)?.message ?? err}); retrying on CPU`
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    diag.ready = true
    return landmarker
  } finally {
    diag.loading = false
  }
}

function dropHand(i: number) {
  const at = hands.findIndex((h) => h.id === i)
  if (at === -1) return
  releasePress(i, hands[at])
  hands.splice(at, 1)
  filters.get(i)?.cursor.reset()
  filters.get(i)?.joints.forEach((f) => f.reset())
  settling.delete(i)
  sideVote.delete(i)
  pads.get(i)?.lost()
  lastPinchAt.delete(i)
}

/**
 * The tracking loop.
 *
 * Driven by requestVideoFrameCallback where it exists: rAF runs on the
 * display's clock and will happily hand the same camera frame to the model
 * several times, burning GPU on work whose answer cannot have changed. Falls
 * back to rAF on browsers that lack it, where the only cost is some wasted
 * inference.
 */
function loop(mine: number) {
  if (!running || mine !== generation || !video || !landmarker) return

  const now = performance.now()
  // Strictly increasing, and independent of performance.now(): the model
  // rejects a timestamp that does not advance, and enable/disable cycles would
  // otherwise hand it the same clock twice.
  stamp += 1

  let result
  try {
    result = landmarker.detectForVideo(video, stamp)
  } catch (err) {
    diag.lastError = String((err as Error)?.message ?? err)
    result = null
  }

  const w = window.innerWidth
  const h = window.innerHeight
  const found = result?.landmarks ?? []
  const labels = result?.handedness ?? []
  diag.count = found.length
  const at = now / 1000

  const seen = new Set<number>()

  for (let k = 0; k < found.length && k < 2; k++) {
    const marks = found[k]
    if (!marks || marks.length < 21) continue
    if (!confident(marks, labels[k]?.[0]?.score)) continue

    /**
     * Which hand this is.
     *
     * This was inverted, and the inversion was reasoned rather than observed —
     * from the note in MediaPipe's older Hands docs saying handedness is
     * determined assuming a mirrored selfie image, and to swap it if your input
     * is not mirrored. We feed the raw camera frame, so on paper a swap was
     * correct. On this build of the Tasks API it is not: the label already
     * describes the actual hand, and swapping it named every hand wrongly.
     *
     * Taken at face value now, because that is what the screen showed. Kept as
     * one named constant rather than folded into the expression so that if it
     * ever needs flipping again — a different build, a genuinely mirrored
     * input — it is one line and one word, not an archaeology exercise.
     */
    const raw = labels[k]?.[0]?.categoryName ?? ''
    const named: Side = raw === 'Right' ? 'right' : 'left'
    const side: Side = SWAP_HANDEDNESS ? (named === 'right' ? 'left' : 'right') : named

    /**
     * Identity has to come from the hand, not from its position in the array.
     *
     * MediaPipe makes no promise about ordering between frames, so keying on
     * the array index means the two hands can silently swap — cursors trade
     * places, a drag in progress jumps to the other hand, and the filters that
     * smooth each hand start smoothing the other one. Keying on handedness
     * makes your left hand slot 0 for as long as it is your left hand.
     */
    const wristPx = { x: (1 - marks[WRIST].x) * w, y: marks[WRIST].y * h }
    const reach = Math.hypot(w, h)
    const i = slotFor(side, wristPx, seen, reach)
    seen.add(i)
    lastSeenAt.set(i, now)

    const f = filtersFor(i)

    // Mirrored, because the camera faces you: moving your hand right should
    // move the cursor right, not left.
    const points = marks.map((m, j) =>
      f.joints[j].filter((1 - m.x) * w, m.y * h, at),
    )

    const span = dist(points[WRIST], points[MIDDLE_MCP]) || 1
    const gapIndex = dist(points[THUMB_TIP], points[INDEX_TIP]) / span
    const gapMiddle = dist(points[THUMB_TIP], points[MIDDLE_TIP]) / span

    const pad = padFor(i, w, h)
    let hand = hands.find((q) => q.id === i)
    if (!hand) {
      hand = {
        id: i, points, x: pad.x, y: pad.y,
        pinched: false, pinchKind: 'none', mode: pad.mode, cursor: 'moving', rightProgress: 0, flash: null,
        closeness: 0, gesture: 'none',
        fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
        handedness: side, span,  // replaced by the vote below on the same frame
      }
      hands.push(hand)
    }
    hand.points = points
    hand.span = span

    hand.fingers = {
      // The thumb never straightens the way the fingers do, so it is measured
      // against its own base joint rather than by the same ratio.
      thumb: dist(points[THUMB_TIP], points[WRIST]) > dist(points[THUMB_MCP], points[WRIST]) * 1.35
        || dist(points[THUMB_TIP], points[INDEX_PIP]) > span * 1.1,
      index: isExtended(points, INDEX_TIP, INDEX_PIP),
      middle: isExtended(points, MIDDLE_TIP, MIDDLE_PIP),
      ring: isExtended(points, RING_TIP, RING_PIP),
      pinky: isExtended(points, PINKY_TIP, PINKY_PIP),
    }

    /**
     * What drives the cursor: the middle of the index finger's base, not its tip.
     *
     * Only the movement of this point is used, so it never has to sit under the
     * finger. It is chosen because it barely moves when the fingers close —
     * a tip moves several centimetres on its way to the thumb, which is what
     * made the old absolute cursor slide off its target while pressing it. The
     * 1€ filter runs on the raw point; the skeleton's own smoothing on top of
     * that would only add lag.
     */
    const anchor = f.cursor.filter(
      (1 - (marks[INDEX_MCP].x + marks[INDEX_PIP].x) / 2) * w,
      ((marks[INDEX_MCP].y + marks[INDEX_PIP].y) / 2) * h,
      at,
    )
    const spread = hand.cursor === 'clutch' ? OPEN_GAP_OFF : OPEN_GAP_ON
    const open = classify(hand.fingers, false) === 'open' && gapIndex > spread

    /**
     * Hysteresis, confirmation, settling and the trackpad rules all live in the
     * pad; this is only the measurement going in and the decisions coming out.
     */
    const out = pad.step({
      now, ax: anchor.x, ay: anchor.y, span, gapIndex, gapMiddle, open,
      roll: Math.atan2(points[MIDDLE_MCP].y - points[WRIST].y, points[MIDDLE_MCP].x - points[WRIST].x),
      vw: w, vh: h,
    })
    hand.x = out.x
    hand.y = out.y
    hand.pinchKind = out.pinch
    hand.pinched = out.pinch === 'index'
    hand.mode = out.mode
    hand.cursor = out.state
    hand.rightProgress = out.rightProgress
    hand.closeness = Math.max(0, Math.min(1, 1 - (gapIndex - PINCH_ON) / (PINCH_OFF - PINCH_ON)))
    if (hand.pinched) lastPinchAt.set(i, now)

    const wasGesture = hand.gesture
    hand.gesture = stableGesture(i, classify(hand.fingers, hand.pinched), now)
    // A change of pose starts the settling window. Pinch is not counted: it is
    // the thing being protected, not a transition to recover from.
    if (hand.gesture !== wasGesture && hand.gesture !== 'pinch' && wasGesture !== 'pinch') {
      pad.noteTransition(now)
    }
    hand.handedness = votedSide(i, side)

    emit(hand, out, pad, now)
  }

  // Anything not seen this frame has left the picture.
  // A frame that fails the gate is not the end of a hand: it has to stay gone
  // for LOST_GRACE_MS before whatever it was holding is let go.
  for (const id of [0, 1]) {
    if (!seen.has(id) && now - (lastSeenAt.get(id) ?? 0) > LOST_GRACE_MS) dropHand(id)
  }

  diag.gesture = hands
    .map((q) => `${q.handedness === 'right' ? 'R' : 'L'}:${q.gesture}`)
    .join(' + ')

  frames++
  if (now - fpsAt > 1000) {
    diag.fps = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }

  schedule(mine)
}

function schedule(mine: number) {
  if (!video) return
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => loop(mine))
  } else {
    requestAnimationFrame(() => loop(mine))
  }
}

/** Turn the camera on and start tracking. Safe to call twice. */
export async function enableHands(): Promise<void> {
  if (running) return
  patchPointerCapture()
  const mine = ++generation
  try {
    /**
     * One shared camera, refcounted — see camera.ts.
     *
     * This used to open its own stream. A second getUserMedia makes Chrome drop
     * the first, so hand tracking and the camera blade could not both exist:
     * whichever started last blinded the other, and the symptom appeared in the
     * feature that had done nothing wrong.
     */
    const stream = await holdCamera()
    // Switched off while the camera or model was still starting: give the hold
    // straight back instead of leaving a camera on that nothing is using.
    if (mine !== generation) {
      releaseCamera()
      return
    }
    video = stream
    await ensureModel()
    if (mine !== generation) return

    running = true
    diag.enabled = true
    fpsAt = performance.now()
    schedule(mine)
  } catch (err) {
    diag.lastError = String((err as Error)?.message ?? err)
    disableHands()
    throw err
  }
}

/** Camera off, tracking stopped, anything held released. */
export function disableHands(): void {
  running = false
  generation++
  diag.enabled = false
  diag.count = 0
  diag.fps = 0
  diag.gesture = ''
  for (const h of hands) releasePress(h.id, h)
  hands.length = 0
  presses.clear()
  filters.clear()
  settling.clear()
  sideVote.clear()
  pads.clear()
  lastSeenAt.clear()
  lastPinchAt.clear()
  palmFrom = null
  // Give the hold back rather than tearing the stream down: the camera blade
  // may still be showing it, and stopping the tracks would blank it.
  if (video) {
    video = null
    releaseCamera()
  }
}

/**
 * Both hands framing, and how big the box between them is.
 *
 * The gesture is the one people already make to mime a rectangle: index up,
 * thumb out, two corners held apart. Pulling them apart makes the box bigger;
 * bringing them together makes it smaller.
 *
 * Depth comes free. Moving both hands toward the camera makes everything about
 * them larger in the image, including the distance between them, so leaning in
 * grows the box and leaning back shrinks it — without a single line about z,
 * which is the noisiest number MediaPipe reports.
 *
 * The corner is measured at the crook between thumb and index rather than at
 * the index tip, because that is where the corner of the imagined rectangle
 * actually is, and it is the point that stays still while the fingers spread.
 *
 * Published as a plain distance. This file does not know what is on screen and
 * has no business deciding that a bigger box means a bigger blade.
 */
/**
 * How many hands are currently pinching.
 *
 * A single pinch is a grab. Two at once is not two grabs — it is somebody doing
 * something with both hands, and whatever that is, it is not "drag this blade
 * to two places at once". Consumers use this to stand down rather than fight
 * each other for the same object.
 */
export function pinchCount(): number {
  return hands.filter((h) => h.pinched).length
}

export function frameSpan(): number | null {
  const framing = hands.filter((h) => h.gesture === 'frame')
  if (framing.length < 2) return null
  const [a, b] = framing
  const corner = (h: Hand) => ({
    x: (h.points[THUMB_TIP].x + h.points[INDEX_TIP].x) / 2,
    y: (h.points[THUMB_TIP].y + h.points[INDEX_TIP].y) / 2,
  })
  const ca = corner(a)
  const cb = corner(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

/**
 * Two fingers up, moved vertically — how far, since the pose began.
 *
 * Scrolling needed its own gesture once pinch became "grab this blade". A pinch
 * cannot mean both grab and scroll, and grabbing is what people reach for
 * first: they see a thing and try to pick it up. So scrolling gets the pose
 * that is deliberate and hard to make by accident.
 *
 * Returns pixels travelled since the two fingers went up, or null when nobody
 * is holding the pose. Published as a distance rather than as a scroll for the
 * same reason as twoHandSpan — this file does not know what is on screen.
 */
let peaceFrom: { id: number; y: number } | null = null

export function peaceScroll(): number | null {
  const hand = hands.find((h) => h.gesture === 'peace')
  if (!hand) {
    peaceFrom = null
    return null
  }
  if (!peaceFrom || peaceFrom.id !== hand.id) {
    peaceFrom = { id: hand.id, y: hand.y }
    return 0
  }
  return hand.y - peaceFrom.y
}

/** Vertical wobble of a resting palm that must not scroll, in pixels. */
const PALM_DEAD_BAND = 14
/** After letting go of a pinch, an open hand is not a scroll for this long. */
const PALM_AFTER_PINCH_MS = 600

let palmFrom: { id: number; y: number; anchor: number } | null = null

/**
 * An open palm moved up or down — how far the anchor has been dragged.
 *
 * Only counts while the palm is inside `inside` (the front blade's box), so a
 * hand held open elsewhere on screen never scrolls anything, and not just after
 * releasing a drag. The anchor trails the palm by a dead band: jitter inside
 * the band gives nothing, and movement past it carries the anchor along, so a
 * long scroll is not limited by how far the hand can travel.
 *
 * Returns null when nobody is holding the pose over the box, like peaceScroll.
 */
export function palmScroll(inside: DOMRect | null): number | null {
  const now = performance.now()
  const hand = hands.find(
    (h) =>
      h.gesture === 'open' &&
      !h.pinched &&
      now - (lastPinchAt.get(h.id) ?? -Infinity) > PALM_AFTER_PINCH_MS &&
      h.points.length >= 21,
  )
  if (!hand || !inside) {
    palmFrom = null
    return null
  }
  // Centre of the palm: wrist plus the four knuckles, steadier than any fingertip.
  const ys = [0, 5, 9, 13, 17].map((k) => hand.points[k])
  const cx = ys.reduce((a, p) => a + p.x, 0) / ys.length
  const cy = ys.reduce((a, p) => a + p.y, 0) / ys.length
  if (cx < inside.left || cx > inside.right || cy < inside.top || cy > inside.bottom) {
    palmFrom = null
    return null
  }
  if (!palmFrom || palmFrom.id !== hand.id) {
    palmFrom = { id: hand.id, y: cy, anchor: cy }
    return 0
  }
  const off = cy - palmFrom.anchor
  if (off > PALM_DEAD_BAND) palmFrom.anchor = cy - PALM_DEAD_BAND
  else if (off < -PALM_DEAD_BAND) palmFrom.anchor = cy + PALM_DEAD_BAND
  return palmFrom.anchor - palmFrom.y
}

/** Scroll mode on any hand, for the indicator. */
export const padMode = (): PadMode => ([...pads.values()].some((p) => p.mode === 'scroll') ? 'scroll' : 'move')

export const handsRunning = () => running
