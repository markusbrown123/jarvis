import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { MemoryFact } from '../hub/types'
import { ago } from '../hub/format'

/**
 * Settings → Memory: everything JARVIS carries from one session to the next.
 * Lessons (from mistakes and corrections) first, then saved facts by topic,
 * then the conversation log. Every item can be deleted; nothing is hidden.
 */

async function act(fn: () => Promise<unknown>, done: string) {
  try {
    await fn()
    useHub.getState().say(done)
  } catch (err) {
    useHub.getState().say((err as Error).message)
  }
}

function Fact({ f }: { f: MemoryFact }) {
  return (
    <li className="mem-fact">
      <span className="mem-text">{f.text}</span>
      <span className="mem-meta">
        {f.topic.replace(/^lesson:?/, '') || 'general'} · {f.source.startsWith('job:') ? `from job “${f.source.slice(4)}”` : f.source === 'markus' ? 'added by you' : 'saved by JARVIS'} · {ago(f.updatedAt)}
      </span>
      <button className="btn btn-quiet" onClick={() => act(() => hubActions.forgetMemory(f.id), 'Forgotten')} title="Forget this">
        Forget
      </button>
    </li>
  )
}

export function MemoryPanel() {
  const mem = useHub((s) => s.state?.memory)
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('general')
  const facts = mem?.facts ?? []
  const lessons = facts.filter((f) => f.topic.startsWith('lesson'))
  const known = facts.filter((f) => !f.topic.startsWith('lesson'))
  return (
    <section className="card mem-card">
      <header className="card-head">
        <h3>Memory</h3>
        <span className="muted small">
          {facts.length} saved · {mem?.turns ?? 0} lines of conversation on this Mac
        </span>
      </header>
      <p className="fine">
        JARVIS starts every session with his lessons, these facts and the last few days of conversation, so stopping him loses nothing. He saves
        facts and lessons himself as you talk; you can add or delete any of them here.
      </p>

      <h4 className="mem-h">Lessons he has learned</h4>
      {lessons.length ? (
        <ul className="mem-list">
          {lessons.map((f) => (
            <Fact key={f.id} f={f} />
          ))}
        </ul>
      ) : (
        <p className="muted small">None yet. When you correct him or something fails, he writes the lesson down here.</p>
      )}

      <h4 className="mem-h">What he remembers</h4>
      {known.length ? (
        <ul className="mem-list">
          {known.map((f) => (
            <Fact key={f.id} f={f} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing saved yet. Tell him how things are set up and he’ll keep it.</p>
      )}

      <form
        className="mem-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void act(() => hubActions.addMemory(text, topic), 'Saved to memory').then(() => setText(''))
        }}
      >
        <input className="input" placeholder="Teach him something, e.g. “Quant View is …”" value={text} onChange={(e) => setText(e.target.value)} aria-label="New memory" />
        <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
          {['general', 'automaton', 'trading', 'tradingview', 'tradovate', 'quantview', 'roblox', 'business', 'lesson'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!text.trim()}>
          Save
        </button>
      </form>

      <div className="field-row mem-clear">
        <span className="fine">Conversation history is kept in ~/.jarvis/conversation.jsonl.</span>
        <button
          className="btn btn-warn"
          onClick={() => {
            if (confirm('Clear the conversation history? Saved facts and lessons stay.')) void act(hubActions.clearConversation, 'Conversation history cleared')
          }}
        >
          Clear conversation history
        </button>
      </div>
    </section>
  )
}
