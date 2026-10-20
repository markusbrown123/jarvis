/**
 * JARVIS's view of the command center, as tools.
 *
 * So "what's running?", "what needs me?" or "how is Turbo doing?" are
 * answered from the same live data the dashboard shows — never from memory —
 * and "show me Sky Spire" moves the dashboard. Background jobs are started,
 * listed and cancelled here too.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import * as hub from './store.mjs'
import * as ledger from './expenses.mjs'

const ok = (text) => ({ content: [{ type: 'text', text }] })

function ago(ts) {
  if (!ts) return 'unknown'
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

function until(ts) {
  if (!ts) return 'unknown'
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

const openItems = (s) =>
  Object.values(s.items)
    .filter((i) => ['open', 'in_progress', 'verifying'].includes(i.state))
    .sort((a, b) => a.priority.localeCompare(b.priority))

function allowance(s) {
  const out = []
  for (const [name, label] of [['five_hour', '5-hour'], ['seven_day', 'weekly']]) {
    const w = s.usage.windows[name]
    if (!w) out.push(`${label} window: unavailable (no status line reading)`)
    else if (w.resetsAt && w.resetsAt < Date.now()) out.push(`${label} window: reset since the last reading; needs a fresh one`)
    else out.push(`${label} window: ${w.usedPct.toFixed(0)}% used, resets in ${until(w.resetsAt)} (read ${ago(w.observedAt)})`)
  }
  return out.join('; ')
}

function overview() {
  const s = hub.snapshot()
  const jobs = Object.values(s.jobs)
  const running = jobs.filter((j) => j.state === 'running')
  const needs = openItems(s)
  const recent = [...s.activity].reverse().slice(0, 6)
  const rb = s.projects.roblox
  const am = s.projects.automaton
  const fi = s.projects.finance
  const lines = [
    `RUNNING (${running.length}): ${running.map((j) => `${j.taskId ?? j.id} "${j.title}" on ${j.worker ?? '?'}${j.stale ? ' (no heartbeat — may be stuck)' : ''}`).join('; ') || 'nothing'}`,
    `NEEDS MARKUS (${needs.length}): ${needs.map((i) => `[${i.priority}] ${i.title}`).join('; ') || 'nothing'}`,
    `RECENT: ${recent.map((a) => `${ago(a.ts)} ${a.title}`).join('; ')}`,
    `ALLOWANCE: ${allowance(s)}`,
    `ROBLOX: ${rb?.games ? `${rb.games.length} games, active ${rb.activeGame}, next ${rb.nextGame}; studio repo at ${rb.source?.commit.short} pushed ${ago(rb.source?.commit.committedAt)}` : rb?.error ? `cannot read: ${rb.error}` : 'not read yet'}`,
    `AUTOMATON: site ${am?.site ? (am.site.ok ? 'up' : 'not answering') : 'unchecked'}; ${am?.sites ? `${am.sites.length} sites (${['needs_review', 'needs_edits', 'client_ready', 'deployed'].map((st) => `${am.sites.filter((x) => x.stage === st).length} ${st.replace('_', ' ')}`).join(', ')})` : `site pipeline unavailable (${am?.sitesError ?? 'no access'})`}`,
    `FINANCE: monitoring only, no broker connected; ${(fi?.services ?? []).map((x) => `${x.name} ${x.up ? 'running' : 'not running'}`).join(', ')}`,
  ]
  return lines.join('\n')
}

function project(name, detail) {
  const s = hub.snapshot()
  const jobs = Object.values(s.jobs).filter((j) => j.project === name)
  if (name === 'roblox') {
    const rb = s.projects.roblox
    if (!rb?.games) return `Roblox studio not read yet${rb?.error ? `: ${rb.error}` : ''}.`
    const needle = (detail ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const game = needle ? rb.games.find((g) => g.id.replace(/-/g, '').includes(needle) || g.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle)) : null
    if (game) {
      const gj = jobs.filter((j) => j.game === game.id && j.state !== 'completed')
      const done = jobs.filter((j) => j.game === game.id && j.state === 'completed').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)
      return [
        `${game.name} (${game.id})${game.active ? ' — the active game' : game.next ? ' — up next' : ''}.`,
        `Status: ${game.readmeStatus ?? 'unknown'}. Published: ${game.published ? 'yes' : 'no'}.`,
        `Last Studio playtest: ${game.playtest?.latest ? `${game.playtest.latest.date} — ${game.playtest.latest.heading} (${game.playtest.pass} PASS, ${game.playtest.fail} FAIL, ${game.playtest.runtimeVerified} runtime-verified)` : 'none'}.`,
        `Open tasks: ${gj.map((j) => `${j.taskId} ${j.title} [${j.state}${j.stale ? ', stale' : ''}] next: ${j.nextStep ?? '-'}`).join(' | ') || 'none'}.`,
        `Recently done: ${done.map((j) => `${j.taskId} ${j.title}`).join(' | ') || 'none in 3 days'}.`,
      ].join('\n')
    }
    return [
      `Active game ${rb.activeGame}, next ${rb.nextGame}. Repo ${rb.source?.commit.short} "${rb.source?.commit.subject}" pushed ${ago(rb.source?.commit.committedAt)}.`,
      `Games: ${rb.games.map((g) => `${g.name} (${g.tasks.running} running, ${g.tasks.queued} queued, ${g.tasks.blocked} blocked${g.playtest?.latest ? `, playtest ${g.playtest.latest.date}` : ''})`).join('; ')}.`,
      `Live gameplay preview: ${rb.live?.reason ?? 'unavailable'}`,
    ].join('\n')
  }
  if (name === 'automaton') {
    const am = s.projects.automaton
    if (!am) return 'Automaton not checked yet.'
    return [
      `automaton.llc ${am.site?.ok ? `up (${am.site.ms} ms)` : `not answering (${am.site?.status || am.site?.error})`}, checked ${ago(am.site?.checkedAt)}.`,
      am.repo?.commit ? `Repo ${am.repo.branch} @ ${am.repo.commit.short}, ${am.repo.changedFiles} uncommitted files.` : 'Repo not found on this Mac.',
      am.sites ? `Sites: ${am.sites.slice(0, 12).map((x) => `${x.name} [${x.stage}]`).join('; ')}.` : `Site pipeline unavailable: ${am.sitesError ?? 'no access'}.`,
      am.leads ? `Leads by stage: ${Object.entries(am.leads.byStage).map(([k, v]) => `${k} ${v}`).join(', ')}.` : `Leads unavailable: ${am.leadsError ?? 'no access'}.`,
      am.board ? `Task board: ${am.board.active.length} active (${am.board.active.slice(0, 5).join(', ')}).` : '',
    ].join('\n')
  }
  const fi = s.projects.finance
  if (!fi) return 'Finance not checked yet.'
  return [
    'Monitoring only — no broker, account or execution connection exists; there are no positions or P&L to report.',
    `Services: ${fi.services.map((x) => `${x.name} ${x.up ? 'running' : 'not running'} (${x.url})`).join('; ')}.`,
    `Research: ${fi.research.map((r) => `${r.name} ${r.commit ? `@ ${r.commit.short}` : 'not on this Mac'}`).join('; ')}.`,
    `Charts in the dashboard: ${fi.charts.map((c) => c.symbol).join(', ')} (TradingView widget, public data).`,
    `Quant View: ${fi.quantView?.url ?? 'not identified yet — waiting on Markus'}.`,
  ].join('\n')
}

const VIEWS = ['station', 'overview', 'roblox', 'finance', 'automaton', 'needs', 'jobs', 'terminal', 'activity', 'settings']

export function hubServer({ emit, runner, phone }) {
  return createSdkMcpServer({
    name: 'jarvis_hub',
    version: '1.0.0',
    // Small and asked for constantly: always in the prompt, so a project
    // question never pays an extra tool-search round trip first.
    alwaysLoad: true,
    tools: [
      tool(
        'hub_overview',
        'Live command-center summary: running jobs, things that need Markus, recent activity, Claude allowance, and one line per project (Roblox, Automaton, Finance). Use this for any "what\'s going on / what\'s running / what needs me / how much usage is left" question instead of guessing.',
        {},
        async () => ok(overview()),
      ),
      tool(
        'hub_project',
        'Detail for one project from live data. project: roblox | automaton | finance. For Roblox, pass a game name or id in `detail` (e.g. "turbo", "sky spire") to get that game\'s playtest, tasks and next steps.',
        { project: z.enum(['roblox', 'automaton', 'finance']), detail: z.string().optional() },
        async ({ project: p, detail }) => ok(project(p, detail)),
      ),
      tool(
        'dashboard_show',
        `Switch Markus's dashboard to a view: ${VIEWS.join(', ')}. Optionally select a Roblox game (id or name) or open the immersive voice view. Use when he asks to see or open something.`,
        { view: z.enum(VIEWS), game: z.string().optional(), immersive: z.boolean().optional() },
        async ({ view, game, immersive }) => {
          let gameId = null
          if (game) {
            const needle = game.toLowerCase().replace(/[^a-z0-9]/g, '')
            gameId = hub.snapshot().projects.roblox?.games?.find((g) => g.id.replace(/-/g, '').includes(needle) || g.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle))?.id ?? null
          }
          emit('dash', { view, game: gameId, immersive: Boolean(immersive) })
          return ok(`Showing ${view}${gameId ? ` (${gameId})` : ''}.`)
        },
      ),
      tool(
        'job_start',
        'Start a long piece of work as a background job (research, reading a codebase, writing a report, a multi-step check) so the conversation stays free. It runs as its own agent in that project\'s folder with the same read/write permissions as you, and shows on the dashboard with live progress. Say briefly that it has started; do not wait for it. Never use it for sending messages, deploying, publishing or payments.',
        {
          title: z.string().describe('Short title shown on the dashboard'),
          project: z.enum(['roblox', 'automaton', 'finance', 'other']),
          instructions: z.string().describe('Complete, standalone instructions for the job'),
          notify: z.enum(['phone', 'urgent']).optional().describe('Text Markus\'s phone the result even if he is at the dashboard ("phone"), or also raise an urgent alert if it fails ("urgent"). Use when he asks to be told when it is done.'),
        },
        async ({ notify, ...args }) => {
          try {
            const { id, cwd } = runner.start({ ...args, notify: notify ?? null })
            return ok(`Started background job ${id} in ${cwd}. It shows on the dashboard; it keeps running whatever happens in this conversation.`)
          } catch (err) {
            return ok(`Not started: ${err.message}`)
          }
        },
      ),
      tool(
        'job_list',
        'List background and project jobs with their state, stage and last update.',
        { include_finished: z.boolean().optional() },
        async ({ include_finished }) => {
          const jobs = Object.values(hub.snapshot().jobs)
            .filter((j) => include_finished || !['completed', 'canceled'].includes(j.state))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 20)
          return ok(jobs.map((j) => `${j.id} "${j.title}" [${j.state}${j.stale ? ', stale' : ''}] ${j.stage ?? ''} — ${ago(j.updatedAt)}${j.output ? ` — result: ${j.output.slice(0, 300)}` : ''}`).join('\n') || 'No jobs.')
        },
      ),
      tool(
        'job_cancel',
        'Cancel a background job JARVIS started (id from job_list; omit to cancel the most recent running one). Only JARVIS\'s own jobs can be cancelled from here — Roblox studio tasks and Claude Code sessions are stopped where they run.',
        { id: z.string().optional() },
        async ({ id }) => {
          const jobs = Object.values(hub.snapshot().jobs)
          const target = id ? jobs.find((j) => j.id === id) : jobs.filter((j) => j.source === 'jarvis' && j.state === 'running').sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (!target) return ok('No matching running job.')
          if (target.cancel !== 'supported') return ok(`${target.title} can't be cancelled from here (${target.source}); it has to be stopped where it runs.`)
          return ok(hub.cancelJob(target.id) ? `Cancellation requested for "${target.title}". It shows as cancelled once it has actually stopped.` : 'It had already finished.')
        },
      ),
      tool(
        'expense_log',
        `Log a business expense Markus told you about (or that is on a receipt he sent). Only log what he actually said or what the receipt clearly shows — never guess an amount; if the amount or vendor is unclear, ask instead. date is YYYY-MM-DD (default today). business: ${ledger.BUSINESSES.join(' | ')}. category: ${ledger.CATEGORIES.join(' | ')} (ai = Claude/OpenAI/ElevenLabs etc; hosting = Netlify/Supabase/domains; software = other subscriptions). Confirm back in one short line with the amount, vendor and business.`,
        {
          amount: z.number().positive(),
          vendor: z.string(),
          business: z.enum(ledger.BUSINESSES),
          category: z.enum(ledger.CATEGORIES),
          date: z.string().optional(),
          currency: z.string().optional().describe('ISO code, default USD'),
          note: z.string().optional(),
          recurring: z.enum(['monthly', 'yearly']).optional(),
          receipt: z.string().optional().describe('Receipt file path, when logging from a receipt photo'),
        },
        async (args) => {
          try {
            const e = ledger.addExpense({ ...args, source: 'jarvis' })
            const m = ledger.summarize(ledger.inPeriod('this-month').filter((x) => x.business === e.business))
            return ok(`Logged ${ledger.describe(e)}. ${e.business} this month: ${ledger.money(m.total)} across ${m.count}.`)
          } catch (err) {
            return ok(`Not logged: ${err.message}`)
          }
        },
      ),
      tool(
        'expense_report',
        'Business spending from the ledger: totals by business and category, and the entries. period: this-month | last-month | this-year | all | YYYY-MM. Optional business/category filters. Use for any "how much did I spend / what are my expenses" question — never estimate.',
        { period: z.string().optional(), business: z.enum(ledger.BUSINESSES).optional(), category: z.enum(ledger.CATEGORIES).optional() },
        async ({ period = 'this-month', business, category }) => {
          const list = ledger.listExpenses({ period, business, category })
          if (!list.length) return ok(`No expenses logged for ${period}${business ? ` in ${business}` : ''}${category ? ` (${category})` : ''}.`)
          const sum = ledger.summarize(list)
          const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${ledger.money(v)}`).join(', ')
          return ok(
            [
              `${period}: ${ledger.money(sum.total)} in ${sum.count} expenses${sum.currencies.length > 1 ? ` (mixed currencies: ${sum.currencies.join(', ')} — totals are not converted)` : ''}.`,
              `By business: ${fmt(sum.byBusiness)}.`,
              `By category: ${fmt(sum.byCategory)}.`,
              `Entries:\n${list.slice(0, 40).map(ledger.describe).join('\n')}`,
            ].join('\n'),
          )
        },
      ),
      tool(
        'expense_fix',
        'Correct or delete a logged expense by id (ids are in expense_report). Use when Markus says an entry is wrong. delete=true removes it.',
        { id: z.string(), delete: z.boolean().optional(), amount: z.number().positive().optional(), vendor: z.string().optional(), business: z.enum(ledger.BUSINESSES).optional(), category: z.enum(ledger.CATEGORIES).optional(), date: z.string().optional(), note: z.string().optional() },
        async ({ id, delete: del, ...patch }) => {
          try {
            if (del) return ok(ledger.deleteExpense(id) ? `Deleted ${id}.` : `No expense ${id}.`)
            return ok(`Updated ${ledger.describe(ledger.updateExpense(id, patch))}.`)
          } catch (err) {
            return ok(`Not changed: ${err.message}`)
          }
        },
      ),
      tool(
        'phone_notify',
        'Message Markus\'s phone (Telegram; urgent also goes through Pushover, which repeats and breaks through Do Not Disturb). Use when he asks you to text/remind/alert him, or for something genuinely time-critical. urgent=true only for real emergencies or when he explicitly asks for an urgent alert. Never for routine chatter.',
        { message: z.string(), title: z.string().optional(), urgent: z.boolean().optional() },
        async ({ message, title, urgent }) => {
          if (!phone) return ok('The phone link is not running.')
          const r = await phone.notify({ title: title ?? 'JARVIS', message, urgent: Boolean(urgent), force: true })
          return ok(r.sent.length ? `Sent via ${r.sent.join(' + ')}${r.silent ? ' (silently — quiet hours)' : ''}.` : 'Not sent: no phone channel is set up yet (Settings → Phone).')
        },
      ),
    ],
  })
}
