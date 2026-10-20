import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import { ago } from '../hub/format'
import { Chip, Empty } from './shared'
import { useTick } from './state'

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

export function Finance() {
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
    <div className="view view-finance">
      <header className="view-head">
        <div>
          <h1>Finance</h1>
          <p className="muted">Checked {ago(f.updatedAt)}</p>
        </div>
      </header>
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
                    {sv.up ? `running · ${sv.ms} ms` : 'not running on this Mac'} · {sv.url}
                    {sv.commit ? ` · ${sv.commit.short} ${ago(sv.commit.committedAt)}` : sv.repo ? '' : ' · repo not found locally'}
                  </div>
                </div>
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
    </div>
  )
}
