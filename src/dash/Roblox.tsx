import { useState } from 'react'
import { useHub, hubActions, fileUrl } from '../hub/client'
import type { Game, Job } from '../hub/types'
import { ago, clock, elapsed, JOB_LABEL, until, tone } from '../hub/format'
import { Chip, Empty } from './shared'
import { copy, useTick } from './state'

/**
 * The Roblox studio, as its own queue and repo describe it.
 *
 * Preview modes are labelled for what they are. LIVE GAMEPLAY needs a running
 * Studio session streamed from the Windows PC and says so when there is none;
 * LAST PLAYTEST is the dated report the tester wrote; ASSET is a committed
 * render with its revision. Nothing here is presented as gameplay that isn't.
 */

type Mode = 'LIVE' | 'LAST_PLAYTEST' | 'ASSET'

function JobRow({ job }: { job: Job }) {
  const t = tone(job.state, job.stale)
  return (
    <div className={`job tone-${t}`}>
      <span className="job-dot" />
      <div className="job-main">
        <div className="job-title">
          <span className="mono job-id">{job.taskId}</span> {job.title}
        </div>
        <div className="job-sub">
          {JOB_LABEL[job.state]}
          {job.stale && ' · no heartbeat (lease expired)'}
          {job.worker && ` · ${job.worker}`}
          {job.lease && job.state === 'running' && ` · lease ${job.lease.expiresAt > Date.now() ? `ends in ${until(job.lease.expiresAt)}` : 'expired'}`}
          {job.state === 'running' && job.lease && ` · running ${elapsed(job.lease.claimedAt)}`}
          {job.revision && ` · ${job.revision}`}
          {` · updated ${ago(job.updatedAt)}`}
        </div>
        {job.stage && job.stage !== 'initial' && <div className="job-line"><b>Now:</b> {job.stage}</div>}
        {job.nextStep && <div className="job-line"><b>{job.state === 'waiting' ? 'Blocked:' : 'Next:'}</b> {job.nextStep}</div>}
      </div>
    </div>
  )
}

function GameCard({ game, selected, onPick, jobs }: { game: Game; selected: boolean; onPick: () => void; jobs: Job[] }) {
  const running = jobs.filter((j) => j.state === 'running')
  const waiting = jobs.filter((j) => j.state === 'waiting' || j.stale)
  const img = game.art.thumbnail ?? game.art.hero ?? game.art.icon
  return (
    <button className={`game ${selected ? 'selected' : ''}`} onClick={onPick}>
      <div className="game-thumb">{img ? <img src={fileUrl(img)} alt="" loading="lazy" /> : <span className="game-noart">No render yet</span>}</div>
      <div className="game-body">
        <div className="game-name">{game.name}</div>
        <div className="game-chips">
          {game.active && <Chip tone="work">Active</Chip>}
          {game.next && <Chip tone="idle">Up next</Chip>}
          {running.length > 0 && <Chip tone="work">{running.length} running</Chip>}
          {waiting.length > 0 && <Chip tone="need">{waiting.length} blocked</Chip>}
          {!game.published && <Chip tone="off">Not published</Chip>}
        </div>
        <div className="game-sub">
          {game.playtest?.latest ? `Last playtest ${game.playtest.latest.date}` : 'No Studio playtest report'} · {game.tasks.done} tasks done
        </div>
      </div>
    </button>
  )
}

function Stage({ label, state, note }: { label: string; state: 'done' | 'partial' | 'no' | 'unknown'; note?: string }) {
  const mark = { done: '●', partial: '◐', no: '○', unknown: '?' }[state]
  return (
    <div className={`stage stage-${state}`} title={note}>
      <span className="stage-mark">{mark}</span>
      <span>{label}</span>
      {note && <span className="stage-note">{note}</span>}
    </div>
  )
}

function GameDetail({ game, jobs }: { game: Game; jobs: Job[] }) {
  const s = useHub((x) => x.state)
  const project = s?.projects.roblox
  const previews = Object.values(s?.previews ?? {}).filter((p) => p.game === game.id && p.kind === 'ASSET')
  const [mode, setMode] = useState<Mode>(previews.length ? 'ASSET' : 'LAST_PLAYTEST')
  const [big, setBig] = useState(false)
  const [which, setWhich] = useState(0)
  const pt = game.playtest
  const open = jobs.filter((j) => j.state !== 'completed').sort((a, b) => (a.state === 'running' ? -1 : 0) - (b.state === 'running' ? -1 : 0))
  const done = jobs.filter((j) => j.state === 'completed').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)
  const backlog = (project?.backlog ?? []).filter((b) => b.startsWith(game.id))
  const shown = previews[Math.min(which, previews.length - 1)]

  return (
    <div className="game-detail">
      <header className="detail-head">
        <div>
          <h2>{game.name}</h2>
          {game.tagline && <p className="muted">“{game.tagline}”</p>}
        </div>
        <div className="detail-actions">
          {project?.pcSession && (
            <a className="btn" href={project.pcSession} target="_blank" rel="noreferrer">
              Open PC session ↗
            </a>
          )}
          <button className="btn" onClick={() => copy(`games/${game.id}`)}>
            Copy project path
          </button>
        </div>
      </header>

      <div className="stages">
        <Stage label="Code written" state="done" />
        <Stage label="Statically checked" state={/STATICALLY CHECKED/i.test(game.readmeStatus ?? '') || (pt?.staticallyChecked ?? 0) > 0 ? 'done' : 'unknown'} />
        <Stage label="Studio playtest" state={pt?.latest ? ((pt.runtimeVerified ?? 0) > 0 ? 'done' : 'partial') : 'no'} note={pt?.latest ? pt.latest.date : undefined} />
        <Stage label="Runtime verified" state={(pt?.runtimeVerified ?? 0) > 0 ? 'partial' : 'no'} note={pt ? `${pt.runtimeVerified} findings` : undefined} />
        <Stage label="Published" state={game.published ? 'done' : 'no'} note={game.published ? `place ${game.placeId}` : 'no place id yet'} />
      </div>

      <section className={`preview ${big ? 'preview-big' : ''}`}>
        <div className="preview-tabs" role="tablist">
          {(['LIVE', 'LAST_PLAYTEST', 'ASSET'] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`tab ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              {m === 'LIVE' ? 'Live gameplay' : m === 'LAST_PLAYTEST' ? 'Last playtest' : `Assets (${previews.length})`}
            </button>
          ))}
          <button className="btn btn-quiet preview-expand" onClick={() => setBig(!big)}>
            {big ? 'Close' : 'Expand'}
          </button>
        </div>
        <div className="preview-body">
          {mode === 'LIVE' && (
            <Empty title="Live gameplay — offline">
              {project?.live?.reason ?? 'No live capture is connected.'} Open the game in Roblox Studio on the Windows PC to play it.
            </Empty>
          )}
          {mode === 'LAST_PLAYTEST' &&
            (pt?.latest ? (
              <div className="playtest">
                <div className="mode-tag">LAST PLAYTEST · {pt.latest.date}</div>
                <h3>{pt.latest.heading}</h3>
                <div className="playtest-stats">
                  <span><b className="mono">{pt.pass}</b> PASS</span>
                  <span><b className="mono">{pt.fail}</b> FAIL</span>
                  <span><b className="mono">{pt.runtimeVerified}</b> runtime verified</span>
                  <span><b className="mono">{pt.staticallyChecked}</b> statically checked only</span>
                </div>
                <p className="muted">From evidence/playtests/{game.id}.md at {project?.source?.commit.short}. Counts are of the words in the report, not a score.</p>
              </div>
            ) : (
              <Empty title="No Studio playtest report yet">This game has not been run in Roblox Studio by the tester.</Empty>
            ))}
          {mode === 'ASSET' &&
            (shown?.file ? (
              <figure className="asset">
                <div className="mode-tag">
                  ASSET · {shown.title} · {shown.revision} · {clock(shown.capturedAt)}
                </div>
                <img src={fileUrl(shown.file)} alt={`${game.name} ${shown.title}`} />
                <figcaption className="muted">{shown.note}</figcaption>
                {previews.length > 1 && (
                  <div className="asset-pick">
                    {previews.map((p, i) => (
                      <button key={p.id} className={`tab ${i === which ? 'on' : ''}`} onClick={() => setWhich(i)}>
                        {p.title.replace(' render', '')}
                      </button>
                    ))}
                  </div>
                )}
              </figure>
            ) : (
              <Empty title="No renders committed for this game" />
            ))}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h3>Work on this game</h3>
          <span className="muted">from queue/tasks.json</span>
        </header>
        {open.length ? open.map((j) => <JobRow key={j.id} job={j} />) : <p className="muted">No open tasks.</p>}
        {backlog.length > 0 && (
          <div className="backlog">
            <div className="backlog-h">Backlog</div>
            {backlog.map((b) => (
              <div key={b} className="backlog-line">{b.replace(`${game.id}: `, '')}</div>
            ))}
          </div>
        )}
        {done.length > 0 && (
          <details className="done-list">
            <summary>Recently finished ({done.length})</summary>
            {done.map((j) => <JobRow key={j.id} job={j} />)}
          </details>
        )}
      </section>
    </div>
  )
}

export function Roblox() {
  useTick(15000)
  const s = useHub((x) => x.state)
  const prefs = useHub((x) => x.prefs)
  const setPrefs = useHub((x) => x.setPrefs)
  const [refreshing, setRefreshing] = useState(false)
  const p = s?.projects.roblox
  if (!p) return <Empty title="Reading the Roblox studio…">The first read fetches the studio queue from GitHub.</Empty>
  // Active and busy games first, then the most worked-on.
  const games = [...(p.games ?? [])].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.tasks.running - a.tasks.running ||
      Number(b.next) - Number(a.next) ||
      b.tasks.blocked - a.tasks.blocked ||
      b.tasks.done - a.tasks.done,
  )
  const jobs = Object.values(s!.jobs).filter((j) => j.project === 'roblox' && j.source === 'roblox')
  const game = games.find((g) => g.id === prefs.selectedGame) ?? games.find((g) => g.active) ?? games[0]
  return (
    <div className="view view-roblox">
      <header className="view-head">
        <div>
          <h1>Roblox Studio</h1>
          <p className="muted">
            {p.source ? (
              <>
                {p.source.branch} @ <span className="mono">{p.source.commit.short}</span> “{p.source.commit.subject.slice(0, 60)}” · pushed {ago(p.source.commit.committedAt)} · read {ago(p.source.fetchedAt)}
              </>
            ) : (
              'Not read yet'
            )}
          </p>
          {p.error && <p className="warn">Last read failed: {p.error}</p>}
        </div>
        <div className="detail-actions">
          <Chip tone={p.worker && Date.now() - p.worker.lastSeenAt < 3600000 ? 'ok' : 'off'} title="Last push from the studio workers">
            {p.worker?.name ?? 'Worker'} · last push {ago(p.worker?.lastSeenAt)}
          </Chip>
          <button
            className="btn"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              await hubActions.refresh('roblox').catch((e) => useHub.getState().say(e.message))
              setRefreshing(false)
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>
      <div className="roblox-layout">
        <div className="game-grid">
          {games.map((g) => (
            <GameCard key={g.id} game={g} selected={g.id === game?.id} onPick={() => setPrefs({ selectedGame: g.id })} jobs={jobs.filter((j) => j.game === g.id)} />
          ))}
        </div>
        {game ? <GameDetail key={game.id} game={game} jobs={jobs.filter((j) => j.game === game.id)} /> : <Empty title="No games found" />}
      </div>
    </div>
  )
}
