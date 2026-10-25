import { useState, type ReactNode } from 'react'
import { useHub, type View } from '../hub/client'
import { useStore } from '../store'
import { openItems } from './state'

/**
 * The phone's way round, where a thumb reaches: Home, Projects, a big Talk
 * button in the middle, Needs (with its count) and More — a sheet with the
 * other pages and the voice view. It's on every page and in the station.
 *
 * Talk does what the moment calls for: start talking; while he's listening,
 * that's what you meant (finish); while he's speaking, stop him; while he's
 * thinking, drop that reply. Its label says which.
 */

const MORE: { id: View; label: string }[] = [
  { id: 'station', label: 'Station' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'roblox', label: 'Roblox' },
  { id: 'finance', label: 'Finance' },
  { id: 'automaton', label: 'Automaton' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
]

const Icon = {
  home: (
    <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />
  ),
  projects: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  needs: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  check: <path d="m6 12.5 4 4 8-9" />,
  x: <path d="M7 7l10 10M17 7 7 17" />,
}

function Glyph({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      {d}
    </svg>
  )
}

export function PhoneTabBar() {
  const view = useHub((s) => s.prefs.view)
  const immersive = useHub((s) => s.prefs.immersive)
  const setPrefs = useHub((s) => s.setPrefs)
  const go = useHub((s) => s.go)
  const needs = openItems(useHub((s) => s.state?.items)).length
  const phase = useStore((s) => s.phase)
  const c = useStore((s) => s.controls)
  const [more, setMore] = useState(false)

  const open = (v: View) => {
    setMore(false)
    if (immersive) setPrefs({ immersive: false })
    go(v)
  }
  const listening = phase === 'listening' || phase === 'waking'
  const talk =
    phase === 'offline'
      ? { label: 'Talk', icon: Icon.mic, act: () => {}, tone: 'off' }
      : listening
        ? { label: 'Done', icon: Icon.check, act: c.finishSpeaking, tone: 'live' }
        : phase === 'speaking'
          ? { label: 'Stop', icon: Icon.stop, act: c.stopTalking, tone: 'busy' }
          : phase === 'thinking' || phase === 'tooling'
            ? { label: 'Cancel', icon: Icon.x, act: c.cancelReply, tone: 'busy' }
            : { label: 'Talk', icon: Icon.mic, act: c.startTalking, tone: 'idle' }
  const on = (v: View) => !immersive && !more && view === v
  const inMore = !immersive && MORE.some((m) => m.id === view)

  return (
    <>
      {more && (
        <div className="ptab-sheet-wrap" onClick={() => setMore(false)}>
          <div className="ptab-sheet" role="dialog" aria-label="More pages" onClick={(e) => e.stopPropagation()}>
            <div className="ptab-grip" aria-hidden />
            <div className="ptab-grid">
              {MORE.map((m) => (
                <button key={m.id} className={view === m.id && !immersive ? 'on' : ''} onClick={() => open(m.id)}>
                  {m.label}
                </button>
              ))}
              <button
                className={immersive ? 'on' : ''}
                onClick={() => {
                  setMore(false)
                  setPrefs({ immersive: true })
                }}
              >
                Voice view
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="ptab" aria-label="Sections">
        <button className={on('overview') ? 'on' : ''} onClick={() => open('overview')}>
          <Glyph d={Icon.home} />
          <span>Home</span>
        </button>
        <button className={on('projects') ? 'on' : ''} onClick={() => open('projects')}>
          <Glyph d={Icon.projects} />
          <span>Projects</span>
        </button>
        <button className={`ptab-talk ptab-talk-${talk.tone}`} onClick={talk.act} disabled={phase === 'offline'} aria-label={talk.label}>
          <span className="ptab-talk-ring">
            <Glyph d={talk.icon} />
          </span>
          <span>{talk.label}</span>
        </button>
        <button className={on('needs') ? 'on' : ''} onClick={() => open('needs')}>
          <span className="ptab-icon">
            <Glyph d={Icon.needs} />
            {needs > 0 && <b className="ptab-badge">{needs > 99 ? '99+' : needs}</b>}
          </span>
          <span>Needs</span>
        </button>
        <button className={more || inMore || immersive ? 'on' : ''} onClick={() => setMore(!more)} aria-expanded={more}>
          <Glyph d={Icon.more} />
          <span>More</span>
        </button>
      </nav>
    </>
  )
}
