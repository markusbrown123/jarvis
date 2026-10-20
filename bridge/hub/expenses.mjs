/**
 * Business expenses: a plain ledger Markus (or JARVIS, on his word) writes to.
 *
 * Every entry is something he said, typed, or photographed — JARVIS never
 * invents one, and an amount it couldn't read stays a question, not a guess.
 * Stored in ~/.jarvis/expenses.json (atomic writes); receipt photos in
 * ~/.jarvis/receipts. Nothing here talks to a bank, card or accounting
 * service, and nothing is ever paid.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as hub from './store.mjs'

const FILE = join(hub.DATA_DIR, 'expenses.json')
export const RECEIPTS = join(hub.DATA_DIR, 'receipts')

export const CATEGORIES = ['software', 'ai', 'hosting', 'marketing', 'contractors', 'equipment', 'office', 'travel', 'meals', 'fees', 'education', 'other']
export const BUSINESSES = ['automaton', 'roblox', 'trading', 'jarvis', 'personal', 'other']

let list = load()

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

function save() {
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 })
  renameSync(tmp, FILE)
  publish()
}

const today = () => new Date().toLocaleDateString('en-CA')
const money = (n, cur = 'USD') => `${cur === 'USD' ? '$' : `${cur} `}${n.toFixed(2)}`

/** Which entries fall in a period: this-month | last-month | this-year | all | YYYY-MM. */
export function inPeriod(period = 'this-month') {
  const now = new Date()
  const ym = (d) => d.slice(0, 7)
  const thisMonth = now.toLocaleDateString('en-CA').slice(0, 7)
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-CA').slice(0, 7)
  if (period === 'all') return list
  if (period === 'this-year') return list.filter((e) => e.date.startsWith(String(now.getFullYear())))
  if (period === 'last-month') return list.filter((e) => ym(e.date) === last)
  if (/^\d{4}-\d{2}$/.test(period)) return list.filter((e) => ym(e.date) === period)
  return list.filter((e) => ym(e.date) === thisMonth)
}

export function summarize(entries) {
  const by = (k) => {
    const out = {}
    for (const e of entries) out[e[k]] = (out[e[k]] ?? 0) + e.amount
    return out
  }
  return {
    count: entries.length,
    total: entries.reduce((a, e) => a + e.amount, 0),
    byBusiness: by('business'),
    byCategory: by('category'),
    currencies: [...new Set(entries.map((e) => e.currency))],
  }
}

/** The small part of the ledger every dashboard gets in the state snapshot. */
function publish() {
  hub.setExpenses({
    month: summarize(inPeriod('this-month')),
    lastMonth: summarize(inPeriod('last-month')),
    year: summarize(inPeriod('this-year')),
    recent: [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 40),
    total: list.length,
  })
}
publish()

export function addExpense(e) {
  const amount = Math.round(Number(e.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('An expense needs a positive amount.')
  const vendor = String(e.vendor ?? '').trim().slice(0, 80)
  if (!vendor) throw new Error('An expense needs a vendor (who was paid).')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') ? e.date : today()
  const entry = {
    id: randomUUID().slice(0, 8),
    date,
    amount,
    currency: /^[A-Z]{3}$/.test(e.currency ?? '') ? e.currency : 'USD',
    vendor,
    category: CATEGORIES.includes(e.category) ? e.category : 'other',
    business: BUSINESSES.includes(e.business) ? e.business : 'other',
    note: String(e.note ?? '').trim().slice(0, 300) || null,
    receipt: e.receipt ?? null,
    source: e.source ?? 'dashboard',
    recurring: e.recurring === 'monthly' || e.recurring === 'yearly' ? e.recurring : null,
    createdAt: Date.now(),
  }
  list.push(entry)
  save()
  hub.activity({ source: 'business', project: 'business', title: `Expense logged: ${money(entry.amount, entry.currency)} ${entry.vendor} (${entry.business} · ${entry.category})`, level: 'info' })
  return entry
}

export function updateExpense(id, patch) {
  const e = list.find((x) => x.id === id)
  if (!e) throw new Error('No such expense.')
  if (patch.amount !== undefined) {
    const a = Math.round(Number(patch.amount) * 100) / 100
    if (!Number.isFinite(a) || a <= 0) throw new Error('Amount must be positive.')
    e.amount = a
  }
  if (patch.vendor) e.vendor = String(patch.vendor).slice(0, 80)
  if (patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) e.date = patch.date
  if (CATEGORIES.includes(patch.category)) e.category = patch.category
  if (BUSINESSES.includes(patch.business)) e.business = patch.business
  if (patch.note !== undefined) e.note = String(patch.note).slice(0, 300) || null
  save()
  return e
}

export function deleteExpense(id) {
  const i = list.findIndex((x) => x.id === id)
  if (i === -1) return false
  const [e] = list.splice(i, 1)
  save()
  hub.activity({ source: 'business', project: 'business', title: `Expense removed: ${money(e.amount, e.currency)} ${e.vendor}`, level: 'warn' })
  return true
}

export function listExpenses({ period = 'this-month', business, category } = {}) {
  return inPeriod(period)
    .filter((e) => (!business || e.business === business) && (!category || e.category === category))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function csv(period = 'all') {
  const rows = [['date', 'amount', 'currency', 'vendor', 'category', 'business', 'note', 'receipt', 'id']]
  for (const e of [...inPeriod(period)].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([e.date, e.amount.toFixed(2), e.currency, e.vendor, e.category, e.business, e.note ?? '', e.receipt ?? '', e.id])
  }
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n'
}

/** Keep a receipt photo; returns its path for the entry's `receipt` field. */
export function saveReceipt(buffer, ext = 'jpg') {
  mkdirSync(RECEIPTS, { recursive: true })
  const path = join(RECEIPTS, `${new Date().toLocaleDateString('en-CA')}-${randomUUID().slice(0, 8)}.${ext}`)
  writeFileSync(path, buffer, { mode: 0o600 })
  return path
}

export const describe = (e) => `${e.id}: ${e.date} ${money(e.amount, e.currency)} ${e.vendor} [${e.business} · ${e.category}]${e.note ? ` — ${e.note}` : ''}${e.receipt ? ' (receipt kept)' : ''}`
export { money }
