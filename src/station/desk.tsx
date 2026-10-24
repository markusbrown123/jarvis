import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { hubActions, useHub, type CodeSession, type Idea } from '../hub/client'
import { ago } from '../hub/format'
import { useStore } from '../store'
import { typing } from './shared'
import { useStation } from './stationStore'

/**
 * The desk's working surfaces, beside talking to JARVIS:
 * - Claude Code: real sessions in a project folder (bridge/hub/code.mjs),
 *   streaming as they work, answered and stopped from here.
 * - Ideas: the board (bridge/hub/ideas.mjs) — caught by voice or typed here,
 *   developed with JARVIS, handed to Claude Code to build.
 */

const PROJECTS: [string, string][] = [
  ['jarvis', 'JARVIS'],
  ['automaton', 'Automaton'],
  ['roblox', 'Roblox'],
  ['finance', 'Finance'],
  ['other', 'Home folder'],
]
const projectName = (p: string) => PROJECTS.find(([id]) => id === p)?.[1] ?? p

/** Enter sends, Shift+Enter is a new line; every key lights the desk's keyboard. */
const keys = (send: () => void) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
  typing.at = performance.now()
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

// ------------------------------------------------------------ Claude Code

const MARK: Record<string, string> = { you: '›', tool: '⏺', out: '⎿', error: '⎿', note: '·', text: '' }

/** Claude's prose as the CLI shows it: code fences as blocks, `code` and **bold** inline. */
function Md({ text }: { text: string }) {
  const parts = text.split(/```[\w-]*\n?/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <pre key={i} className="st-code-pre">
            {part.replace(/\n$/, '')}
          </pre>
        ) : (
          <Inline key={i} text={part} />
        ),
      )}
    </>
  )
}
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((b, i) =>
        b.length > 2 && b.startsWith('`') && b.endsWith('`') ? <code key={i}>{b.slice(1, -1)}</code> : b.length > 4 && b.startsWith('**') && b.endsWith('**') ? <b key={i}>{b.slice(2, -2)}</b> : b,
      )}
    </>
  )
}

function CodeLog({ s }: { s: CodeSession }) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Follow the work as it lands, unless you've scrolled up to read.
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [s.lines.length, s.state])
  return (
    <div
      className="st-code-log"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      role="log"
      aria-live="polite"
    >
      {s.lines.map((l) => (
        <div key={l.n} className={`st-code-line k-${l.kind}`}>
          {MARK[l.kind] && <span className="st-code-mark">{MARK[l.kind]}</span>}
          <span className="st-code-text">{l.kind === 'text' ? <Md text={l.text} /> : l.text}</span>
        </div>
      ))}
      {s.state === 'working' && (
        <div className="st-code-line k-busy">
          <span className="st-code-mark">✻</span>
          <span className="st-code-text">Working…</span>
        </div>
      )}
    </div>
  )
}

function Approval({ s }: { s: CodeSession }) {
  const [busy, setBusy] = useState(false)
  if (!s.approval) return null
  const answer = async (allow: boolean) => {
    setBusy(true)
    try {
      await hubActions.codeApprove(s.id, s.approval!.id, allow)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="st-code-ask" role="alertdialog" aria-label="Claude Code is asking">
      <b>Claude Code wants to</b>
      <code className="st-code-ask-tool">{s.approval.tool}</code>
      {s.approval.detail && <pre>{s.approval.detail}</pre>}
      <div className="st-code-ask-do">
        <button className="go" disabled={busy} onClick={() => void answer(true)}>
          Allow once
        </button>
        <button disabled={busy} onClick={() => void answer(false)}>
          Deny
        </button>
      </div>
    </div>
  )
}

function NewSession({ onStarted }: { onStarted: (id: string) => void }) {
  const writes = useHub((s) => s.code.writes)
  const draft = useStation((s) => s.desk.draft)
  const setDesk = useStation((s) => s.setDesk)
  const [project, setProject] = useState(draft?.project ?? 'jarvis')
  const [prompt, setPrompt] = useState(draft?.prompt ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A draft handed over (an idea to build) fills the form once.
  useEffect(() => {
    if (!draft) return
    setProject(draft.project)
    setPrompt(draft.prompt)
    setDesk({ draft: null })
  }, [draft, setDesk])
  const start = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const { session } = await hubActions.codeStart(project, prompt)
      setPrompt('')
      onStarted(session.id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="st-code-new">
      <label>
        <span>Project</span>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {PROJECTS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={keys(() => void start())} placeholder="What should Claude Code do?" rows={5} aria-label="Task for Claude Code" spellCheck={false} />
      <p className="st-code-mode">{writes ? 'Write mode: it edits files and runs commands in the project.' : 'Read-only: anything that changes something asks you first.'}</p>
      {err && <p className="st-code-err">{err}</p>}
      <button className="st-code-go" disabled={!prompt.trim() || busy} onClick={() => void start()}>
        {busy ? 'Starting…' : 'Start Claude Code'}
      </button>
    </div>
  )
}

export function DeskCode() {
  const sessions = useHub((s) => s.code.sessions)
  const id = useStation((s) => s.desk.session)
  const setDesk = useStation((s) => s.setDesk)
  const s = sessions.find((x) => x.id === id) ?? null
  const [reply, setReply] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const busy = s?.state === 'working' || s?.state === 'approval'
  const send = async () => {
    if (!s || !reply.trim() || busy) return
    setErr(null)
    try {
      await hubActions.codeSend(s.id, reply)
      setReply('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="st-desk-pane st-code">
      <div className="st-code-tabs" role="tablist" aria-label="Claude Code sessions">
        <button role="tab" aria-selected={!s} className={!s ? 'on' : ''} onClick={() => setDesk({ session: null })}>
          + New
        </button>
        {sessions.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === s?.id} className={`${x.id === s?.id ? 'on' : ''} st-${x.state}`} onClick={() => setDesk({ session: x.id })} title={`${projectName(x.project)} · ${x.title}`}>
            <i />
            {projectName(x.project)} · {x.title}
          </button>
        ))}
      </div>
      {!s ? (
        <NewSession onStarted={(sid) => setDesk({ session: sid })} />
      ) : (
        <>
          <div className="st-code-where">
            <span title={s.cwd}>{s.cwd}</span>
            <span>
              {s.cost > 0 && `$${s.cost.toFixed(2)} · `}
              {ago(s.updatedAt)}
            </span>
            <button
              className="st-code-x"
              onClick={() => {
                void hubActions.codeClose(s.id)
                setDesk({ session: null })
              }}
              aria-label="Close this session"
              title="Close this session"
            >
              ×
            </button>
          </div>
          <CodeLog s={s} />
          <Approval s={s} />
          {err && <p className="st-code-err">{err}</p>}
          <form
            className="st-talk-input st-code-reply"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={keys(() => void send())} placeholder={busy ? 'Working — you can type the next thing' : 'Reply to Claude Code…'} rows={2} aria-label="Reply to Claude Code" spellCheck={false} />
            {busy ? (
              <button type="button" className="stop" onClick={() => void hubActions.codeStop(s.id)}>
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!reply.trim()}>
                Send
              </button>
            )}
          </form>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------ Ideas

const STATE_WORD: Record<Idea['state'], string> = { new: 'new', developing: 'developing', building: 'building', done: 'done', parked: 'parked' }

function IdeaCard({ i, open, toggle }: { i: Idea; open: boolean; toggle: () => void }) {
  const c = useStore((s) => s.controls)
  const setDesk = useStation((s) => s.setDesk)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [open])
  const develop = () => {
    void hubActions.ideaUpdate(i.id, { state: 'developing' })
    c.sendText(`Develop idea ${i.id}: "${i.title}". Put your notes on it on the board, then tell me the headline.`)
  }
  const build = () => {
    void hubActions.ideaUpdate(i.id, { state: 'building' })
    setDesk({ tab: 'code', session: null, draft: { project: i.project, prompt: `Build this idea:\n${i.text}${i.notes ? `\n\nNotes so far:\n${i.notes}` : ''}` } })
  }
  return (
    <article ref={ref} className={`st-idea s-${i.state}${open ? ' open' : ''}`}>
      <button className="st-idea-head" onClick={toggle} aria-expanded={open}>
        <b>{i.title}</b>
        <span className="st-idea-meta">
          <em>{STATE_WORD[i.state]}</em> {projectName(i.project)} · {ago(i.updatedAt)}
        </span>
      </button>
      {open && (
        <div className="st-idea-body">
          {i.text !== i.title && <p>{i.text}</p>}
          {i.notes ? <pre className="st-idea-notes">{i.notes}</pre> : <p className="st-idea-none">No notes yet — ask JARVIS to develop it.</p>}
          <div className="st-idea-do">
            <button className="go" onClick={develop}>
              Develop with JARVIS
            </button>
            <button onClick={build}>Build with Claude Code</button>
            {i.state !== 'done' && <button onClick={() => void hubActions.ideaUpdate(i.id, { state: 'done' })}>Done</button>}
            {i.state !== 'parked' ? (
              <button onClick={() => void hubActions.ideaUpdate(i.id, { state: 'parked' })}>Park</button>
            ) : (
              <button onClick={() => void hubActions.ideaUpdate(i.id, { state: 'new' })}>Reopen</button>
            )}
            <button className="del" onClick={() => void hubActions.ideaDelete(i.id)} aria-label={`Delete idea: ${i.title}`}>
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

export function DeskIdeas() {
  const ideas = useHub((s) => s.ideas)
  const openId = useStation((s) => s.desk.idea)
  const setDesk = useStation((s) => s.setDesk)
  const [text, setText] = useState('')
  const [project, setProject] = useState('jarvis')
  const [all, setAll] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const shown = ideas.filter((i) => all || (i.state !== 'done' && i.state !== 'parked'))
  const add = async () => {
    if (!text.trim()) return
    setErr(null)
    try {
      const { idea } = await hubActions.ideaAdd(text, project)
      setText('')
      setDesk({ idea: idea.id })
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="st-desk-pane st-ideas">
      <div className="st-idea-new">
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys(() => void add())} placeholder="An idea… (or just say “Jarvis, idea: …”)" rows={2} aria-label="New idea" />
        <div className="st-idea-new-do">
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            {PROJECTS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button className="go" disabled={!text.trim()} onClick={() => void add()}>
            Add
          </button>
          <span className="st-idea-filter">
            <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>
              Open
            </button>
            <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
              All {ideas.length}
            </button>
          </span>
        </div>
        {err && <p className="st-code-err">{err}</p>}
      </div>
      <div className="st-idea-list">
        {!shown.length && <p className="st-talk-empty">{ideas.length ? 'Nothing open — see All.' : 'No ideas yet. Say one, or type it above.'}</p>}
        {shown.map((i) => (
          <IdeaCard key={i.id} i={i} open={i.id === openId} toggle={() => setDesk({ idea: i.id === openId ? null : i.id })} />
        ))}
      </div>
    </div>
  )
}
