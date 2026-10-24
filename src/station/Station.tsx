import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { TOUCH, useHub, type Graphics, type View } from '../hub/client'
import { useStore } from '../store'
import { ago, clock, elapsed, JOB_LABEL, tone, until } from '../hub/format'
import { TerminalFeed, type TermFocus } from '../dash/Terminal'
import { VoiceWave } from '../dash/VoiceWave'
import { openItems, useTick } from '../dash/state'
import { StationScene } from './StationScene'
import { useStation, type Mode } from './stationStore'
import { typing } from './shared'
import { useStationModel } from './model'
import { useLiveEvents } from './events'
import { ZONE, ZONES, type View as Focus } from './layout'
import { describe, termMatch } from './describe'
import { Detail } from './Detail'
import { DeskCode, DeskIdeas } from './desk'
import { LabelLayer } from './labels'
import { IntroOverlay } from './intro'
import './station.css'

/**
 * JARVIS Station: the 3D control room, with live panels over it — business
 * and money, the terminal, what needs Markus, what's running — the voice
 * visualizer under the reactor, and a detail panel for whatever is selected.
 *
 * Four modes on the same live data: Talk (J — sat at the desk facing
 * JARVIS, the conversation clear in front of you), Walk (F — on foot,
 * first person, E to sit back down or open a zone), Command (panels,
 * labels, details — for working) and Cinematic (C — panels away, camera
 * pulled back and drifting, a strip of every system's live state and the
 * events as they happen).
 */

/** Builds the live state → scene model once and shares it; turns changes into events. */
function ModelSync() {
  const model = useStationModel()
  const setModel = useStation((s) => s.setModel)
  useEffect(() => setModel(model), [model, setModel])
  useLiveEvents()
  return null
}

/** A metric's origin and age, so a number is never read without its freshness. */
function Src({ text, state = 'live' }: { text: string; state?: 'live' | 'stale' | 'off' }) {
  return <span className={`biz-src s-${state}`}>{text}</span>
}

const STALE = 20 * 60000
const age = (at: number | undefined, label: string): { text: string; state: 'live' | 'stale' | 'off' } =>
  !at ? { text: `${label} · never read`, state: 'off' } : { text: `${label} · ${ago(at)}`, state: Date.now() - at > STALE ? 'stale' : 'live' }

function Holo({ title, badge, onOpen, children }: { title: string; badge?: ReactNode; onOpen?: () => void; children: ReactNode }) {
  return (
    <section className="holo">
      <header className="holo-head">
        <span className="holo-title">{title}</span>
        {badge}
        {onOpen && (
          <button className="holo-open" onClick={onOpen}>
            Open ›
          </button>
        )}
      </header>
      <div className="holo-body">{children}</div>
      <i className="holo-corner tl" />
      <i className="holo-corner tr" />
      <i className="holo-corner bl" />
      <i className="holo-corner br" />
    </section>
  )
}


function NeedsHolo({ go, rows }: { go: (v: View) => void; rows: number }) {
  const s = useHub((x) => x.state)
  const select = useStation((x) => x.select)
  const items = openItems(s?.items).slice(0, rows)
  return (
    <Holo title="Needs Markus" badge={<span className={`holo-count ${items.length ? 'need' : ''}`}>{openItems(s?.items).length}</span>} onOpen={() => go('needs')}>
      {items.length ? (
        items.map((i) => (
          <button key={i.id} className={`holo-row pri-${i.priority}`} onClick={() => select({ kind: 'item', id: i.id, zone: 'needs' })} title="Show in the room, with its actions">
            <span className="holo-dot" />
            <span className="holo-row-main">
              <span className="holo-row-title">{i.title}</span>
              <span className="holo-row-sub">
                {i.priority} · {i.project} · {ago(i.createdAt)}
              </span>
            </span>
          </button>
        ))
      ) : (
        <p className="holo-empty">All clear, sir.</p>
      )}
    </Holo>
  )
}

function JobsHolo({ go, rows }: { go: (v: View) => void; rows: number }) {
  useTick(5000)
  const s = useHub((x) => x.state)
  const select = useStation((x) => x.select)
  const jobs = Object.values(s?.jobs ?? {})
    .filter((j) => ['running', 'needs_markus', 'retrying', 'cancel_requested', 'queued'].includes(j.state))
    .sort((a, b) => (b.heartbeatAt ?? b.updatedAt) - (a.heartbeatAt ?? a.updatedAt))
  const running = jobs.filter((j) => j.state === 'running').length
  return (
    <Holo title="Running" badge={<span className="holo-count">{running}</span>} onOpen={() => go('jobs')}>
      {jobs.slice(0, rows).map((j) => (
        <button key={j.id} className={`holo-row tone-${tone(j.state, j.stale)}`} onClick={() => select({ kind: 'job', id: j.id, zone: 'jobs' })} title="Show on the Jobs pad">
          <span className="holo-dot" />
          <span className="holo-row-main">
            <span className="holo-row-title">
              {j.taskId && <span className="mono">{j.taskId} </span>}
              {j.title}
            </span>
            <span className="holo-row-sub">
              {j.stale ? 'no heartbeat' : JOB_LABEL[j.state]} · {j.stage ?? j.worker ?? j.source}
              {j.state === 'running' && ` · ${elapsed(j.lease?.claimedAt ?? j.createdAt)}`}
            </span>
          </span>
        </button>
      ))}
      {!jobs.length && <p className="holo-empty">Nothing running. Running jobs light up on the Jobs pad.</p>}
    </Holo>
  )
}

function BusinessHolo({ go }: { go: (v: View) => void }) {
  useTick(30000)
  const s = useHub((x) => x.state)
  const am = s?.projects.automaton
  const ex = s?.expenses
  const req = s?.usage.requests
  const five = s?.usage.windows.five_hour
  const fiveFresh = five && (!five.resetsAt || five.resetsAt > Date.now())
  const stage = (k: string) => am?.sites?.filter((x) => x.stage === k).length ?? 0
  const site = age(am?.site?.checkedAt, 'site probe')
  const pipe = am?.sites ? age(am.updatedAt, 'pipeline') : { text: `pipeline · ${am?.sitesError ?? 'unavailable'}`, state: 'off' as const }
  const leads = am?.leads ? age(am.updatedAt, 'leads table') : { text: `leads · ${am?.leadsError ?? 'unavailable'}`, state: 'off' as const }
  const usage = fiveFresh ? age(five!.observedAt, 'status line') : { text: 'no fresh status-line reading', state: 'off' as const }
  return (
    <Holo title="Business & money" onOpen={() => go('finance')}>
      <div className="biz">
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">automaton.llc</span>
          <span className={`biz-v ${am?.site?.ok ? 'ok' : 'bad'}`}>{am?.site ? (am.site.ok ? `up · ${am.site.ms} ms` : 'not answering') : 'unchecked'}</span>
          <Src {...site} />
        </button>
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">Sites to review</span>
          <span className="biz-v">{am?.sites ? stage('needs_review') + stage('needs_edits') : '—'}</span>
          <Src {...pipe} />
        </button>
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">Leads</span>
          <span className="biz-v">{am?.leads ? am.leads.total : '—'}</span>
          <Src {...leads} />
        </button>
        <button className="biz-cell" onClick={() => go('finance')}>
          <span className="biz-k">Spent this month</span>
          <span className="biz-v">{ex ? `$${ex.month.total.toFixed(2)}` : '—'}</span>
          <Src text={ex ? 'your expense ledger' : 'ledger · not loaded'} state={ex ? 'live' : 'off'} />
        </button>
        <button className="biz-cell" onClick={() => go('settings')}>
          <span className="biz-k">Claude 5h left</span>
          <span className="biz-v">{fiveFresh ? `${Math.round(100 - five!.usedPct)}% · ${until(five!.resetsAt)}` : 'unavailable'}</span>
          <Src {...usage} />
        </button>
        <button className="biz-cell" onClick={() => go('settings')}>
          <span className="biz-k">JARVIS spend</span>
          <span className="biz-v">{req ? `$${req.costUsd.toFixed(2)}` : '—'}</span>
          <Src text={req ? "this bridge's requests" : 'not reported yet'} state={req ? 'live' : 'off'} />
        </button>
      </div>
      <p className="biz-note">Trading: monitoring only — no broker connected, so no positions or P&amp;L are shown.</p>
    </Holo>
  )
}

/** Camera presets, Reset, Connections View, and Command / Cinematic. */
function ViewBar() {
  const view = useStation((s) => s.view)
  const mode = useStation((s) => s.mode)
  const connections = useStation((s) => s.connections)
  const { fly, select, setMode, toggleConnections } = useStation.getState()
  const presets: Focus[] = ['overview', 'roblox', 'automaton', 'finance', 'jobs', 'needs', 'core']
  return (
    <div className="st-viewbar" role="toolbar" aria-label="Station camera">
      {mode === 'command' &&
        presets.map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => fly(v)} title={v === 'overview' ? 'See the whole station' : `Focus ${ZONE[v].label}`}>
            {v === 'overview' ? 'Overview' : ZONE[v].label}
          </button>
        ))}
      {mode !== 'talk' && mode !== 'walk' && (
        <button
          onClick={() => {
            select(null, false)
            fly('overview')
          }}
          title="Reset the view (R)"
        >
          Reset
        </button>
      )}
      {mode === 'command' && (
        <button className={connections ? 'on' : ''} onClick={toggleConnections} title="Show every connection and what it carries (L)">
          Connections
        </button>
      )}
      <span className="st-mode" role="group" aria-label="Mode">
        {(
          [
            ['talk', 'Talk', 'Sit at the desk and talk to JARVIS (J)'],
            ['walk', 'Walk', 'Get up and walk the station, first person (F)'],
            ['command', 'Command', 'Panels and details, for working (C)'],
            ['cinematic', 'Cinematic', 'The whole station, live, camera drifting (C)'],
          ] as [Mode, string, string][]
        ).map(([m, label, title]) => (
          <button key={m} className={`m-${m}${mode === m ? ' on' : ''}`} onClick={() => setMode(m)} title={title}>
            {label}
          </button>
        ))}
      </span>
    </div>
  )
}

const EVENT_WORD: Record<string, string> = { assign: 'started', complete: 'finished', fail: 'failed', lead: 'leads', studio: 'studio', need: 'needs you', voice: 'voice' }

/** Cinematic mode's caption: every system's live state, and events as they land. */
function CineStrip() {
  const model = useStation((s) => s.model)
  const events = useStation((s) => s.events)
  useTick(1000)
  const now = performance.now()
  const live = events.filter((e) => now - e.at < 8000).slice(-3).reverse()
  if (!model) return null
  return (
    <div className="st-cine">
      {live.map((e) => (
        <p key={e.id} className={`st-cine-ev e-${e.kind}`} style={{ '--zc': ZONE[e.zone].color } as CSSProperties}>
          <b>{ZONE[e.zone].label}</b> {EVENT_WORD[e.kind]} {e.label ? `· ${e.label}` : ''}
        </p>
      ))}
      <ul>
        {ZONES.map((z) => (
          <li key={z.id} className={`st-cine-z z-${model.zones[z.id].state}`} style={{ '--zc': z.color } as CSSProperties}>
            <i />
            <b>{z.label}</b>
            <span>{model.zones[z.id].headline}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The terminal, narrowed to the selection while one is open. */
function StationTerminal({ go }: { go: (v: View) => void }) {
  const sel = useStation((s) => s.selected)
  const model = useStation((s) => s.model)
  const [follow, setFollow] = useState(true)
  useEffect(() => setFollow(true), [sel])
  const focus = useMemo<TermFocus | null>(() => {
    if (!sel || !model || !follow) return null
    return { label: describe(sel, model)?.title ?? ZONE[sel.zone].label, test: termMatch(sel, model), clear: () => setFollow(false) }
    // Rebuilt for a new selection, not on every model tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, follow, Boolean(model)])
  return (
    <Holo title="Terminal" onOpen={() => go('terminal')}>
      <TerminalFeed compact height={280} focus={focus} />
    </Holo>
  )
}

const QUALITIES: Graphics[] = ['low', 'high', 'ultra']

function TopHud() {
  useTick(1000)
  const link = useHub((s) => s.link)
  const graphics = useHub((s) => s.prefs.graphics)
  const setPrefs = useHub((s) => s.setPrefs)
  const go = useHub((s) => s.go)
  const s = useHub((x) => x.state)
  const needs = openItems(s?.items).length
  const now = new Date()
  return (
    <header className="st-top">
      <div className="st-brand">
        <span className="st-mark">JARVIS</span>
        <span className="st-sub">Station</span>
        <span className={`st-link st-link-${link}`}>{link === 'live' ? 'live' : link === 'down' ? 'bridge offline' : 'connecting'}</span>
      </div>
      <div className="st-clock">
        <span className="mono">{clock(now.getTime())}</span>
        <span>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      <nav className="st-nav">
        {(
          [
            ['overview', 'Overview'],
            ['roblox', 'Roblox'],
            ['finance', 'Finance'],
            ['automaton', 'Automaton'],
            ['jobs', 'Jobs'],
            ['terminal', 'Terminal'],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button key={v} onClick={() => go(v)}>
            {label}
          </button>
        ))}
        <button className={needs ? 'st-need' : ''} onClick={() => go('needs')}>
          Needs {needs ? <b>{needs}</b> : null}
        </button>
        <span className="st-quality" role="group" aria-label="Graphics quality">
          {QUALITIES.map((g) => (
            <button key={g} className={graphics === g ? 'on' : ''} onClick={() => setPrefs({ graphics: g })} title={`Graphics: ${g}`}>
              {g}
            </button>
          ))}
        </span>
      </nav>
    </header>
  )
}

function Dock({ captionOnly }: { captionOnly: boolean }) {
  useTick(250)
  const turns = useStore((s) => s.turns)
  const caption = useStore((s) => s.caption)
  const phase = useStore((s) => s.phase)
  const last = turns.at(-1)
  const live = phase === 'listening' || phase === 'waking'
  const line = live && caption && caption !== '…' ? { you: true, text: caption } : last && !captionOnly ? { you: last.role === 'user', text: last.text } : null
  return (
    <div className="st-dock">
      {line && <p className={`st-line ${line.you ? 'you' : 'him'}`}>{line.text}</p>}
      <VoiceWave size="large" />
    </div>
  )
}

const PHASE_WORD: Record<string, string> = {
  offline: 'Offline',
  boot: 'Starting up…',
  dormant: 'Standing by',
  waking: 'Listening…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  tooling: 'Working…',
  speaking: 'Speaking',
}

/**
 * Talk mode's conversation: what Markus said and what JARVIS answered, in
 * full and easy to read, what he's doing right now, and a line to type to
 * him — the same conversation as voice, the phone and the terminal.
 */
function TalkPanel() {
  const turns = useStore((s) => s.turns)
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const tool = useStore((s) => s.activeTool)
  const c = useStore((s) => s.controls)
  const [text, setText] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const live = (phase === 'listening' || phase === 'waking') && caption && caption !== '…'
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight
  }, [turns, live, caption])
  const shown = turns.slice(-14)
  const tab = useStation((s) => s.desk.tab)
  const setDesk = useStation((s) => s.setDesk)
  const codeState = useHub((s) => (s.code.sessions.some((x) => x.state === 'approval') ? 'ask' : s.code.sessions.some((x) => x.state === 'working') ? 'busy' : null))
  const fresh = useHub((s) => s.ideas.filter((i) => i.state === 'new').length)
  return (
    <section className={`st-talk${tab === 'talk' ? '' : ' wide'}`} aria-label="The desk">
      <header className="st-talk-head">
        <nav className="st-desk-tabs" role="tablist" aria-label="At the desk">
          <button role="tab" aria-selected={tab === 'talk'} className={tab === 'talk' ? 'on' : ''} onClick={() => setDesk({ tab: 'talk' })}>
            JARVIS
          </button>
          <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setDesk({ tab: 'code' })}>
            Claude Code{codeState && <i className={`st-tab-dot d-${codeState}`} aria-label={codeState === 'ask' ? 'waiting on you' : 'working'} />}
          </button>
          <button role="tab" aria-selected={tab === 'ideas'} className={tab === 'ideas' ? 'on' : ''} onClick={() => setDesk({ tab: 'ideas' })}>
            Ideas{fresh > 0 && <b className="st-tab-n">{fresh}</b>}
          </button>
        </nav>
        <span className={`st-talk-state p-${phase}`}>
          <i />
          {PHASE_WORD[phase] ?? phase}
          {phase === 'tooling' && tool ? ` · ${tool.replace(/^mcp__\w+?__/, '').replace(/_/g, ' ')}` : ''}
        </span>
      </header>
      {tab === 'code' && <DeskCode />}
      {tab === 'ideas' && <DeskIdeas />}
      {tab === 'talk' && (
        <>
          <div className="st-talk-body" ref={body}>
            {shown.map((t) => (
              <div key={t.id} className={`st-turn ${t.role === 'user' ? 'you' : 'him'}`}>
                <span className="st-turn-who">{t.role === 'user' ? 'You' : 'JARVIS'}</span>
                <p>{t.text}</p>
                {t.role === 'jarvis' && t.tools && t.tools.length > 0 && <span className="st-turn-tools">used {[...new Set(t.tools)].map((x) => x.replace(/^mcp__\w+?__/, '').replace(/_/g, ' ')).join(' · ')}</span>}
              </div>
            ))}
            {live && (
              <div className="st-turn you live">
                <span className="st-turn-who">You</span>
                <p>{caption}</p>
              </div>
            )}
            {!shown.length && !live && (
              <p className="st-talk-empty">
                {TOUCH ? (
                  'Say “Hey Jarvis”, tap below, or type.'
                ) : (
                  <>
                    Say “Hey Jarvis”, hold Space, or type below.
                    <br />
                    <span>F to get up and walk the station.</span>
                  </>
                )}
              </p>
            )}
          </div>
          <form
            className="st-talk-input"
            onSubmit={(e) => {
              e.preventDefault()
              const t = text.trim()
              if (!t) return
              c.sendText(t)
              setText('')
            }}
          >
            <input
              value={text}
              onChange={(e) => {
                typing.at = performance.now()
                setText(e.target.value)
              }}
              placeholder="Talk to JARVIS…"
              aria-label="Type to JARVIS"
              spellCheck={false}
            />
            <button type="submit" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </section>
  )
}

/** On foot: a crosshair, what E does here, and the controls. */
function WalkHud() {
  const hint = useStation((s) => s.walk.hint)
  const locked = useStation((s) => s.walk.locked)
  return (
    <>
      <div className="st-cross" aria-hidden />
      {hint && <p className="st-walk-hint">{hint}</p>}
      {!locked && <p className="st-walk-look">Click the room to look around with the mouse (Esc lets go)</p>}
      <p className="st-walk-keys">
        <b>W A S D</b> move · <b>Shift</b> run · <b>mouse</b> look · <b>E</b> use · <b>Space</b> talk · <b>F</b> sit back down
      </p>
    </>
  )
}

/** Talk mode's one other thing: what's waiting on Markus, if anything. */
function TalkWaiting() {
  const items = useStation((s) => s.model?.items)
  const select = useStation((s) => s.select)
  if (!items?.length) return null
  return (
    <button className="st-waiting" onClick={() => select({ kind: 'item', id: items[0].id, zone: 'needs' })} title="Open it in Command mode">
      <b>{items.length} waiting on you</b>
      <span>{items[0].title}</span>
    </button>
  )
}

export function Station() {
  const graphics = useHub((s) => s.prefs.graphics)
  const go = useHub((s) => s.go)
  const mode = useStation((s) => s.mode)
  const intro = useStation((s) => s.intro !== 'done')
  // With a selection open the right column makes room for its detail.
  const selected = useStation((s) => Boolean(s.selected))
  // J: Talk. F: Walk. C: Cinematic / Command. R: reset the view. L: Connections View.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const st = useStation.getState()
      if (e.key === 'c') st.setMode(st.mode === 'cinematic' ? 'command' : 'cinematic')
      else if (e.key === 'j') st.setMode('talk')
      else if (e.key === 'f') st.setMode(st.mode === 'walk' ? 'talk' : 'walk')
      else if (e.key === 'r') {
        st.select(null, false)
        st.fly('overview')
      } else if (e.key === 'l') st.toggleConnections()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The panels are a HUD over the room. (Placed inside the 3D scene they
  // blank the frame once the reflective floor is on.)
  return (
    <div className={`station is-${mode}${intro ? ' cine-on' : ''}`}>
      <ModelSync />
      <StationScene graphics={graphics} />
      <LabelLayer />
      {mode === 'command' && (
        <>
          <div className="st-panels st-left">
            <BusinessHolo go={go} />
            <StationTerminal go={go} />
          </div>
          <div className="st-panels st-right">
            <Detail />
            <NeedsHolo go={go} rows={selected ? 2 : 4} />
            <JobsHolo go={go} rows={selected ? 2 : 5} />
          </div>
        </>
      )}
      {mode === 'talk' && (
        <>
          <TalkPanel />
          <TalkWaiting />
        </>
      )}
      {mode === 'cinematic' && <CineStrip />}
      {mode === 'walk' && <WalkHud />}
      <TopHud />
      <ViewBar />
      <Dock captionOnly={mode === 'talk' || mode === 'walk'} />
      <IntroOverlay />
      {mode === 'command' && <p className="st-hint">Drag to orbit · click a system · R reset · L links · C cinematic · J talk · F walk</p>}
    </div>
  )
}
