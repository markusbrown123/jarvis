import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { micLevel } from '../lib/audio'
import { inputState, useTick } from './state'

/**
 * The voice visualizer: a mirrored waveform that grows from the centre out,
 * with the state word under it and the pill that does the obvious thing —
 * like the listening screen in the reference.
 *
 * It only draws what is real: the microphone level while listening, his
 * actual output level while speaking, a slow travelling shimmer while he is
 * thinking, and a flat breathing line on standby.
 */

const TONE: Record<string, [string, string]> = {
  live: ['#ffb067', '#ff7a1a'],
  held: ['#ffcf8a', '#f5a524'],
  speak: ['#a5f3e8', '#2dd4bf'],
  busy: ['#d8ccff', '#8b5cf6'],
  idle: ['#b9a8f5', '#6d4fd6'],
  off: ['#5d5873', '#3b3650'],
  fail: ['#fca5a5', '#ef4444'],
}

function Wave({ width, height, bars }: { width: number; height: number; bars: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = width * dpr
    cv.height = height * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    const half = Math.ceil(bars / 2)
    // Newest level enters at the centre and travels outward on both sides.
    const hist = new Array(half).fill(0)
    const shown = new Array(half).fill(0)
    let raf = 0
    let t = 0
    let last = performance.now()
    const step = (width - 8) / bars
    const barW = Math.max(1.6, step * 0.42)
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      const { phase, level } = useStore.getState()
      const tone = inputState().tone
      const live = phase === 'listening' || phase === 'waking'
      const thinking = phase === 'thinking' || phase === 'tooling'
      const raw = phase === 'speaking' ? level : live ? micLevel() : 0
      hist.unshift(Math.min(1, raw * 2.1))
      hist.length = half
      g.clearRect(0, 0, width, height)
      const [hi, lo] = TONE[tone] ?? TONE.idle
      const grad = g.createLinearGradient(0, 0, width, 0)
      grad.addColorStop(0, lo + '00')
      grad.addColorStop(0.22, lo)
      grad.addColorStop(0.5, hi)
      grad.addColorStop(0.78, lo)
      grad.addColorStop(1, lo + '00')
      g.fillStyle = grad
      g.shadowColor = hi
      g.shadowBlur = live || phase === 'speaking' ? 10 : 4
      const mid = height / 2
      for (let i = 0; i < half; i++) {
        const x = i / half
        // A bell envelope: tallest in the middle, tapering to the edges.
        const env = Math.exp(-x * x * 2.6)
        let target: number
        if (live || phase === 'speaking') target = 0.06 + hist[i] * env * 0.94
        else if (thinking) target = 0.08 + 0.22 * env * (0.5 + 0.5 * Math.sin(t * 5 - i * 0.45))
        else target = 0.045 + 0.025 * env * (0.5 + 0.5 * Math.sin(t * 1.4))
        shown[i] += (target - shown[i]) * Math.min(1, dt * 18)
        const h = Math.max(barW, shown[i] * (height - 4))
        for (const side of [-1, 1]) {
          if (side === 1 && i === 0) continue
          const cx = width / 2 + side * i * step
          g.beginPath()
          g.roundRect(cx - barW / 2, mid - h / 2, barW, h, barW / 2)
          g.fill()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [width, height, bars])
  return <canvas ref={ref} className="vw-canvas" style={{ width, height }} aria-hidden />
}

function stateWord(label: string) {
  return label.replace(/ — say .*$/, '').toUpperCase()
}

/** The bar's centrepiece, or the large one under the core in the voice view. */
export function VoiceWave({ size = 'bar' }: { size?: 'bar' | 'large' }) {
  useTick(400)
  const phase = useStore((s) => s.phase)
  const talkMode = useStore((s) => s.talkMode)
  const c = useStore((s) => s.controls)
  const st = inputState()
  const live = phase === 'listening' || phase === 'waking'
  const pill = live
    ? { text: 'LIVE · TAP TO FINISH', run: c.finishSpeaking }
    : phase === 'speaking'
      ? { text: 'TAP TO INTERRUPT', run: c.stopTalking }
      : phase === 'thinking' || phase === 'tooling'
        ? { text: 'TAP TO CANCEL', run: c.cancelReply }
        : phase === 'offline'
          ? null
          : { text: talkMode === 'auto' ? 'SAY “HEY JARVIS” · OR TAP' : 'TAP TO TALK', run: c.startTalking }
  const large = size === 'large'
  return (
    <div className={`vw vw-${size} state-${st.tone}`}>
      {large && pill && (
        <button className="vw-pill" onClick={pill.run}>
          <span className="vw-dot" />
          {pill.text}
        </button>
      )}
      <Wave width={large ? 520 : 300} height={large ? 64 : 34} bars={large ? 63 : 41} />
      <div className="vw-word" aria-live="polite">
        {stateWord(st.label)}
      </div>
    </div>
  )
}
