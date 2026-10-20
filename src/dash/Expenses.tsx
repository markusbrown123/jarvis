import { useState } from 'react'
import { useHub, hubActions, fileUrl } from '../hub/client'
import type { ExpenseSummary } from '../hub/types'
import { Empty } from './shared'

/**
 * Business expenses: what this month cost, where it went, and every entry.
 * Entries come from Markus — said to JARVIS, a receipt photo texted to the
 * bot, or typed here. Nothing is estimated, imported or paid.
 */

const BUSINESSES = ['automaton', 'roblox', 'trading', 'jarvis', 'personal', 'other']
const CATEGORIES = ['software', 'ai', 'hosting', 'marketing', 'contractors', 'equipment', 'office', 'travel', 'meals', 'fees', 'education', 'other']

const LABEL: Record<string, string> = { ai: 'AI', jarvis: 'JARVIS' }
const label = (k: string) => LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1)

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** One measure, one hue: a ranked bar list with the value in text ink. */
function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] ?? 0
  const total = rows.reduce((a, [, v]) => a + v, 0)
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
      </header>
      {rows.length ? (
        <div className="bars" role="list">
          {rows.map(([k, v]) => (
            <div key={k} className="bar-row" role="listitem" title={`${label(k)}: ${usd(v)} · ${Math.round((v / total) * 100)}% of the month`}>
              <span className="bar-k">{label(k)}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
              </span>
              <span className="bar-v mono">{usd(v)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Nothing this month yet.</p>
      )}
    </section>
  )
}

function delta(now: ExpenseSummary | undefined, before: ExpenseSummary | undefined) {
  if (!now || !before || !before.total) return null
  const d = now.total - before.total
  return `${d >= 0 ? '+' : '−'}${usd(Math.abs(d))} vs last month so far`
}

function AddExpense() {
  const [f, setF] = useState({ amount: '', vendor: '', business: 'automaton', category: 'software', date: new Date().toLocaleDateString('en-CA'), note: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <form
      className="card expense-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await hubActions.addExpense({ ...f, amount: Number(f.amount) })
          useHub.getState().say('Expense logged')
          setF({ ...f, amount: '', vendor: '', note: '' })
        } catch (err) {
          useHub.getState().say((err as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <header className="card-head">
        <h3>Log an expense</h3>
        <span className="muted small">or say “Jarvis, log $42 Netlify for Automaton hosting”, or text a receipt photo to your JARVIS bot</span>
      </header>
      <div className="expense-grid">
        <input className="input" inputMode="decimal" placeholder="Amount" value={f.amount} onChange={set('amount')} aria-label="Amount" />
        <input className="input" placeholder="Vendor" value={f.vendor} onChange={set('vendor')} aria-label="Vendor" />
        <select className="input" value={f.business} onChange={set('business')} aria-label="Business">
          {BUSINESSES.map((b) => (
            <option key={b} value={b}>
              {label(b)}
            </option>
          ))}
        </select>
        <select className="input" value={f.category} onChange={set('category')} aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={f.date} onChange={set('date')} aria-label="Date" />
        <input className="input" placeholder="Note (optional)" value={f.note} onChange={set('note')} aria-label="Note" />
        <button className="btn btn-primary" disabled={busy || !(Number(f.amount) > 0) || !f.vendor.trim()}>
          {busy ? 'Saving…' : 'Log it'}
        </button>
      </div>
    </form>
  )
}

export function Expenses() {
  const ex = useHub((x) => x.state?.expenses)
  if (!ex) return <Empty title="Loading the ledger…" />
  const m = ex.month
  const d = delta(m, ex.lastMonth)
  return (
    <div className="expenses">
      <div className="expense-tiles">
        <div className="card tile">
          <span className="tile-k">This month</span>
          <span className="tile-v">{usd(m.total)}</span>
          <span className="tile-s">
            {m.count} {m.count === 1 ? 'expense' : 'expenses'}
            {d ? ` · ${d}` : ''}
          </span>
        </div>
        <div className="card tile">
          <span className="tile-k">Last month</span>
          <span className="tile-v">{usd(ex.lastMonth.total)}</span>
          <span className="tile-s">{ex.lastMonth.count} expenses</span>
        </div>
        <div className="card tile">
          <span className="tile-k">This year</span>
          <span className="tile-v">{usd(ex.year.total)}</span>
          <span className="tile-s">{ex.year.count} expenses</span>
        </div>
        {m.currencies.length > 1 && <p className="fine warn">This month mixes currencies ({m.currencies.join(', ')}); totals add them as entered, unconverted.</p>}
      </div>
      <div className="expense-breakdowns">
        <Breakdown title="By business · this month" data={m.byBusiness} />
        <Breakdown title="By category · this month" data={m.byCategory} />
      </div>
      <AddExpense />
      <section className="card">
        <header className="card-head">
          <h3>
            Entries <span className="mono muted">{ex.total}</span>
          </h3>
          <button className="btn" onClick={() => hubActions.downloadExpenses('all').catch((e: Error) => useHub.getState().say(e.message))}>
            Download CSV
          </button>
        </header>
        {ex.recent.length ? (
          <div className="expense-table-wrap">
          <table className="expense-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Business</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ex.recent.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.date}</td>
                  <td>
                    {e.vendor}
                    {e.note && <span className="muted small"> — {e.note}</span>}
                  </td>
                  <td>{label(e.business)}</td>
                  <td>{label(e.category)}</td>
                  <td className="num mono">
                    {e.currency === 'USD' ? usd(e.amount) : `${e.currency} ${e.amount.toFixed(2)}`}
                  </td>
                  <td className="row-actions">
                    {e.receipt && (
                      <a className="btn btn-quiet" href={fileUrl(e.receipt)} target="_blank" rel="noreferrer">
                        Receipt
                      </a>
                    )}
                    <button
                      className="btn btn-quiet"
                      onClick={async () => {
                        if (!confirm(`Delete ${e.vendor} ${usd(e.amount)} on ${e.date}?`)) return
                        await hubActions.deleteExpense(e.id).catch((err: Error) => useHub.getState().say(err.message))
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <Empty title="No expenses yet">Log the first one above, tell JARVIS, or text a receipt photo to your bot.</Empty>
        )}
      </section>
    </div>
  )
}
