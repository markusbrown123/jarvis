/** Small, honest formatting helpers shared by the dashboard. */

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—'
  const s = Math.round((now - ts) / 1000)
  if (s < 0) return 'just now'
  if (s < 45) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function until(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—'
  const s = Math.round((ts - now) / 1000)
  if (s <= 0) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function elapsed(from: number | null | undefined, now = Date.now()): string {
  if (!from) return '—'
  return until(now + (now - from), now)
}

export function clock(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export function humanize(s: string | null | undefined): string {
  return (s ?? '').replace(/_/g, ' ')
}

export const JOB_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting',
  needs_markus: 'Needs you',
  retrying: 'Retrying',
  completed: 'Done',
  failed: 'Failed',
  cancel_requested: 'Cancellation requested',
  canceled: 'Canceled',
}

/** The one color vocabulary: violet working, amber needs you, red failed. */
export function tone(state: string | undefined, stale?: boolean): 'work' | 'need' | 'fail' | 'ok' | 'idle' | 'off' {
  if (stale) return 'need'
  switch (state) {
    case 'running':
    case 'retrying':
    case 'cancel_requested':
      return 'work'
    case 'needs_markus':
    case 'open':
      return 'need'
    case 'failed':
      return 'fail'
    case 'completed':
    case 'resolved':
      return 'ok'
    case 'off':
      return 'off'
    default:
      return 'idle'
  }
}
