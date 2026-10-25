import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useHub, connectHub, type View, TOUCH } from '../hub/client'
import { ago, JOB_LABEL, tone } from '../hub/format'
import { CoreView } from '../scene/CoreView'
import { BurstView } from '../scene/BurstView'
import { Backdrop } from '../backdrop/Backdrop'
import { Blades } from '../ui/Blades'
import { Effects } from '../ui/Effects'
import { Pointer } from '../ui/Pointer'
import { GestureGuide } from '../ui/GestureGuide'
import { HandsToggle } from '../ui/HandsToggle'
import { Diagnostics } from '../ui/Diagnostics'
import { Intro, SoundLockHint } from '../ui/Intro'
import { PhoneLock } from '../ui/PhoneLock'
import { Overview } from './Overview'
import { Projects } from './Projects'
import { Roblox } from './Roblox'
import { Finance } from './Finance'
import { Automaton } from './Automaton'
import { Needs, Activity, Settings } from './Pages'
import { Jobs } from './Jobs'
import { Terminal } from './Terminal'
import { Station } from '../station/Station'
import { useStation } from '../station/stationStore'
import { UsageChip } from './Usage'
import { VoiceWave } from './VoiceWave'
import { ItemCard } from './shared'
import { inputState, openItems, useMedia, useTick } from './state'
import './dash.css'

const NAV: { id: View; label: string; key: string }[] = [
  { id: 'station', label: 'Station', key: '0' },
  { id: 'overview', label: 'Overview', key: '1' },
  { id: 'projects', label: 'Projects', key: 'p' },
  { id: 'roblox', label: 'Roblox', key: '2' },
  { id: 'finance', label: 'Finance', key: '3' },
  { id: 'automaton', label: 'Automaton', key: '4' },
  { id: 'needs', label: 'Needs Markus', key: '5' },
  { id: 'jobs', label: 'Jobs', key: '6' },
  { id: 'terminal', label: 'Terminal', key: '7' },
  { id: 'activity', label: 'Activity', key: '8' },
  { id: 'settings', label: 'Settings', key: '9' },
]

function TopBar() {
  useTick(1000)
  const link = useHub((s) => s.link)
  const view = useHub((s) => s.prefs.view)
  const setPrefs = useHub((s) => s.setPrefs)
  const setPalette = useHub((s) => s.setPalette)
  const st = inputState()
  const voice = useStore((s) => s.voice)
  const looking = useStore((s) => s.looking)
  const model = useHub((s) => s.state?.usage.statusLine?.model)
  const inScreen = useStation((s) => s.screen?.phase === 'on')
  return (
    <header className="topbar">
      <div className="brand">
        {inScreen && (
          <button className="btn btn-back" onClick={() => useStation.getState().leaveScreen()} title="Back to the room (Esc)">
            ◂ Room <kbd>Esc</kbd>
          </button>
        )}
        <span className="brand-mark">JARVIS</span>
        <span className={`state-pill state-${st.tone}`}>
          <span className="state-dot" />
          <span className="state-label">{st.label}</span>
        </span>
      </div>
      <div className="topbar-mid">
        <span className="crumb">{NAV.find((n) => n.id === view)?.label}</span>
        {looking ? <span className="state-pill state-busy">{`Camera: ${looking}`}</span> : <HandsToggle />}
      </div>
      <div className="topbar-right">
        <span className={`link-dot link-${link}`} title={link === 'live' ? 'Command center connected' : link === 'down' ? 'Command center disconnected — showing the last state' : 'Connecting'} />
        <span className="muted small">{link === 'live' ? 'live' : link === 'down' ? 'offline' : '…'}</span>
        {model && <span className="muted small">· {model}</span>}
        {voice && <span className="muted small">· voice {voice.replace(/\(.*?\)/g, '').trim()}</span>}
        <UsageChip />
        <button className="btn btn-quiet" onClick={() => setPalette(true)} title="Command palette (⌘K)">
          ⌘K
        </button>
        <button className="btn btn-voice" onClick={() => setPrefs({ immersive: true })} title="Immersive voice view (I)">
          Voice view
        </button>
      </div>
    </header>
  )
}

function NavRail() {
  useTick(5000)
  const prefs = useHub((s) => s.prefs)
  const go = useHub((s) => s.go)
  const setPrefs = useHub((s) => s.setPrefs)
  const s = useHub((x) => x.state)
  const needs = openItems(s?.items).length
  const running = Object.values(s?.jobs ?? {})
    .filter((j) => j.state === 'running' || j.state === 'needs_markus' || j.state === 'cancel_requested')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)
  // On a phone the sections are a strip that scrolls sideways: keep the open one in sight.
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    nav.current?.querySelector('.nav-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [prefs.view])
  return (
    <nav ref={nav} className={`nav ${prefs.navCollapsed ? 'collapsed' : ''}`} aria-label="Sections">
      {NAV.map((n) => (
        <button key={n.id} className={`nav-item ${prefs.view === n.id ? 'on' : ''}`} onClick={() => go(n.id)} title={`${n.label} (${n.key})`}>
          <span className="nav-key mono">{n.key}</span>
          <span className="nav-label">{n.label}</span>
          {n.id === 'needs' && needs > 0 && <span className="badge">{needs}</span>}
        </button>
      ))}
      <div className="nav-jobs">
        <div className="nav-h">Active jobs</div>
        {running.length === 0 && <div className="nav-empty">Nothing running</div>}
        {running.map((j) => (
          <button
            key={j.id}
            className={`nav-job tone-${tone(j.state, j.stale)}`}
            onClick={() => (j.project === 'roblox' && j.source === 'roblox' ? setPrefs({ view: 'roblox', selectedGame: j.game ?? null }) : go('jobs'))}
            title={j.title}
          >
            <span className="job-dot" />
            <span className="nav-job-text">
              <span className="nav-job-title">{j.taskId ? `${j.taskId} ` : ''}{j.title}</span>
              <span className="nav-job-sub">
                {JOB_LABEL[j.state]}
                {j.stale ? ' · stale' : ''} · {ago(j.heartbeatAt ?? j.updatedAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <button className="nav-collapse" onClick={() => setPrefs({ navCollapsed: !prefs.navCollapsed })} title="Collapse ( [ )" aria-label={prefs.navCollapsed ? 'Expand the sections' : 'Collapse the sections'}>
        {prefs.navCollapsed ? '›' : '‹'}
      </button>
    </nav>
  )
}

function NeedsPanel() {
  useTick(10000)
  const saved = useHub((s) => s.prefs.needsCollapsed)
  const setPrefs = useHub((s) => s.setPrefs)
  // On a narrow screen the panel is a drawer over the page: closed until
  // asked for, and opening it there doesn't change the desktop's setting.
  const narrow = useMedia('(max-width: 1050px)')
  const [drawer, setDrawer] = useState(false)
  const collapsed = narrow ? !drawer : saved
  const open = (on: boolean) => (narrow ? setDrawer(on) : setPrefs({ needsCollapsed: !on }))
  const s = useHub((x) => x.state)
  const items = openItems(s?.items)
  const critical = (s?.activity ?? []).filter((a) => a.level === 'error' && Date.now() - a.ts < 6 * 3600000).slice(-4).reverse()
  if (collapsed) {
    return (
      <aside className="needs collapsed">
        <button className="needs-open" onClick={() => open(true)} title="Show Needs Markus ( ] )">
          <span className="badge">{items.length}</span>
          <span className="vertical">Needs Markus</span>
        </button>
      </aside>
    )
  }
  return (
    <aside className="needs" aria-label="Needs Markus">
      <header className="needs-head">
        <h2>Needs Markus</h2>
        <span className="badge">{items.length}</span>
        <button className="btn btn-quiet" onClick={() => open(false)} title="Collapse ( ] )" aria-label="Collapse Needs Markus">
          ›
        </button>
      </header>
      <div className="needs-body">
        {items.length === 0 && <p className="muted">Nothing needs you.</p>}
        {items.map((i) => (
          <ItemCard key={i.id} item={i} />
        ))}
        {critical.length > 0 && (
          <div className="critical">
            <div className="nav-h">Recent failures</div>
            {critical.map((a) => (
              <div key={a.id} className="critical-row">
                <span className="mono">{ago(a.ts)}</span> {a.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function ConversationBar() {
  useTick(250)
  const phase = useStore((s) => s.phase)
  const turns = useStore((s) => s.turns)
  const caption = useStore((s) => s.caption)
  const error = useStore((s) => s.error)
  const micArmed = useStore((s) => s.micArmed)
  const talkMode = useStore((s) => s.talkMode)
  const setTalkMode = useStore((s) => s.setTalkMode)
  const c = useStore((s) => s.controls)
  const [text, setText] = useState('')
  const view = useHub((s) => s.prefs.view)
  const last = turns.slice(-2)
  const busy = phase === 'thinking' || phase === 'tooling' || phase === 'speaking'
  const listening = phase === 'listening' || phase === 'waking'
  return (
    <footer className="convo">
      <div className="convo-transcript" aria-live="polite">
        {listening && caption && caption !== '…' ? (
          <div className="line line-live">
            <b>You</b> {caption}
          </div>
        ) : (
          last.map((t) => (
            <div key={t.id} className={`line line-${t.role}`}>
              <b>{t.role === 'user' ? 'You' : 'Jarvis'}</b> {t.text || '…'}
            </div>
          ))
        )}
        {error && <div className="line line-error">{error}</div>}
      </div>
      {/* On the overview the visualizer sits under the core instead. */}
      <div className="convo-center">{view !== 'overview' && <VoiceWave />}</div>
      <div className="convo-right">
      <form
        className="convo-input"
        onSubmit={(e) => {
          e.preventDefault()
          c.sendText(text)
          setText('')
        }}
      >
        <input className="input" placeholder={phase === 'offline' ? 'Start JARVIS first' : 'Type to Jarvis…'} value={text} onChange={(e) => setText(e.target.value)} disabled={phase === 'offline'} aria-label="Message Jarvis" />
      </form>
      <div className="convo-controls">
        {listening ? (
          <button className="btn btn-primary" onClick={c.finishSpeaking} title="Enter">
            Finish speaking
          </button>
        ) : (
          <button className="btn btn-primary" onClick={c.startTalking} disabled={phase === 'offline'} title="Space">
            Talk
          </button>
        )}
        {phase === 'speaking' && (
          <button className="btn" onClick={c.stopTalking} title="Silence him; work carries on">
            Stop talking
          </button>
        )}
        {busy && (
          <button className="btn" onClick={c.cancelReply} title="Abandon this reply">
            Cancel reply
          </button>
        )}
        <button className={`btn ${micArmed ? '' : 'btn-warn'}`} onClick={() => c.setMicArmed(!micArmed)} title="M">
          {micArmed ? 'Mic on' : 'Mic off'}
        </button>
        <select className="input input-small" value={talkMode} onChange={(e) => setTalkMode(e.target.value as typeof talkMode)} aria-label="Talk mode">
          <option value="auto">Auto</option>
          <option value="hold">Hold</option>
          <option value="tap">Tap</option>
        </select>
      </div>
      </div>
    </footer>
  )
}

type Cmd = { label: string; hint?: string; run: () => void }

function Palette() {
  const open = useHub((s) => s.paletteOpen)
  const setPalette = useHub((s) => s.setPalette)
  const go = useHub((s) => s.go)
  const setPrefs = useHub((s) => s.setPrefs)
  const s = useHub((x) => x.state)
  const c = useStore((x) => x.controls)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      ...NAV.map((n) => ({ label: `Go to ${n.label}`, hint: n.key, run: () => go(n.id) })),
      { label: 'Immersive voice view', hint: 'I', run: () => setPrefs({ immersive: true }) },
      { label: 'Stop talking', run: c.stopTalking },
      { label: 'Cancel reply', run: c.cancelReply },
      { label: 'Microphone off', hint: 'M', run: () => c.setMicArmed(false) },
      { label: 'Microphone on', hint: 'M', run: () => c.setMicArmed(true) },
      { label: 'Toggle reduced motion', run: () => setPrefs({ reducedMotion: !useHub.getState().prefs.reducedMotion }) },
      { label: 'Toggle low power', run: () => setPrefs({ lowPower: !useHub.getState().prefs.lowPower }) },
      ...(s?.projects.roblox?.games ?? []).map((g) => ({ label: `Roblox: ${g.name}`, run: () => setPrefs({ view: 'roblox' as View, selectedGame: g.id }) })),
      ...openItems(s?.items).map((i) => ({ label: `Needs you: ${i.title}`, run: () => go('needs') })),
    ]
    const needle = q.trim().toLowerCase()
    return needle ? list.filter((x) => x.label.toLowerCase().includes(needle)) : list
  }, [q, s, c, go, setPrefs])
  if (!open) return null
  const close = () => {
    setPalette(false)
    setQ('')
    setSel(0)
  }
  return (
    <div className="palette-back" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          autoFocus
          className="input palette-input"
          placeholder="Type a command or a game…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') setSel((n) => Math.min(cmds.length - 1, n + 1))
            if (e.key === 'ArrowUp') setSel((n) => Math.max(0, n - 1))
            if (e.key === 'Enter' && cmds[sel]) {
              cmds[sel].run()
              close()
            }
          }}
        />
        <ul className="palette-list">
          {cmds.slice(0, 12).map((x, i) => (
            <li key={x.label}>
              <button
                className={i === sel ? 'on' : ''}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  x.run()
                  close()
                }}
              >
                {x.label}
                {x.hint && <kbd>{x.hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** The large voice view: nebula, filaments, the live state and the words. */
function Immersive() {
  useTick(250)
  const setPrefs = useHub((s) => s.setPrefs)
  const voiceVisual = useHub((s) => s.prefs.voiceVisual)
  const turns = useStore((s) => s.turns)
  const caption = useStore((s) => s.caption)
  const phase = useStore((s) => s.phase)
  const last = turns.at(-1)
  const live = phase === 'listening' || phase === 'waking'
  return (
    <div className="immersive">
      {voiceVisual === 'burst' ? <BurstView /> : <CoreView mode="immersive" />}
      <button className="btn btn-quiet immersive-close" onClick={() => setPrefs({ immersive: false })} title="Back to the dashboard (Esc)">
        Dashboard
      </button>
      <div className="immersive-words">
        {live && caption && caption !== '…' ? <p className="you">{caption}</p> : last ? <p className={last.role === 'user' ? 'you' : 'him'}>{last.text}</p> : null}
      </div>
      <div className="immersive-foot">
        <VoiceWave size="large" />
      </div>
    </div>
  )
}

function Toast() {
  const toast = useHub((s) => s.toast)
  return toast ? <div className="toast" role="status">{toast}</div> : null
}

export function Dashboard({ onStart }: { onStart: () => void }) {
  const prefs = useHub((s) => s.prefs)
  const setPrefs = useHub((s) => s.setPrefs)
  const setPalette = useHub((s) => s.setPalette)
  const go = useHub((s) => s.go)
  const gestures = useStore((s) => s.gestures)
  const screen = useStation((s) => s.screen)
  const leaveScreen = useStation((s) => s.leaveScreen)
  // Choosing the station from inside a screen (its tab, key 0) goes back out through it.
  useEffect(() => {
    if (screen?.phase === 'on' && prefs.view === 'station') leaveScreen()
  }, [screen?.phase, prefs.view, leaveScreen])
  // Esc in a screen: back out to the room, before Esc's usual "stand down".
  useEffect(() => {
    if (screen?.phase !== 'on') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useHub.getState().paletteOpen || useHub.getState().prefs.immersive) return
      e.preventDefault()
      e.stopImmediatePropagation()
      leaveScreen()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [screen?.phase, leaveScreen])

  useEffect(() => {
    connectHub()
    document.body.classList.add('dash-mode')
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useHub.getState().paletteOpen)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const nav = NAV.find((n) => n.key === e.key)
      if (nav) return go(nav.id)
      if (e.key === '[') return setPrefs({ navCollapsed: !useHub.getState().prefs.navCollapsed })
      if (e.key === ']') return setPrefs({ needsCollapsed: !useHub.getState().prefs.needsCollapsed })
      if (e.key === 'i') return setPrefs({ immersive: !useHub.getState().prefs.immersive })
      // In the voice view Esc only leaves the view; it shouldn't also stand
      // him down (App's own Esc handler runs after this one).
      if (e.key === 'Escape' && useHub.getState().prefs.immersive) {
        e.stopImmediatePropagation()
        setPrefs({ immersive: false })
        return
      }
      // Otherwise, with him idle, Esc goes back to the station's overview: from
      // a page, from Talk, Walk or Cinematic, from a zone or pad close-up. (A
      // picture or the palette that's open closes first, and in a desk screen
      // it backs out to the room first.) While he's listening, thinking or
      // talking it stays what it was: App stands him down.
      if (e.key === 'Escape' && !e.defaultPrevented && !useHub.getState().paletteOpen) {
        const st = useStation.getState()
        if (st.screen || st.intro !== 'done') return
        if (!['offline', 'boot', 'dormant'].includes(useStore.getState().phase)) return
        if (useHub.getState().prefs.view !== 'station') setPrefs({ view: 'station' })
        if (st.mode !== 'command') st.setMode('command')
        st.select(null, false)
        st.fly('overview')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, setPalette, setPrefs])

  const view = (() => {
    switch (prefs.view) {
      case 'projects':
        return <Projects />
      case 'roblox':
        return <Roblox />
      case 'finance':
        return <Finance />
      case 'automaton':
        return <Automaton />
      case 'needs':
        return <Needs />
      case 'jobs':
        return <Jobs />
      case 'terminal':
        return <Terminal />
      case 'activity':
        return <Activity />
      case 'settings':
        return <Settings />
      default:
        return <Overview />
    }
  })()

  const station = prefs.view === 'station' && !prefs.immersive
  // Gone into one of the desk's screens: its page is up, with the room still
  // loaded (and paused) underneath to come back out to.
  const inScreen = screen?.phase === 'on' && !station
  // The living backdrop behind the pages; not behind a desk screen or the voice view, which have their own.
  const showBackdrop = prefs.backdrop && !inScreen && !prefs.immersive
  return (
    <>
      {(station || screen) && (
        <div className={prefs.reducedMotion ? 'reduced' : ''}>
          <Station />
        </div>
      )}
      {!station && (
        <div className={`dash ${inScreen ? 'dash-screen' : ''} ${prefs.navCollapsed ? 'nav-collapsed' : ''} ${prefs.needsCollapsed ? 'needs-collapsed' : ''} ${prefs.reducedMotion ? 'reduced' : ''} ${showBackdrop ? 'with-backdrop' : ''}`}>
          {showBackdrop && <Backdrop />}
          <TopBar />
          <NavRail />
          <main className="workspace">{prefs.immersive ? null : view}</main>
          <NeedsPanel />
          <ConversationBar />
        </div>
      )}
      {prefs.immersive && <Immersive />}
      <div className="dash-overlay">
        <Blades />
      </div>
      <Palette />
      <Toast />
      <Effects />
      <Pointer />
      <GestureGuide live={gestures} />
      <Diagnostics />
      <SoundLockHint />
      {/* The phone gets a lock screen instead of the start screen; the Mac starts by itself. */}
      {TOUCH ? <PhoneLock onStart={onStart} /> : <Intro onStart={onStart} />}
    </>
  )
}
