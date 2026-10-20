import { useHub } from '../hub/client'
import type { Usage, UsageWindow } from '../hub/types'
import { ago, tokens, until } from '../hub/format'
import { useTick } from './state'

/**
 * Claude usage, from sources that actually report it.
 *
 * Subscription windows come only from Claude Code's status line (account-wide,
 * newest reading wins, never summed). A window that has not been reported is
 * "unavailable", never full. A reading whose reset time has passed is marked
 * as needing a fresh reading rather than assumed to be back at zero.
 */

type WinView =
  | { kind: 'missing' }
  | { kind: 'expired'; w: UsageWindow }
  | { kind: 'ok'; w: UsageWindow; used: number; left: number }

function windowView(w: UsageWindow | undefined, now: number): WinView {
  if (!w) return { kind: 'missing' }
  if (w.resetsAt && w.resetsAt < now) return { kind: 'expired', w }
  const used = Math.max(0, Math.min(100, w.usedPct))
  return { kind: 'ok', w, used, left: 100 - used }
}

const USAGE_PAGE = 'https://claude.ai/settings/usage'

/** One line for the top bar. */
export function UsageChip() {
  useTick(15000)
  const usage = useHub((s) => s.state?.usage)
  const v = windowView(usage?.windows.five_hour, Date.now())
  const go = () => useHub.getState().go('settings')
  if (v.kind === 'missing') {
    return (
      <button className="usage-chip usage-missing" onClick={go} title="No status line reading yet — see Settings">
        Allowance: unavailable
      </button>
    )
  }
  if (v.kind === 'expired') {
    return (
      <button className="usage-chip usage-missing" onClick={go} title="The 5-hour window reset; waiting for a fresh reading">
        5h window reset — needs a fresh reading
      </button>
    )
  }
  const tone = v.used >= 90 ? 'fail' : v.used >= 70 ? 'need' : 'ok'
  return (
    <button className={`usage-chip usage-${tone}`} onClick={go} title={`Source: ${v.w.source}, ${ago(v.w.observedAt)}`}>
      <span className="usage-bar">
        <span style={{ width: `${v.used}%` }} />
      </span>
      <span className="mono">{Math.round(v.left)}%</span> left · resets {until(v.w.resetsAt)}
    </button>
  )
}

function WindowRow({ name, w, now }: { name: string; w: UsageWindow | undefined; now: number }) {
  const v = windowView(w, now)
  return (
    <div className="usage-row">
      <div className="usage-name">{name}</div>
      {v.kind === 'missing' && <div className="usage-value muted">Unavailable — no reading from Claude Code yet</div>}
      {v.kind === 'expired' && (
        <div className="usage-value muted">
          Reset at {new Date(v.w.resetsAt!).toLocaleTimeString()} — needs a fresh reading (last {Math.round(v.w.usedPct)}% used)
        </div>
      )}
      {v.kind === 'ok' && (
        <>
          <div className="usage-meter">
            <span style={{ width: `${v.used}%` }} className={v.used >= 90 ? 'fail' : v.used >= 70 ? 'need' : 'ok'} />
          </div>
          <div className="usage-value">
            <b className="mono">{v.used.toFixed(1)}%</b> used · <b className="mono">{v.left.toFixed(1)}%</b> remaining · resets in{' '}
            <span className="mono">{until(v.w.resetsAt)}</span>
            <span className="muted"> · {v.w.source}, {ago(v.w.observedAt)}</span>
          </div>
        </>
      )}
    </div>
  )
}

export function UsagePanel({ usage }: { usage: Usage | undefined }) {
  useTick(10000)
  const now = Date.now()
  if (!usage) return null
  const r = usage.requests
  const ctx = usage.context
  return (
    <section className="card usage">
      <header className="card-head">
        <h3>Claude allowance</h3>
        <a className="btn btn-quiet" href={USAGE_PAGE} target="_blank" rel="noreferrer">
          Usage page ↗
        </a>
      </header>
      <WindowRow name="5-hour window" w={usage.windows.five_hour} now={now} />
      <WindowRow name="Weekly window" w={usage.windows.seven_day} now={now} />
      {usage.windows.spend_limit && <WindowRow name="Spend limit" w={usage.windows.spend_limit} now={now} />}

      <div className="usage-row">
        <div className="usage-name">Context headroom</div>
        <div className="usage-value">
          {ctx && ctx.usedPct != null ? (
            <>
              <b className="mono">{(100 - ctx.usedPct).toFixed(0)}%</b> of the{' '}
              {ctx.size ? `${tokens(ctx.size)}-token` : ''} window free in {ctx.source}
              <span className="muted"> · a snapshot of one session, not a billing counter · {ago(ctx.observedAt)}</span>
            </>
          ) : (
            <span className="muted">Unavailable — appears once a Claude Code session reports it</span>
          )}
        </div>
      </div>

      <div className="usage-row">
        <div className="usage-name">JARVIS’s own session</div>
        <div className="usage-value">
          {usage.status ? (
            <>
              Limit status <b>{usage.status.status ?? 'unknown'}</b>
              {usage.status.window && ` (${usage.status.window.replace('_', '-')} window)`}
              {usage.status.resetsAt && `, resets in ${until(usage.status.resetsAt)}`}
              {usage.status.usingOverage && ' · using overage'}
              <span className="muted"> · {ago(usage.status.observedAt)}</span>
            </>
          ) : (
            <span className="muted">No reading yet — appears after his first answer</span>
          )}
        </div>
      </div>
      <div className="usage-row">
        <div className="usage-name">JARVIS requests</div>
        <div className="usage-value">
          <span className="mono">{r.count}</span> answers · <span className="mono">{tokens(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)}</span> input tokens (
          <span className="mono">{tokens(r.cacheReadTokens)}</span> cached) · <span className="mono">{tokens(r.outputTokens)}</span> output
          <div className="muted">
            List-price equivalent ${r.costUsd.toFixed(2)} — an estimate computed by Claude Code, not your bill; subscription use is covered by your plan.
          </div>
        </div>
      </div>
      <p className="fine">
        Sources: Claude Code status line ({usage.sources['Claude Code status line'] ? ago(usage.sources['Claude Code status line']) : 'not connected'}), JARVIS session (
        {usage.sources.jarvis ? ago(usage.sources.jarvis) : 'none yet'}), hooks ({usage.sources.hooks ? ago(usage.sources.hooks) : 'not connected'}).
      </p>
    </section>
  )
}
