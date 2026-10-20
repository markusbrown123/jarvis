import { useEffect, useMemo, useState } from 'react'
import { useStore, type BootStage } from '../store'
import { useHub } from '../hub/client'
import { BRIDGE_HTTP_URL } from '../config'
import { openItems } from '../dash/state'
import { until } from '../hub/format'
import * as sfx from '../lib/sfx'
import './intro.css'

/**
 * The intro: JARVIS's cold start.
 *
 * A systems check runs the moment the window opens — every line is a real
 * reading (the bridge, his model, his voice, the microphone, the command
 * center, the phone link, the graphics card), and the dial's ring fills as
 * they come in. Then any of these brings him up: saying "Jarvis", any key, a
 * click, a double clap — or nothing at all, when auto-start is on and Chrome
 * lets the page make sound without a click. While he powers up, the same
 * screen shows the real steps, then fades into the station.
 *
 * A plain conditional, never an exit animation library: an invisible
 * full-screen layer left behind once swallowed every click and gesture (see
 * git history of Ignition). Leaving is a CSS fade with pointer-events off,
 * then unmount.
 */

type Status = 'pending' | 'ok' | 'warn' | 'off' | 'fail'
type Check = { id: string; label: string; status: Status; detail: string }
type Health = { ok: boolean; tts?: boolean; model?: string; effort?: string; writes?: boolean } | null

const STEPS: { id: BootStage; label: string }[] = [
  { id: 'audio', label: 'Sound' },
  { id: 'bridge', label: 'Brain link' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'voice', label: 'Voice loop' },
  { id: 'ready', label: 'Online' },
]

function gpuName(): { ok: boolean; name: string } {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return { ok: false, name: 'no WebGL 2' }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const raw = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'WebGL 2'
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    // "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" → "Apple M2"
    const m = raw.match(/Renderer: ([^,]+)/) ?? raw.match(/ANGLE \([^,]+, ([^,(]+)/)
    return { ok: true, name: (m?.[1] ?? raw).trim() }
  } catch {
    return { ok: false, name: 'unavailable' }
  }
}

function useChecks(): { checks: Check[]; ready: boolean; bridgeUp: boolean } {
  const [health, setHealth] = useState<Health | 'down' | null>(null)
  const [mic, setMic] = useState<{ state: string; name: string | null } | null>(null)
  const gpu = useMemo(gpuName, [])
  const link = useHub((s) => s.link)
  const hub = useHub((s) => s.state)
  const graphics = useHub((s) => s.prefs.graphics)

  useEffect(() => {
    let live = true
    const probe = async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP_URL}/health`, { signal: AbortSignal.timeout(2500) })
        if (live) setHealth(r.ok ? ((await r.json()) as Health) : 'down')
      } catch {
        if (live) setHealth('down')
      }
    }
    void probe()
    // Keep trying while it's down, so starting the bridge late just works.
    const t = setInterval(() => live && health === 'down' && void probe(), 3000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [health])

  useEffect(() => {
    void (async () => {
      let state = 'unknown'
      try {
        state = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
      } catch {
        /* older browsers: unknown */
      }
      let name: string | null = null
      if (state === 'granted') {
        const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => [])
        const ins = (devices ?? []).filter((d) => d.kind === 'audioinput' && d.label)
        name = (ins.find((d) => /macbook|built-in/i.test(d.label)) ?? ins[0])?.label.replace(/\s*\(.*\)$/, '') ?? null
      }
      setMic({ state, name })
    })()
  }, [])

  const h = health && health !== 'down' ? health : null
  const down = health === 'down'
  const projects = hub ? (['roblox', 'automaton', 'finance'] as const).filter((p) => hub.projects[p]).map((p) => p[0].toUpperCase() + p.slice(1)) : []
  const tg = hub?.phone?.telegram
  const checks: Check[] = [
    {
      id: 'bridge',
      label: 'Bridge',
      status: health === null ? 'pending' : down ? 'fail' : 'ok',
      detail: health === null ? 'connecting…' : down ? 'offline — type jarvis in Terminal' : 'online · localhost',
    },
    {
      id: 'brain',
      label: 'Brain',
      status: health === null ? 'pending' : h?.model ? 'ok' : 'off',
      detail: h?.model ? `${h.model}${h.effort ? ` · effort ${h.effort}` : ''} · ${h.writes ? 'write access on' : 'read-only'}` : down ? 'needs the bridge' : '…',
    },
    {
      id: 'voice',
      label: 'Voice',
      status: health === null ? 'pending' : h?.tts ? 'ok' : down ? 'off' : 'warn',
      detail: h ? (h.tts ? 'ElevenLabs · your voice' : 'browser voice — no ElevenLabs key') : down ? 'needs the bridge' : '…',
    },
    {
      id: 'mic',
      label: 'Microphone',
      status: !mic ? 'pending' : mic.state === 'granted' ? 'ok' : mic.state === 'denied' ? 'fail' : 'warn',
      detail: !mic ? '…' : mic.state === 'granted' ? (mic.name ?? 'allowed') : mic.state === 'denied' ? "blocked — allow it in Chrome's site settings" : 'Chrome will ask once',
    },
    {
      id: 'hub',
      label: 'Command center',
      status: link === 'live' ? 'ok' : link === 'down' ? 'fail' : 'pending',
      detail: link === 'live' ? (projects.length ? projects.join(' · ') : 'live') : link === 'down' ? 'not reachable' : 'connecting…',
    },
    {
      id: 'phone',
      label: 'Phone',
      status: !hub ? 'pending' : tg?.paired ? 'ok' : tg?.configured ? 'warn' : 'off',
      detail: !hub ? '…' : tg?.paired ? `paired · ${tg.chatName ?? 'Telegram'}` : tg?.configured ? 'bot ready — pair it in Settings' : 'not set up',
    },
    {
      id: 'gpu',
      label: 'Graphics',
      status: gpu.ok ? 'ok' : 'warn',
      detail: gpu.ok ? `${gpu.name} · ${graphics}` : `${gpu.name} — the station needs WebGL 2`,
    },
  ]
  const ready = checks.every((c) => c.status !== 'pending')
  return { checks, ready, bridgeUp: Boolean(h) }
}

/** The dial: tick ring, rotating segments, a progress arc that fills as checks land. */
function Dial({ progress, live }: { progress: number; live: boolean }) {
  const C = 2 * Math.PI * 172
  return (
    <svg className={`intro-dial ${live ? 'live' : ''}`} viewBox="0 0 400 400" aria-hidden>
      <defs>
        <radialGradient id="introCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f4f0ff" stopOpacity="0.95" />
          <stop offset="30%" stopColor="#b9a5ff" stopOpacity="0.75" />
          <stop offset="70%" stopColor="#5b3fd0" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#1a1030" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="d-spin-slow">
        {Array.from({ length: 120 }, (_, i) => {
          const a = (i / 120) * Math.PI * 2
          const long = i % 10 === 0
          const r0 = long ? 180 : 185
          return <line key={i} x1={200 + Math.cos(a) * r0} y1={200 + Math.sin(a) * r0} x2={200 + Math.cos(a) * 194} y2={200 + Math.sin(a) * 194} className={long ? 'd-tick-long' : 'd-tick'} />
        })}
      </g>
      <circle cx="200" cy="200" r="172" className="d-track" />
      <circle cx="200" cy="200" r="172" className="d-progress" strokeDasharray={`${C * progress} ${C}`} transform="rotate(-90 200 200)" />
      <g className="d-spin-rev">
        {Array.from({ length: 6 }, (_, i) => {
          const a0 = (i / 6) * Math.PI * 2
          const a1 = a0 + 0.62
          return <path key={i} d={`M ${200 + Math.cos(a0) * 150} ${200 + Math.sin(a0) * 150} A 150 150 0 0 1 ${200 + Math.cos(a1) * 150} ${200 + Math.sin(a1) * 150}`} className="d-seg" />
        })}
      </g>
      <circle cx="200" cy="200" r="128" className="d-dash d-spin-fast" />
      <polygon className="d-hex d-spin-rev" points={Array.from({ length: 6 }, (_, i) => `${200 + Math.cos((i / 6) * Math.PI * 2) * 104},${200 + Math.sin((i / 6) * Math.PI * 2) * 104}`).join(' ')} />
      <circle cx="200" cy="200" r="96" fill="url(#introCore)" className="d-core" />
    </svg>
  )
}

function Brief() {
  const s = useHub((x) => x.state)
  if (!s) return null
  const needs = openItems(s.items)
  const running = Object.values(s.jobs).filter((j) => j.state === 'running')
  const five = s.usage.windows.five_hour
  const fresh = five && (!five.resetsAt || five.resetsAt > Date.now())
  const spent = s.expenses?.month.total
  return (
    <aside className="intro-panel intro-brief">
      <h2>Briefing</h2>
      <div className="brief-row">
        <span className="brief-v">{needs.length}</span>
        <span className="brief-k">{needs.length === 1 ? 'thing needs you' : 'things need you'}</span>
      </div>
      {needs[0] && <p className="brief-sub">{needs[0].title}</p>}
      <div className="brief-row">
        <span className="brief-v">{running.length}</span>
        <span className="brief-k">running now</span>
      </div>
      {running[0] && <p className="brief-sub">{running[0].title}</p>}
      {spent !== undefined && (
        <div className="brief-row">
          <span className="brief-v">${spent.toFixed(0)}</span>
          <span className="brief-k">spent this month</span>
        </div>
      )}
      <div className="brief-row">
        <span className="brief-v">{fresh ? `${Math.round(100 - five!.usedPct)}%` : '—'}</span>
        <span className="brief-k">{fresh ? `Claude left · resets ${until(five!.resetsAt)}` : 'Claude allowance unavailable'}</span>
      </div>
    </aside>
  )
}

export function Intro({ onStart }: { onStart: () => void }) {
  const phase = useStore((s) => s.phase)
  const stage = useStore((s) => s.bootStage)
  const bootNote = useStore((s) => s.bootNote)
  const error = useStore((s) => s.error)
  const autoStart = useHub((s) => s.prefs.autoStart)
  const setPrefs = useHub((s) => s.setPrefs)
  const { checks, ready, bridgeUp } = useChecks()
  const [count, setCount] = useState<number | null>(null)
  const [held, setHeld] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const offline = phase === 'offline'
  const booting = phase === 'boot'

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Out once he's up; back if a power-up fails.
  useEffect(() => {
    if (offline || booting) {
      setLeaving(false)
      setGone(false)
      return
    }
    setLeaving(true)
    const t = setTimeout(() => setGone(true), 900)
    return () => clearTimeout(t)
  }, [offline, booting])

  // Any key starts him (Esc holds an auto-start instead).
  useEffect(() => {
    if (!offline) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || ['Tab', 'Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key)) return
      if (e.key === 'Escape') {
        setHeld(true)
        setCount(null)
        return
      }
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [offline, onStart])

  // Can he make sound without a click? Asked again every couple of seconds,
  // because the answer changes once the microphone is open.
  const [sound, setSound] = useState(false)
  useEffect(() => {
    if (!offline || sound) return
    let live = true
    const ask = () => void sfx.probeSound().then((ok) => live && ok && setSound(true))
    ask()
    const t = setInterval(ask, 2000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [offline, sound])

  // Auto-start: only when the checks are in, the bridge is up, and Chrome
  // will let him speak without a click — otherwise he'd wake up mute.
  useEffect(() => {
    if (!offline || !autoStart || held || !ready || !bridgeUp || !sound) {
      setCount(null)
      return
    }
    setCount(3)
    const t = setInterval(() => setCount((c) => (c === null ? null : c - 1)), 1000)
    return () => clearInterval(t)
  }, [offline, autoStart, held, ready, bridgeUp, sound])
  useEffect(() => {
    if (count === 0) onStart()
  }, [count, onStart])

  if (gone) return null

  const done = checks.filter((c) => c.status !== 'pending').length
  const stageIdx = STEPS.findIndex((s) => s.id === stage)
  const progress = offline ? (done / checks.length) * 0.5 : 0.5 + (Math.max(0, stageIdx) / (STEPS.length - 1)) * 0.5
  const state = booting
    ? `${STEPS[Math.max(0, stageIdx)]?.label ?? 'Starting'}…`
    : !offline
      ? 'Online'
      : count !== null
        ? `Starting in ${count}`
        : ready
          ? 'Ready'
          : 'Systems check'

  return (
    <div
      className={`intro ${leaving ? 'intro-leaving' : ''} ${booting ? 'intro-booting' : ''}`}
      onClick={() => offline && onStart()}
      role="dialog"
      aria-label="JARVIS start-up"
    >
      <div className="intro-bg" aria-hidden />
      <header className="intro-top">
        <span className="intro-brand">
          JARVIS <em>Station</em>
        </span>
        <span className="intro-clock">
          <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
          {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </header>

      <aside className="intro-panel intro-checks" aria-live="polite">
        <h2>{booting || !offline ? 'Power-up' : 'Systems check'}</h2>
        {booting || !offline
          ? STEPS.map((s, i) => (
              <div key={s.id} className={`sys-row s-${i < stageIdx || !offline ? 'ok' : i === stageIdx ? 'pending' : 'off'}`}>
                <i />
                <span className="sys-k">{s.label}</span>
                <span className="sys-v">{i < stageIdx || !offline ? 'done' : i === stageIdx ? (s.id === 'voice' && bootNote ? bootNote : 'working') : 'queued'}</span>
              </div>
            ))
          : checks.map((c, i) => (
              <div key={c.id} className={`sys-row s-${c.status}`} style={{ animationDelay: `${i * 90}ms` }}>
                <i />
                <span className="sys-k">{c.label}</span>
                <span className="sys-v">{c.detail}</span>
              </div>
            ))}
      </aside>

      <div className="intro-center">
        <Dial progress={progress} live={booting} />
        <div className="intro-word">JARVIS</div>
        <div className="intro-state">{state}</div>
      </div>

      <Brief />

      <footer className="intro-foot" onClick={(e) => e.stopPropagation()}>
        {error && offline && <p className="intro-error">{error}</p>}
        {offline && (
          <>
            <div className="intro-ways">
              <button className="way" onClick={onStart}>
                <b>Say “Jarvis”</b>
                <span>or “wake up”</span>
              </button>
              <button className="way" onClick={onStart}>
                <b>Any key</b>
                <span>or click anywhere</span>
              </button>
              <button className="way" onClick={onStart}>
                <b>Double-clap</b>
                <span>near the Mac</span>
              </button>
            </div>
            <label className="intro-auto">
              <input type="checkbox" checked={autoStart} onChange={(e) => setPrefs({ autoStart: e.target.checked })} />
              Start by himself when this window opens
              {count !== null ? (
                <button
                  className="intro-hold"
                  onClick={() => {
                    setHeld(true)
                    setCount(null)
                  }}
                >
                  Hold (Esc)
                </button>
              ) : autoStart && ready && bridgeUp && !held && !sound ? (
                <span className="intro-note">— Chrome wants one key press first this time</span>
              ) : null}
            </label>
          </>
        )}
      </footer>
    </div>
  )
}

/** After a hands-free start Chrome may hold his voice until any key or click. */
export function SoundLockHint() {
  const locked = useStore((s) => s.soundLocked && s.phase !== 'offline' && s.phase !== 'boot')
  return locked ? (
    <div className="sound-lock" role="status">
      Press any key or click once so JARVIS can speak — Chrome holds sound until then.
    </div>
  ) : null
}
