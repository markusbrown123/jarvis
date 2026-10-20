import { useMemo, useState } from 'react'
import { useHub } from '../hub/client'
import { ago, clock } from '../hub/format'
import { useStore, type TalkMode } from '../store'
import { micLevel, micName } from '../lib/audio'
import { timingSummary, type Stat } from '../lib/metrics'
import { ItemCard, Empty } from './shared'
import { openItems, useTick } from './state'
import { UsagePanel } from './Usage'

export function Needs() {
  const s = useHub((x) => x.state)
  const [all, setAll] = useState(false)
  const items = openItems(s?.items, all)
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Needs Markus</h1>
          <p className="muted">Only things JARVIS can’t do for you. Each one says what, why, where, and how it’s checked.</p>
        </div>
        <div className="tabs">
          <button className={`tab ${!all ? 'on' : ''}`} onClick={() => setAll(false)}>
            Open
          </button>
          <button className={`tab ${all ? 'on' : ''}`} onClick={() => setAll(true)}>
            All
          </button>
        </div>
      </header>
      <div className="needs-list">
        {items.length ? items.map((i) => <ItemCard key={i.id} item={i} full />) : <Empty title="Nothing needs you right now" />}
      </div>
    </div>
  )
}

export function Activity() {
  const s = useHub((x) => x.state)
  const [q, setQ] = useState('')
  const [project, setProject] = useState('all')
  const [level, setLevel] = useState('all')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...(s?.activity ?? [])]
      .reverse()
      .filter((a) => (project === 'all' || a.project === project) && (level === 'all' || a.level === level))
      .filter((a) => !needle || `${a.title} ${a.detail}`.toLowerCase().includes(needle))
      .slice(0, 300)
  }, [s, q, project, level])
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Completions, failures and changes from every source, newest first.</p>
        </div>
      </header>
      <div className="filters">
        <input className="input" placeholder="Search activity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" />
        <select className="input" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          {['all', 'roblox', 'automaton', 'finance', 'jarvis', 'other'].map((p) => (
            <option key={p} value={p}>
              {p === 'all' ? 'All projects' : p}
            </option>
          ))}
        </select>
        <select className="input" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
          {['all', 'error', 'warn', 'success', 'info'].map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All levels' : l}
            </option>
          ))}
        </select>
      </div>
      <ol className="activity">
        {rows.map((a) => (
          <li key={a.id} className={`act act-${a.level}`}>
            <span className="act-time mono" title={new Date(a.ts).toLocaleString()}>
              {clock(a.ts)}
            </span>
            <span className="act-project">{a.project ?? a.source}</span>
            <span className="act-title">{a.title}</span>
            {a.detail && a.detail !== a.title && <span className="act-detail">{a.detail}</span>}
          </li>
        ))}
        {!rows.length && <Empty title="No matching activity" />}
      </ol>
    </div>
  )
}

function StatRow({ name, s, target }: { name: string; s: Stat; target: string }) {
  return (
    <div className="usage-row">
      <div className="usage-name">{name}</div>
      <div className="usage-value">
        {s ? (
          <>
            median <b className="mono">{(s.median / 1000).toFixed(2)}s</b> · p95 <b className="mono">{(s.p95 / 1000).toFixed(2)}s</b>{' '}
            <span className="muted">· {s.n} turns · target {target}</span>
          </>
        ) : (
          <span className="muted">No turns measured yet</span>
        )}
      </div>
    </div>
  )
}

export function Settings() {
  useTick(500)
  const s = useHub((x) => x.state)
  const prefs = useHub((x) => x.prefs)
  const setPrefs = useHub((x) => x.setPrefs)
  const talkMode = useStore((x) => x.talkMode)
  const setTalkMode = useStore((x) => x.setTalkMode)
  const micArmed = useStore((x) => x.micArmed)
  const controls = useStore((x) => x.controls)
  const t = timingSummary()
  const level = micLevel()
  const rb = s?.projects.roblox
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>
      <div className="settings-grid">
        <section className="card">
          <header className="card-head">
            <h3>Voice</h3>
          </header>
          <label className="field">
            <span>Talk mode</span>
            <select className="input" value={talkMode} onChange={(e) => setTalkMode(e.target.value as TalkMode)}>
              <option value="auto">Auto — “Hey Jarvis”, ends when you pause</option>
              <option value="hold">Hold to talk — hold Space</option>
              <option value="tap">Tap to start / finish — Space</option>
            </select>
          </label>
          <div className="field">
            <span>Microphone</span>
            <div className="field-row">
              <span className="mono">{micArmed ? micName() || 'starting…' : 'off (released)'}</span>
              <button className="btn" onClick={() => controls.setMicArmed(!micArmed)}>
                {micArmed ? 'Turn off' : 'Turn on'}
              </button>
            </div>
            <div className="meter-h">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <span className="fine">The built-in Mac microphone is preferred automatically over an iPhone or AirPods.</span>
          </div>
          <div className="field">
            <span>Measured on this browser</span>
            <StatRow name="End of speech → endpoint" s={t.endpoint} target="0.7–1.2s ordinary pause" />
            <StatRow name="End of speech → first words" s={t.firstText} target="—" />
            <StatRow name="End of speech → voice starts" s={t.firstSound} target="1.5–2.5s" />
          </div>
          <p className="fine">Keys: Space talk · Enter finish speaking · M mic on/off · Esc stand down · D diagnostics · T audio test · ⌘K commands</p>
        </section>

        <section className="card">
          <header className="card-head">
            <h3>Appearance</h3>
          </header>
          <label className="check">
            <input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.checked })} />
            Reduced motion
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.lowPower} onChange={(e) => setPrefs({ lowPower: e.target.checked })} />
            Low power (no glow effects, fewer particles, lower resolution)
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.navCollapsed} onChange={(e) => setPrefs({ navCollapsed: e.target.checked })} />
            Collapse the left navigation
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.needsCollapsed} onChange={(e) => setPrefs({ needsCollapsed: e.target.checked })} />
            Collapse the Needs Markus panel
          </label>
          <button className="btn" onClick={() => setPrefs({ immersive: true })}>
            Open the immersive voice view
          </button>
        </section>

        <UsagePanel usage={s?.usage} />

        <section className="card">
          <header className="card-head">
            <h3>Integrations</h3>
          </header>
          <div className="usage-row">
            <div className="usage-name">Roblox studio</div>
            <div className="usage-value">
              {rb?.source ? `Read ${ago(rb.source.fetchedAt)} from ${rb.source.path}` : rb?.error ? `Failing: ${rb.error}` : 'Not read yet'}
            </div>
          </div>
          <div className="usage-row">
            <div className="usage-name">Automaton</div>
            <div className="usage-value">
              {s?.projects.automaton?.repo?.path ?? 'Folder not found'} · database: {s?.projects.automaton?.sites ? 'read-only access working' : s?.projects.automaton?.sitesError ?? 'not connected'}
            </div>
          </div>
          <div className="usage-row">
            <div className="usage-name">Claude Code</div>
            <div className="usage-value">
              Status line {s?.usage.statusLine ? `received ${ago(s.usage.statusLine.at)}` : 'not connected'} · hooks{' '}
              {s?.usage.sources.hooks ? `received ${ago(s.usage.sources.hooks)}` : 'not connected'}
            </div>
          </div>
          <p className="fine">Project paths and links live in ~/.jarvis/projects.json. Press D for live voice diagnostics.</p>
        </section>
      </div>
    </div>
  )
}
