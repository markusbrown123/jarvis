import { useEffect, useMemo, useRef, useState } from 'react'
import { useHub } from '../hub/client'
import { useStore } from '../store'
import type { TermLine } from '../hub/types'

/**
 * The terminal: one line for everything happening right now — what Markus
 * said, every tool JARVIS reaches for, each step of a background job, the
 * files his Claude Code sessions are editing, phone messages, studio events.
 * Typing at the prompt talks to JARVIS, same as the conversation bar.
 */

type Filter = 'all' | 'voice' | 'jobs' | 'code' | 'phone' | 'studio' | 'errors'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'voice', label: 'Voice' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'code', label: 'Code' },
  { id: 'phone', label: 'Phone' },
  { id: 'studio', label: 'Studio' },
  { id: 'errors', label: 'Errors' },
]

function matches(l: TermLine, f: Filter) {
  if (f === 'all') return true
  if (f === 'voice') return l.src === 'voice'
  if (f === 'jobs') return l.src.startsWith('job:') || l.src === 'jarvis' || l.src === 'worker'
  if (f === 'code') return l.src.startsWith('claude')
  if (f === 'phone') return l.src === 'phone'
  if (f === 'errors') return l.kind === 'error' || l.kind === 'warn'
  return l.src === 'roblox'
}

function tag(src: string) {
  if (src.startsWith('job:')) return ['JOB', src.slice(4)]
  if (src.startsWith('claude:')) return ['CODE', src.slice(7)]
  if (src === 'claude') return ['CODE', '']
  if (src === 'roblox') return ['STUDIO', '']
  return [src.toUpperCase(), '']
}

const hhmmss = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** Narrowing the feed to one thing (the station's selection), with a way out. */
export type TermFocus = { label: string; test: (l: TermLine) => boolean; clear: () => void }

export function TerminalFeed({ compact = false, height, focus }: { compact?: boolean; height?: number; focus?: TermFocus | null }) {
  const term = useHub((s) => s.term)
  const c = useStore((s) => s.controls)
  const phase = useStore((s) => s.phase)
  const [filter, setFilter] = useState<Filter>('all')
  const [cleared, setCleared] = useState(0)
  const [text, setText] = useState('')
  const [pinned, setPinned] = useState(true)
  const body = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => term.filter((l) => l.id > cleared && matches(l, filter) && (!focus || focus.test(l))).slice(compact ? -80 : -400), [term, cleared, filter, compact, focus])

  useEffect(() => {
    const el = body.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [lines, pinned])

  return (
    <div className={`term ${compact ? 'term-compact' : ''}`} style={height ? { height } : undefined}>
      <div className="term-head">
        <span className="term-title">
          <span className="term-lights" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          jarvis — live
        </span>
        <span className="term-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`term-filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>
      {focus && (
        <div className="term-focus">
          <span>
            Lines about <b>{focus.label}</b>
          </span>
          <button onClick={focus.clear}>show all</button>
        </div>
      )}
      <div
        className="term-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
        }}
      >
        {lines.map((l) => {
          const [k, sub] = tag(l.src)
          return (
            <div key={l.id} className={`tl tl-${l.kind}`}>
              <span className="tl-ts">{hhmmss(l.ts)}</span>
              <span className={`tl-src tl-src-${k.toLowerCase()}`}>
                {k}
                {sub && <em>·{sub}</em>}
              </span>
              <span className="tl-text">{l.text}</span>
            </div>
          )
        })}
        {!lines.length && <div className="tl tl-history tl-empty">{focus ? `Nothing in the recent feed about ${focus.label}.` : 'Nothing yet. Talk to JARVIS, start a job, or open Claude Code — it all shows up here.'}</div>}
        <div className="tl tl-cursor">
          <span className="tl-ts">{hhmmss(Date.now())}</span>
          <span className="tl-text">
            {phase === 'thinking' || phase === 'tooling' ? 'working' : 'ready'}
            <span className="term-caret" />
          </span>
        </div>
      </div>
      {!pinned && (
        <button className="term-jump" onClick={() => setPinned(true)}>
          ↓ live
        </button>
      )}
      <form
        className="term-input"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          if (t === '/clear') setCleared(term.at(-1)?.id ?? 0)
          else c.sendText(t)
          setText('')
          setPinned(true)
        }}
      >
        <span className="term-prompt">jarvis ❯</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={compact ? 'ask or instruct…' : 'ask or instruct JARVIS — /clear to clear'} aria-label="Terminal input" spellCheck={false} />
      </form>
    </div>
  )
}

export function Terminal() {
  return (
    <div className="view view-terminal">
      <header className="view-head">
        <div>
          <h1>Terminal</h1>
          <p className="muted">Everything JARVIS, its background jobs, your Claude Code sessions and your phone are doing — as it happens.</p>
        </div>
      </header>
      <TerminalFeed />
    </div>
  )
}
