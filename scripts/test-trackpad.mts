// Exercises the trackpad state machine with synthetic hand measurements.
// Run: npx tsx scripts/test-trackpad.mts
import { Trackpad, type TpEvent, type TpInput } from '../src/lib/trackpad.ts'

const VW = 1440
const VH = 900
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** Deterministic noise, so a failure reproduces. */
let seed = 7
const noise = (amp: number) => {
  seed = (seed * 16807) % 2147483647
  return ((seed / 2147483647) * 2 - 1) * amp
}

/** A simulated hand at 30 fps. */
class Rig {
  pad = new Trackpad(VW, VH)
  now = 1000
  ax = 700
  ay = 450
  gapIndex = 1.0
  gapMiddle = 1.1
  open = false
  roll = 0
  events: TpEvent[] = []
  last = this.pad.step(this.input())

  input(): TpInput {
    return {
      now: this.now, ax: this.ax, ay: this.ay, span: 160,
      gapIndex: this.gapIndex, gapMiddle: this.gapMiddle,
      open: this.open, roll: this.roll, vw: VW, vh: VH,
    }
  }
  /** Advance by n frames, calling shape() each frame to move the hand. */
  run(frames: number, shape?: (k: number) => void) {
    for (let k = 0; k < frames; k++) {
      this.now += 33
      shape?.(k)
      this.last = this.pad.step(this.input())
      this.events.push(...this.last.events)
    }
  }
  take(): TpEvent[] {
    const e = this.events
    this.events = []
    return e
  }
}
const kinds = (e: TpEvent[]) => e.map((x) => (x.t === 'up' ? `up${x.clicks}${x.dragged ? 'd' : ''}` : x.t)).join(',')
const warm = (r: Rig) => r.run(15) // past the re-engage settle window

// 1. a resting hand with landmark jitter does not move the cursor ------------
{
  const r = new Rig()
  warm(r)
  const x0 = r.last.x
  const y0 = r.last.y
  r.run(90, () => {
    r.ax = 700 + noise(0.3)
    r.ay = 450 + noise(0.3)
    r.gapIndex = 1.0 + noise(0.05)
  })
  const drift = Math.hypot(r.last.x - x0, r.last.y - y0)
  check('rest jitter produces no cursor drift', drift < 2, `drift ${drift.toFixed(2)}px over 3s`)
}

// 2. relative movement, with acceleration ------------------------------------
{
  const r = new Rig()
  warm(r)
  const x0 = r.last.x
  r.run(30, () => (r.ax += 1.5)) // slow: 45 px/s of hand
  const slow = r.last.x - x0
  const x1 = r.last.x
  r.run(10, () => (r.ax += 30)) // fast: 900 px/s of hand
  const fast = r.last.x - x1
  check('slow movement tracks about 1:1 (precision)', slow > 28 && slow < 65, `hand 45px -> cursor ${slow.toFixed(1)}px`)
  check('fast movement is amplified (reach)', fast / 300 > 1.4, `hand 300px -> cursor ${fast.toFixed(1)}px`)
}

// 3. clutch: an open palm stops the cursor, and re-engaging does not jump ----
{
  const r = new Rig()
  warm(r)
  r.run(10, () => (r.ax += 5))
  r.open = true
  r.run(6)
  const stop = r.last.x
  r.run(30, () => (r.ax -= 12)) // sweep the hand back across the camera while open
  check('open palm clutches (cursor frozen while repositioning)', r.last.x === stop && r.last.state === 'clutch', `x ${stop.toFixed(1)} -> ${r.last.x.toFixed(1)}`)
  r.open = false
  r.run(20)
  check('re-engaging does not jump the cursor', Math.abs(r.last.x - stop) < 3, `jump ${Math.abs(r.last.x - stop).toFixed(1)}px`)
}

// 4. left click: a tap, with the fingers moving while they close -------------
{
  const r = new Rig()
  warm(r)
  r.take()
  const x0 = r.last.x
  const y0 = r.last.y
  for (let k = 0; k < 4; k++) {
    r.gapIndex = [0.7, 0.45, 0.25, 0.2][k]
    r.ax = 700 + noise(0.3) // a hand held still while the fingers close
    r.run(1)
  }
  r.run(3)
  r.gapIndex = 0.8
  r.run(4)
  check('a tap is down then a single click', kinds(r.take()) === 'down,up1', '')
  check('cursor does not slide during a click', Math.hypot(r.last.x - x0, r.last.y - y0) < 1, `moved ${Math.hypot(r.last.x - x0, r.last.y - y0).toFixed(2)}px`)
}

// 5. hysteresis: a pinch that wobbles around the threshold never flickers ----
{
  const r = new Rig()
  warm(r)
  r.take()
  r.gapIndex = 0.3
  r.run(5) // pressed
  r.run(60, () => (r.gapIndex = 0.5 + noise(0.07))) // wobbles between 0.43 and 0.57: inside the dead band
  const held = kinds(r.take())
  check('wobble inside the hysteresis band stays pressed', held === 'down', `events: ${held}`)
  r.gapIndex = 0.8
  r.run(3)
  check('opening past the release threshold releases once', kinds(r.take()) === 'up1', '')
}

// 6. a one-frame pinch-shaped glitch is not a click --------------------------
{
  const r = new Rig()
  warm(r)
  r.take()
  r.gapIndex = 0.2
  r.run(1)
  r.gapIndex = 1.0
  r.run(10)
  check('a one-frame glitch is ignored (confirm window)', kinds(r.take()) === '', '')
}

// 7. drag: press, move, release ---------------------------------------------
{
  const r = new Rig()
  warm(r)
  r.take()
  r.gapIndex = 0.25
  r.run(5)
  const x0 = r.last.x
  r.run(5)
  check('cursor is held still while pressed and not yet dragging', r.last.x === x0, '')
  r.run(20, () => (r.ax += 6))
  check('moving while pinched drags', r.last.state === 'dragging' && r.last.x > x0 + 50, `x +${(r.last.x - x0).toFixed(0)}`)
  r.gapIndex = 0.9
  r.run(4)
  check('drag is down ... up with no click', kinds(r.take()) === 'down,up0d', '')
}

// 8. double click ------------------------------------------------------------
{
  const r = new Rig()
  warm(r)
  r.take()
  const tapOnce = () => {
    r.gapIndex = 0.2
    r.run(5)
    r.gapIndex = 0.9
    r.run(3)
  }
  tapOnce()
  r.run(4)
  tapOnce()
  check('two quick taps report clicks 1 then 2', kinds(r.take()) === 'down,up1,down,up2', '')
  r.run(25) // let the window pass
  tapOnce()
  const slow = kinds(r.take())
  check('a third tap after a pause starts over', slow === 'down,up1', slow)
}

// 9. right click (thumb to middle) vs index pinch ---------------------------
{
  const r = new Rig()
  warm(r)
  r.take()
  r.gapMiddle = 0.2
  r.gapIndex = 1.0
  r.run(2)
  const mid = r.last.rightProgress
  r.run(5)
  check('thumb+middle fires one right click, with a progress ring', kinds(r.take()) === 'right' && mid > 0 && mid < 1, `progress ${mid.toFixed(2)}`)
  r.run(20)
  check('holding thumb+middle does not repeat', kinds(r.take()) === '', '')
  r.gapMiddle = 1.1
  r.run(5)
  // A natural index pinch where the middle finger drifts close behind it.
  r.gapIndex = 0.2
  r.gapMiddle = 0.3
  r.run(6)
  check('index pinch with a nearby middle finger is still a left press', kinds(r.take()) === 'down', '')
  r.gapIndex = 0.9
  r.gapMiddle = 1.1
  r.run(4)
  r.take()
  // Index half-curled and middle touching: ambiguous, must do nothing.
  r.gapIndex = 0.5
  r.gapMiddle = 0.3
  r.run(10)
  check('ambiguous index+middle pinch does nothing', kinds(r.take()) === '', '')
}

// 10. scroll mode: toggled by the host, pinch-and-move scrolls, twist zooms --
{
  const r = new Rig()
  warm(r)
  r.pad.toggleMode(r.now)
  r.take()
  r.gapIndex = 0.25
  r.run(5)
  const cx = r.last.x
  r.run(20, () => (r.ay -= 5))
  const out = r.last
  check('scroll mode: pinch-move scrolls and the cursor stays put', out.state === 'scrolling' && out.x === cx && out.scrollY < 0, `scrollY ${out.scrollY.toFixed(1)}`)
  r.gapIndex = 0.9
  r.run(4)
  r.take()
  r.gapIndex = 0.25
  r.run(5)
  r.run(20, () => {
    r.roll += 0.04
  })
  const zoomed = r.last.zoom
  check('scroll mode: pinch-and-twist zooms and does not scroll', r.last.state === 'zooming' && zoomed !== 0 && r.last.scrollY === 0, `zoom ${zoomed.toFixed(1)}`)
  r.gapIndex = 0.9
  r.run(4)
  const e = kinds(r.take())
  check('scroll mode never reports a drag click', !e.includes('up1'), e)
  r.run(Math.ceil(12500 / 33))
  check('scroll mode times out back to move', r.last.mode === 'move', '')
}

// 11. lost hand: pinch is dropped, cursor and mode survive -------------------
{
  const r = new Rig()
  warm(r)
  r.run(10, () => (r.ax += 8))
  const x = r.last.x
  r.pad.lost()
  r.run(1)
  check('after losing the hand the cursor stays where it was', Math.abs(r.last.x - x) < 1, '')
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
