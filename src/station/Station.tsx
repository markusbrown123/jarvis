import { type ReactNode } from 'react'
import { Html } from '@react-three/drei'
import { useHub, type Graphics, type View } from '../hub/client'
import { useStore } from '../store'
import { ago, clock, elapsed, JOB_LABEL, tone, until } from '../hub/format'
import { TerminalFeed } from '../dash/Terminal'
import { VoiceWave } from '../dash/VoiceWave'
import { openItems, useTick } from '../dash/state'
import { StationScene } from './StationScene'
import './station.css'

/**
 * JARVIS Station: the 3D workshop with live holographic panels standing in
 * it — the terminal, what needs Markus, what's running, business and money —
 * and the voice visualizer under the core.
 */

function Holo({ title, badge, wide, onOpen, children }: { title: string; badge?: ReactNode; wide?: boolean; onOpen?: () => void; children: ReactNode }) {
  return (
    <section className={`holo ${wide ? 'holo-wide' : ''}`}>
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

/** A DOM panel standing in the room, angled toward the viewer. */
function Panel({ position, yaw, children }: { position: [number, number, number]; yaw: number; children: ReactNode }) {
  return (
    <Html transform distanceFactor={2.45} position={position} rotation-y={yaw} zIndexRange={[12, 10]} className="holo-anchor">
      {children}
    </Html>
  )
}

function NeedsHolo({ go }: { go: (v: View) => void }) {
  const s = useHub((x) => x.state)
  const items = openItems(s?.items).slice(0, 4)
  return (
    <Holo title="Needs Markus" badge={<span className={`holo-count ${items.length ? 'need' : ''}`}>{openItems(s?.items).length}</span>} onOpen={() => go('needs')}>
      {items.length ? (
        items.map((i) => (
          <button key={i.id} className={`holo-row pri-${i.priority}`} onClick={() => go('needs')}>
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

function JobsHolo({ go }: { go: (v: View) => void }) {
  useTick(5000)
  const s = useHub((x) => x.state)
  const jobs = Object.values(s?.jobs ?? {})
    .filter((j) => ['running', 'needs_markus', 'retrying', 'cancel_requested', 'queued'].includes(j.state))
    .sort((a, b) => (b.heartbeatAt ?? b.updatedAt) - (a.heartbeatAt ?? a.updatedAt))
  const running = jobs.filter((j) => j.state === 'running').length
  return (
    <Holo title="Running" badge={<span className="holo-count">{running}</span>} onOpen={() => go('jobs')}>
      {jobs.slice(0, 5).map((j) => (
        <button key={j.id} className={`holo-row tone-${tone(j.state, j.stale)}`} onClick={() => go('jobs')}>
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
      {!jobs.length && <p className="holo-empty">Nothing running. Each running job flies round the core as a drone.</p>}
    </Holo>
  )
}

function BusinessHolo({ go }: { go: (v: View) => void }) {
  const s = useHub((x) => x.state)
  const am = s?.projects.automaton
  const ex = s?.expenses
  const req = s?.usage.requests
  const five = s?.usage.windows.five_hour
  const fiveFresh = five && (!five.resetsAt || five.resetsAt > Date.now())
  const stage = (k: string) => am?.sites?.filter((x) => x.stage === k).length ?? 0
  return (
    <Holo title="Business & money" wide onOpen={() => go('automaton')}>
      <div className="biz">
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">automaton.llc</span>
          <span className={`biz-v ${am?.site?.ok ? 'ok' : 'bad'}`}>{am?.site ? (am.site.ok ? `up · ${am.site.ms} ms` : 'not answering') : 'unchecked'}</span>
        </button>
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">Sites to review</span>
          <span className="biz-v">{am?.sites ? stage('needs_review') + stage('needs_edits') : '—'}</span>
        </button>
        <button className="biz-cell" onClick={() => go('automaton')}>
          <span className="biz-k">Leads</span>
          <span className="biz-v">{am?.leads ? am.leads.total : '—'}</span>
        </button>
        <button className="biz-cell" onClick={() => go('finance')}>
          <span className="biz-k">Spent this month</span>
          <span className="biz-v">{ex ? `$${ex.month.total.toFixed(2)}` : '—'}</span>
        </button>
        <button className="biz-cell" onClick={() => go('settings')}>
          <span className="biz-k">Claude 5h left</span>
          <span className="biz-v">{fiveFresh ? `${Math.round(100 - five!.usedPct)}% · ${until(five!.resetsAt)}` : 'unavailable'}</span>
        </button>
        <button className="biz-cell" onClick={() => go('settings')}>
          <span className="biz-k">JARVIS spend</span>
          <span className="biz-v">{req ? `$${req.costUsd.toFixed(2)}` : '—'}</span>
        </button>
      </div>
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

function Dock() {
  useTick(250)
  const turns = useStore((s) => s.turns)
  const caption = useStore((s) => s.caption)
  const phase = useStore((s) => s.phase)
  const last = turns.at(-1)
  const live = phase === 'listening' || phase === 'waking'
  const line = live && caption && caption !== '…' ? { you: true, text: caption } : last ? { you: last.role === 'user', text: last.text } : null
  return (
    <div className="st-dock">
      {line && <p className={`st-line ${line.you ? 'you' : 'him'}`}>{line.text}</p>}
      <VoiceWave size="large" />
    </div>
  )
}

export function Station() {
  const graphics = useHub((s) => s.prefs.graphics)
  const go = useHub((s) => s.go)
  const panels = (
    <>
      <Panel position={[-4.25, 2.0, 1.3]} yaw={0.4}>
        <Holo title="Terminal" onOpen={() => go('terminal')}>
          <TerminalFeed compact height={318} />
        </Holo>
      </Panel>
      <Panel position={[-4.2, 4.25, 0.7]} yaw={0.38}>
        <BusinessHolo go={go} />
      </Panel>
      <Panel position={[4.25, 4.0, 0.7]} yaw={-0.4}>
        <NeedsHolo go={go} />
      </Panel>
      <Panel position={[4.25, 1.85, 1.3]} yaw={-0.4}>
        <JobsHolo go={go} />
      </Panel>
    </>
  )
  return (
    <div className="station">
      <StationScene graphics={graphics} panels={panels} />
      <TopHud />
      <Dock />
      <p className="st-hint">Drag to look around · scroll to move closer · 1–9 dashboard views</p>
    </div>
  )
}
