import { useEffect, useRef, useState } from 'react'
import { useHub, hubActions, fileUrl, type Gallery, type GalleryItem } from '../hub/client'
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

const PAGE = 48

/**
 * Everything the studio has committed as evidence for a game — world renders,
 * maps, every UI screen by device, 4K UI, characters, props — listed from git
 * and fetched picture by picture as they come into view. Each is labelled
 * with what it is: renders and previews, not gameplay.
 */
function GameGallery({ id, title }: { id: string; title: string }) {
  const [data, setData] = useState<Gallery | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState(0)
  const [device, setDevice] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [files, setFiles] = useState<Record<string, string | null>>({})
  const [open, setOpen] = useState<number | null>(null)
  const asked = useRef(new Set<string>())
  useEffect(() => {
    let live = true
    hubActions
      .robloxGallery(id)
      .then((g) => live && setData(g))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [id])
  const sections = data?.sections ?? []
  const section = sections[Math.min(tab, sections.length - 1)]
  const devices = section ? [...new Set(section.items.map((i) => i.device).filter((d): d is string => Boolean(d)))] : []
  const dev = device && devices.includes(device) ? device : (devices[0] ?? null)
  const items = section ? section.items.filter((i) => !dev || i.device === dev) : []
  const visible = items.slice(0, shown)
  const want = [...visible, ...(open !== null && items[open] ? [items[open]] : [])].map((i) => i.sha)
  const wantKey = want.join(',')
  // Copy the pictures in view out of git, once each.
  useEffect(() => {
    const fresh = wantKey.split(',').filter((sha) => sha && !asked.current.has(sha))
    if (!fresh.length) return
    for (const sha of fresh) asked.current.add(sha)
    hubActions
      .robloxImages(fresh)
      .then((r) => setFiles((f) => ({ ...f, ...Object.fromEntries(fresh.map((sha) => [sha, r.files[sha] ?? null])) })))
      .catch(() => fresh.forEach((sha) => asked.current.delete(sha)))
  }, [wantKey])
  // Arrow keys step through the open picture; Esc closes it.
  useEffect(() => {
    if (open === null) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      else if (e.key === 'ArrowRight') setOpen((o) => (o === null ? o : Math.min(items.length - 1, o + 1)))
      else if (e.key === 'ArrowLeft') setOpen((o) => (o === null ? o : Math.max(0, o - 1)))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open, items.length])
  const total = sections.reduce((n, x) => n + x.items.length, 0)
  const pick = (i: number) => {
    setTab(i)
    setShown(PAGE)
    setOpen(null)
  }
  const big: GalleryItem | undefined = open !== null ? items[open] : undefined
  return (
    <section className="card gallery">
      <header className="card-head">
        <h3>{title}</h3>
        <span className="muted">{data ? `${total} pictures · studio evidence @ ${data.revision ?? '—'}` : error ? `Couldn't list: ${error}` : 'Listing…'}</span>
      </header>
      {data && !sections.length && <p className="muted">Nothing committed for this one yet.</p>}
      {sections.length > 0 && (
        <>
          <div className="preview-tabs" role="tablist">
            {sections.map((x, i) => (
              <button key={x.id + x.title} role="tab" aria-selected={x === section} className={`tab ${x === section ? 'on' : ''}`} onClick={() => pick(i)}>
                {x.title} <span className="mono muted">{x.items.length}</span>
              </button>
            ))}
          </div>
          {devices.length > 1 && (
            <div className="asset-pick">
              {devices.map((d) => (
                <button key={d} className={`tab ${d === dev ? 'on' : ''}`} onClick={() => (setDevice(d), setShown(PAGE))}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {section?.note && <p className="muted gallery-note">{section.note}</p>}
          <div className="gallery-grid">
            {visible.map((it, i) => (
              <button key={it.sha + it.path} className="gallery-cell" onClick={() => setOpen(i)} title={it.path}>
                {files[it.sha] ? <img src={fileUrl(files[it.sha]!)} alt={it.label} loading="lazy" /> : <span className="gallery-wait">{files[it.sha] === null ? 'unavailable' : ''}</span>}
                <span className="gallery-cap">{it.label}</span>
              </button>
            ))}
          </div>
          {items.length > shown && (
            <button className="btn gallery-more" onClick={() => setShown(shown + PAGE)}>
              Show more ({items.length - shown})
            </button>
          )}
        </>
      )}
      {big && (
        <div className="lightbox" role="dialog" aria-label={big.label} onClick={() => setOpen(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            {files[big.sha] ? <img src={fileUrl(files[big.sha]!)} alt={big.label} /> : <div className="gallery-wait big" />}
            <figcaption>
              <span>
                {section?.title}
                {big.device ? ` · ${big.device}` : ''} · {big.label}
              </span>
              <span className="muted mono">
                {open! + 1}/{items.length} · {big.path}
              </span>
            </figcaption>
            <div className="lightbox-nav">
              <button className="btn" disabled={open === 0} onClick={() => setOpen(open! - 1)}>
                ← Prev
              </button>
              <button className="btn" onClick={() => setOpen(null)}>
                Close
              </button>
              <button className="btn" disabled={open === items.length - 1} onClick={() => setOpen(open! + 1)}>
                Next →
              </button>
            </div>
          </figure>
        </div>
      )}
    </section>
  )
}

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

      <GameGallery id={game.id} title="Gallery" />

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
  const [studioOpen, setStudioOpen] = useState(false)
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
      <details className="studio-wide" onToggle={(e) => setStudioOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Studio-wide pictures (people, style bible, blind tests)</summary>
        {studioOpen && <GameGallery id="_studio" title="Studio-wide" />}
      </details>
    </div>
  )
}
