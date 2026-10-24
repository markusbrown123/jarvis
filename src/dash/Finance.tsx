import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { FinanceProject, MasterHubData, ScoutData, Service } from '../hub/types'
import { ago } from '../hub/format'
import { Chip, Empty } from './shared'
import { useTick } from './state'
import { Expenses } from './Expenses'

/**
 * Finance: monitoring only.
 *
 * Today's tooling is research — master-hub, Futures Trader Scout, traderedge,
 * InsiderEdge — and none of it connects to a broker. So there are no account,
 * position or P&L numbers here, and the view says why instead of drawing a
 * placeholder that looks like data. The chart is a TradingView widget: public
 * market data on TradingView's terms (futures are typically delayed), not
 * proof of any account connection.
 */

function chartSrc(symbol: string) {
  const q = new URLSearchParams({
    symbol,
    interval: '5',
    theme: 'dark',
    style: '1',
    timezone: 'exchange',
    hide_side_toolbar: '1',
    withdateranges: '1',
    allow_symbol_change: '0',
    locale: 'en',
  })
  return `https://s.tradingview.com/widgetembed/?${q}`
}

const fmt = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d }))
const money = (v: number | null | undefined) => (v == null ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)

/** Start / stop a research service, with its own venv. */
function ServiceControl({ sv }: { sv: Service }) {
  const [busy, setBusy] = useState(false)
  const c = sv.control
  if (!c) return null
  const act = async (a: 'start' | 'stop') => {
    setBusy(true)
    try {
      await hubActions.financeService(sv.id, a)
      useHub.getState().say(`${sv.name} ${a === 'start' ? 'starting' : 'stopped'}`)
    } catch (err) {
      useHub.getState().say((err as Error).message)
    }
    setBusy(false)
  }
  if (sv.up && !c.managed) return <span className="muted small" title="Started outside JARVIS: stop it where it was started">running outside JARVIS</span>
  if (c.managed)
    return (
      <button className="btn" disabled={busy} onClick={() => act('stop')} title={`Log: ${c.log}`}>
        {busy ? 'Stopping…' : 'Stop'}
      </button>
    )
  if (!c.ready)
    return (
      <button className="btn btn-quiet" title={c.setup} onClick={() => navigator.clipboard?.writeText(c.setup).then(() => useHub.getState().say('Setup command copied'))}>
        Copy setup
      </button>
    )
  return (
    <button className="btn" disabled={busy} onClick={() => act('start')} title={`Runs from its own .venv · log ${c.log}`}>
      {busy ? 'Starting…' : 'Start'}
    </button>
  )
}

/** A strategy's paper equity curve, from its real resolved trades. */
function Spark({ points }: { points: [number | null, number | null][] }) {
  const ys = points.map((p) => p[1]).filter((y): y is number => y != null)
  if (ys.length < 2) return <span className="muted small">one trade</span>
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${((i / (ys.length - 1)) * 100).toFixed(1)},${(28 - ((y - lo) / (hi - lo || 1)) * 26).toFixed(1)}`).join(' ')
  const up = ys[ys.length - 1] >= ys[0]
  return (
    <svg className={`spark ${up ? 'up' : 'down'}`} viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`Paper equity from ${fmt(ys[0])} to ${fmt(ys[ys.length - 1])}`}>
      <path d={d} />
    </svg>
  )
}

function MasterHubCard({ d }: { d?: MasterHubData }) {
  return (
    <section className="card research-card">
      <header className="card-head">
        <h3>master-hub findings</h3>
        <span className="muted small">{d?.updatedAt ? `saved ${ago(d.updatedAt)}` : ''}</span>
      </header>
      <p className="fine">Review-only research from its own database, read-only. Not signals, not an account; realized and unrealized P&amp;L are kept apart.</p>
      {!d || d.error ? (
        <p className="muted">{d?.error ?? 'Not read yet.'}</p>
      ) : !d.findings?.length ? (
        <p className="muted">No findings stored yet.</p>
      ) : (
        <div className="findings">
          {d.findings.slice(0, 12).map((f, i) => (
            <div key={`${f.engine}${f.subject}${i}`} className="finding">
              <div className="finding-top">
                <Chip tone="idle">{f.kind.replace(/_/g, ' ')}</Chip>
                <b>{f.title ?? f.subject}</b>
                {f.rank != null && <span className="mono muted small">rank {fmt(f.rank)}</span>}
              </div>
              <div className="svc-sub">
                {f.engine} · {f.subject}
                {f.confidence != null && ` · confidence ${fmt(f.confidence * (f.confidence <= 1 ? 100 : 1), 0)}%`}
                {f.sampleSize != null && ` · n=${f.sampleSize}`}
                {f.paper && ` · paper: ${f.paper}`}
                {f.forward && ` · forward test: ${f.forward}`}
                {f.realizedPnl != null && ` · realized ${money(f.realizedPnl)}`}
                {f.unrealizedPnl != null && ` · unrealized ${money(f.unrealizedPnl)}`}
                {f.riskFlags.length > 0 && ` · ${f.riskFlags.length} risk flag${f.riskFlags.length > 1 ? 's' : ''}`}
                {f.url && (
                  <>
                    {' · '}
                    <a href={f.url} target="_blank" rel="noreferrer">
                      source ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {d && !d.error && (
        <>
          <h4 className="research-sub">Strategy lab · paper forward test</h4>
          <p className="fine">Each curve is real resolved paper trades, realized only — never backfilled. Not money in an account.</p>
          {d.strategies?.length ? (
            d.strategies.slice(0, 8).map((s) => (
              <div key={s.engine + s.strategy} className="strategy">
                <div className="svc-main">
                  <div className="svc-name">{s.strategy}</div>
                  <div className="svc-sub">
                    {s.engine} · {s.trades} paper trades · paper equity {fmt(s.equity)} · last {ago(s.lastAt ?? undefined)}
                  </div>
                </div>
                <Spark points={s.points} />
              </div>
            ))
          ) : (
            <p className="muted">{d.equityError ?? 'No strategy-lab paper trades recorded yet.'}</p>
          )}
        </>
      )}
    </section>
  )
}

function ScoutCard({ d }: { d?: ScoutData }) {
  return (
    <section className="card research-card">
      <header className="card-head">
        <h3>Futures Trader Scout</h3>
        <span className="muted small">{d?.sources?.lastChecked ? `sources checked ${ago(d.sources.lastChecked)}${d.sources.errors ? ` · ${d.sources.errors} erroring` : ''}` : ''}</span>
      </header>
      <p className="fine">Public traders ranked from public payout posts and streams, read-only from the Scout's database. Their results, not yours; not advice.</p>
      {!d || d.error ? (
        <p className="muted">{d?.error ?? 'Not read yet.'}</p>
      ) : !d.traders?.length ? (
        <p className="muted">No traders ranked yet — run a scan in the Scout.</p>
      ) : (
        <ol className="ranking">
          {d.traders.slice(0, 10).map((t) => (
            <li key={t.name + (t.url ?? '')}>
              <div className="finding-top">
                <b>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.name} ↗</a> : t.name}</b>
                <span className="mono">{fmt(t.score, 1)}</span>
              </div>
              <div className="svc-sub" title={t.why ?? undefined}>
                {[t.platform, t.propFirm, t.products].filter(Boolean).join(' · ')}
                {t.payouts90d != null && ` · ${t.payouts90d} verified payouts in 90 days`}
                {t.paid90d ? ` (${money(t.paid90d)})` : ''}
                {t.consistency != null && ` · consistency ${fmt(t.consistency, 1)}`}
                {t.redFlags ? ` · red flags ${fmt(t.redFlags, 1)}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
      {d?.live && d.live.length > 0 && (
        <>
          <h4 className="research-sub">Live now</h4>
          {d.live.map((l) => (
            <div key={l.url} className="svc-sub">
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.channel} ↗
              </a>{' '}
              · {l.platform} · {l.title.slice(0, 70)}
              {l.viewers != null && ` · ${l.viewers.toLocaleString()} watching`}
              {l.products && ` · ${l.products}`}
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function Research({ f }: { f: FinanceProject }) {
  return (
    <div className="research-grid">
      <MasterHubCard d={f.data?.masterHub} />
      <ScoutCard d={f.data?.scout} />
    </div>
  )
}

/** Finance: business expenses first, then market monitoring. */
export function Finance() {
  const [tab, setTab] = useState<'expenses' | 'markets'>('expenses')
  return (
    <div className="view view-finance">
      <header className="view-head">
        <div>
          <h1>Finance</h1>
          <p className="muted">{tab === 'expenses' ? 'Business expenses — logged by voice, phone receipt photo, or here.' : 'Market monitoring — research tools, charts, no broker.'}</p>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === 'expenses' ? 'on' : ''}`} onClick={() => setTab('expenses')}>
            Expenses
          </button>
          <button className={`tab ${tab === 'markets' ? 'on' : ''}`} onClick={() => setTab('markets')}>
            Markets
          </button>
        </div>
      </header>
      {tab === 'expenses' ? <Expenses /> : <Markets />}
    </div>
  )
}

function Markets() {
  useTick(15000)
  const s = useHub((x) => x.state)
  const prefs = useHub((x) => x.prefs)
  const setPrefs = useHub((x) => x.setPrefs)
  const [qvName, setQvName] = useState('')
  const [qvUrl, setQvUrl] = useState('')
  const f = s?.projects.finance
  if (!f) return <Empty title="Checking finance services…" />
  const symbol = prefs.chartSymbol ?? f.charts[0]?.symbol ?? 'CME_MINI:MNQ1!'
  return (
    <>
      <p className="muted small">Checked {ago(f.updatedAt)}</p>
      <div className="banner">
        <b>Monitoring only.</b> No broker, prop account or execution connection exists — nothing on this page can place, change or cancel an order.
        Live accounts, paper trading and backtests will each be labelled separately once a source for them is connected.
      </div>

      <div className="finance-layout">
        <section className="card chart-card">
          <header className="card-head">
            <div className="tabs">
              {f.charts.map((c) => (
                <button key={c.symbol} className={`tab ${c.symbol === symbol ? 'on' : ''}`} onClick={() => setPrefs({ chartSymbol: c.symbol })}>
                  {c.label}
                </button>
              ))}
            </div>
            <a className="btn btn-quiet" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
              Open on TradingView ↗
            </a>
          </header>
          <iframe key={symbol} className="chart" title={`${symbol} chart`} src={chartSrc(symbol)} sandbox="allow-scripts allow-same-origin allow-popups" />
          <p className="fine">
            TradingView widget · {symbol} · exchange timezone · market data per TradingView’s widget terms (futures are usually delayed) · not your account and not a signal.
          </p>
        </section>

        <div className="finance-side">
          <section className="card">
            <header className="card-head">
              <h3>Services</h3>
            </header>
            {f.services.map((sv) => (
              <div key={sv.id} className="svc">
                <span className={`svc-dot tone-${sv.up ? 'ok' : 'off'}`} />
                <div className="svc-main">
                  <div className="svc-name">{sv.name}</div>
                  <div className="svc-sub">
                    {sv.up ? `running · ${sv.ms} ms` : sv.control?.managed ? 'starting…' : 'not running on this Mac'}
                    {sv.control?.managed && sv.control.startedAt ? ` · started by JARVIS ${ago(sv.control.startedAt)}` : ''} · {sv.url}
                    {sv.commit ? ` · ${sv.commit.short} ${ago(sv.commit.committedAt)}` : sv.repo ? '' : ' · repo not found locally'}
                  </div>
                </div>
                <ServiceControl sv={sv} />
                {sv.up && (
                  <a className="btn" href={sv.url} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                )}
              </div>
            ))}
          </section>

          <section className="card">
            <header className="card-head">
              <h3>Research engines</h3>
            </header>
            {f.research.map((r) => (
              <div key={r.id} className="svc">
                <span className={`svc-dot tone-${r.repo ? 'idle' : 'off'}`} />
                <div className="svc-main">
                  <div className="svc-name">{r.name}</div>
                  <div className="svc-sub">{r.commit ? `${r.commit.short} · ${r.commit.subject.slice(0, 50)} · ${ago(r.commit.committedAt)}` : 'not on this Mac'}</div>
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <header className="card-head">
              <h3>Quant View</h3>
              {f.quantView.url ? <Chip tone="ok">linked</Chip> : <Chip tone="need">needs you</Chip>}
            </header>
            {f.quantView.url ? (
              <p>
                <a href={f.quantView.url} target="_blank" rel="noreferrer">
                  {f.quantView.name ?? f.quantView.url} ↗
                </a>{' '}
                <span className="muted">— link only until its capabilities are confirmed.</span>
              </p>
            ) : (
              <form
                className="qv-form"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    await hubActions.setQuantView(qvName, qvUrl)
                    useHub.getState().say('Quant View linked')
                  } catch (err) {
                    useHub.getState().say((err as Error).message)
                  }
                }}
              >
                <p className="muted">Nothing on your machines names this service yet. Paste its exact link and JARVIS will add it.</p>
                <input className="input" placeholder="Name (e.g. QuantVue)" value={qvName} onChange={(e) => setQvName(e.target.value)} />
                <input className="input" placeholder="https://…" value={qvUrl} onChange={(e) => setQvUrl(e.target.value)} />
                <button className="btn btn-primary" type="submit">
                  Link it
                </button>
              </form>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h3>Signals, positions, P&amp;L</h3>
            </header>
            <p className="muted">
              Unavailable — no alert webhook, broker or strategy runner is connected. Nothing is estimated in their place. When a TradingView alert webhook or a
              read-only broker feed is added, signals will show with their source, freshness and why each was acted on or rejected.
            </p>
          </section>
        </div>
      </div>
      <Research f={f} />
    </>
  )
}
