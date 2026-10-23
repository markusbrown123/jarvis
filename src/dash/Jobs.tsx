import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { Job } from '../hub/types'
import { ago, elapsed, JOB_LABEL, tone } from '../hub/format'
import { Chip, Empty } from './shared'
import { useTick } from './state'

/**
 * Every job the hub knows, grouped by who runs it, with what it is doing now,
 * its result when it has one, and a Cancel button only where cancelling is
 * real (JARVIS's own background jobs). Studio tasks and Claude Code sessions
 * are stopped where they run, and the row says so.
 */

const GROUPS: { source: string; title: string; note: string }[] = [
  { source: 'jarvis', title: 'JARVIS background jobs', note: 'Started by voice or below. Cancellable.' },
  { source: 'claude', title: 'Claude Code sessions', note: 'From Claude Code hooks. Stop them in their own window.' },
  { source: 'roblox', title: 'Roblox studio tasks', note: 'From the studio queue. Run by the Windows PC and cloud workers.' },
  { source: 'worker', title: 'Other workers', note: 'Reported by a worker script.' },
]

const DONE = new Set(['completed', 'canceled', 'failed'])

export function JobCard({ job }: { job: Job }) {
  const [open, setOpen] = useState(job.source === 'jarvis' && !DONE.has(job.state))
  const [busy, setBusy] = useState(false)
  const t = tone(job.state, job.stale)
  const canCancel = job.cancel === 'supported' && (job.state === 'running' || job.state === 'queued')
  return (
    <article className={`jobcard tone-${t}`}>
      <header className="jobcard-head" onClick={() => setOpen(!open)}>
        <span className="job-dot" />
        <div className="jobcard-main">
          <div className="job-title">
            {job.taskId && <span className="mono job-id">{job.taskId}</span>} {job.title}
          </div>
          <div className="job-sub">
            <Chip tone={t}>{JOB_LABEL[job.state] ?? job.state}</Chip>
            {job.stale && <Chip tone="need">no heartbeat</Chip>}
            <span>
              {job.worker ?? job.source} · {job.project}
              {job.state === 'running' && ` · running ${elapsed(job.lease?.claimedAt ?? job.createdAt)}`} · updated {ago(job.heartbeatAt ?? job.updatedAt)}
            </span>
          </div>
        </div>
        {canCancel && (
          <button
            className="btn btn-warn"
            disabled={busy}
            onClick={async (e) => {
              e.stopPropagation()
              setBusy(true)
              try {
                await hubActions.cancelJob(job.id)
                useHub.getState().say('Cancellation requested')
              } catch (err) {
                useHub.getState().say((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Cancel
          </button>
        )}
      </header>
      {open && (
        <div className="jobcard-body">
          {job.stage && <div className="job-line"><b>Now:</b> {job.stage}</div>}
          {job.nextStep && <div className="job-line"><b>Next:</b> {job.nextStep}</div>}
          {job.blocker && <div className="job-line warn"><b>Blocked:</b> {job.blocker}</div>}
          {job.summary && <div className="job-line"><b>Task:</b> {job.summary}</div>}
          {job.cwd && <div className="job-line mono small">{job.cwd}</div>}
          {job.revision && <div className="job-line small">Revision {job.revision}</div>}
          {job.output && (
            <pre className="job-output" aria-label="Result">
              {job.output}
            </pre>
          )}
          {job.cancel !== 'supported' && !DONE.has(job.state) && <p className="fine">Not cancellable from here — stop it where it runs.</p>}
        </div>
      )}
    </article>
  )
}

function StartJob() {
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('other')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="card startjob"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await hubActions.startJob(title, project, instructions)
          useHub.getState().say('Background job started')
          setTitle('')
          setInstructions('')
        } catch (err) {
          useHub.getState().say((err as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <header className="card-head">
        <h3>Start a background job</h3>
        <span className="muted small">Runs in the project’s folder with JARVIS’s permissions; never sends, deploys or pays.</span>
      </header>
      <div className="startjob-row">
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Job title" />
        <select className="input" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="roblox">Roblox</option>
          <option value="automaton">Automaton</option>
          <option value="finance">Finance</option>
          <option value="other">Other</option>
        </select>
      </div>
      <textarea
        className="input"
        rows={3}
        placeholder="What should it do? e.g. Read the Turbo playtest notes and list the three most important open problems."
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        aria-label="Instructions"
      />
      <button className="btn btn-primary" disabled={busy || !title.trim() || !instructions.trim()}>
        {busy ? 'Starting…' : 'Start job'}
      </button>
    </form>
  )
}

export function Jobs() {
  useTick(5000)
  const s = useHub((x) => x.state)
  const [all, setAll] = useState(false)
  const jobs = Object.values(s?.jobs ?? {}).sort((a, b) => (b.heartbeatAt ?? b.updatedAt) - (a.heartbeatAt ?? a.updatedAt))
  const shown = jobs.filter((j) => all || !DONE.has(j.state) || Date.now() - j.updatedAt < 3600000)
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted">Everything running, waiting or recently finished, from every worker.</p>
        </div>
        <div className="tabs">
          <button className={`tab ${!all ? 'on' : ''}`} onClick={() => setAll(false)}>
            Active + last hour
          </button>
          <button className={`tab ${all ? 'on' : ''}`} onClick={() => setAll(true)}>
            All
          </button>
        </div>
      </header>
      <StartJob />
      {GROUPS.map((g) => {
        const list = shown.filter((j) => (j.source === g.source) || (g.source === 'worker' && !['jarvis', 'claude', 'roblox'].includes(j.source)))
        if (!list.length) return null
        return (
          <section key={g.source} className="jobgroup">
            <header className="card-head">
              <h3>
                {g.title} <span className="mono muted">{list.length}</span>
              </h3>
              <span className="muted small">{g.note}</span>
            </header>
            {list.slice(0, 60).map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </section>
        )
      })}
      {!shown.length && <Empty title="No jobs" />}
    </div>
  )
}
