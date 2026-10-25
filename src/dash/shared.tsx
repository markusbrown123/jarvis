import { useState, type ReactNode } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { Item } from '../hub/types'
import { ago, until } from '../hub/format'
import { copy } from './state'

export function Chip({ tone, children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip chip-${tone ?? 'idle'}`} title={title}>
      {children}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

/** A Needs Markus item: what, why, where, what's ready, how it's verified. */
export function ItemCard({ item, full = false }: { item: Item; full?: boolean }) {
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      const r = (await fn()) as { result?: { detail?: string } }
      useHub.getState().say(r?.result?.detail ?? done ?? 'Done')
    } catch (err) {
      useHub.getState().say((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const snoozed = item.state === 'snoozed'
  return (
    <article className={`item item-${item.priority} item-${item.state}`}>
      <header className="item-head">
        <span className={`item-dot tone-${item.state === 'resolved' ? 'ok' : 'need'}`} />
        <div className="item-title">{item.title}</div>
        <span className="item-meta mono">
          {item.priority} · {item.project} · {ago(item.createdAt)}
        </span>
      </header>
      {item.why && <p className="item-why">{item.why}</p>}
      {(full || item.priority === 'P1') && item.instructions && (
        <p className="item-how">
          <b>What to do:</b> {item.instructions}
        </p>
      )}
      {full && (
        <dl className="item-facts">
          {item.prepared && (
            <>
              <dt>Ready</dt>
              <dd>{item.prepared}</dd>
            </>
          )}
          {item.verify?.note && (
            <>
              <dt>Verified by</dt>
              <dd>{item.verify.note}</dd>
            </>
          )}
          {item.resumes && (
            <>
              <dt>Then</dt>
              <dd>{item.resumes}</dd>
            </>
          )}
          {item.destination?.path && (
            <>
              <dt>Where</dt>
              <dd className="mono">{item.destination.path}</dd>
            </>
          )}
        </dl>
      )}
      {item.lastCheck && (
        <p className={`item-check ${item.lastCheck.ok ? 'ok' : ''}`}>
          Checked {ago(item.lastCheck.at)}: {item.lastCheck.detail}
        </p>
      )}
      {snoozed && <p className="item-check">Snoozed — back in {until(item.snoozedUntil)}</p>}
      <div className="item-actions">
        {(item.actions ?? []).map((a, i) =>
          a.kind === 'copy' ? (
            <button key={i} className="btn" onClick={() => copy(a.value)} title={a.value}>
              {a.label}
            </button>
          ) : a.kind === 'open' ? (
            <a key={i} className="btn" href={a.url} target="_blank" rel="noreferrer">
              {a.label} ↗
            </a>
          ) : (
            <button key={i} className="btn btn-primary" disabled={busy} onClick={() => act(() => hubActions.checkItem(item.id))}>
              {busy ? 'Checking…' : a.label}
            </button>
          ),
        )}
        {item.state !== 'resolved' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => hubActions.doneItem(item.id), 'Done')}>
            Done
          </button>
        )}
        {item.state === 'open' && (
          <button className="btn btn-quiet" onClick={() => act(() => hubActions.startItem(item.id), 'Marked in progress')}>
            I’m on it
          </button>
        )}
        {item.state !== 'snoozed' && item.state !== 'resolved' && (
          <button className="btn btn-quiet" onClick={() => act(() => hubActions.snoozeItem(item.id, 4), 'Snoozed for 4 hours')}>
            Snooze 4h
          </button>
        )}
        {(snoozed || item.state === 'canceled') && (
          <button className="btn btn-quiet" onClick={() => act(() => hubActions.reopenItem(item.id), 'Reopened')}>
            Reopen
          </button>
        )}
      </div>
    </article>
  )
}
