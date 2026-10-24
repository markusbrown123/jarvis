/**
 * Finance source: monitoring only.
 *
 * What exists today is research tooling — master-hub (Streamlit), Futures
 * Trader Scout (FastAPI), traderedge and InsiderEdge — none of which connects
 * to a broker or places orders. This reports whether each local service is up
 * and what revision each repo is on, and reads what they've found straight
 * from their own SQLite files, read-only: master-hub's findings and its
 * strategy lab's paper-trade equity points, the Scout's trader rankings and
 * live streams. Each is labelled for what it is (research, paper trades,
 * public traders), never as an account. Charts are TradingView widgets drawn
 * in the page; an embedded chart is not account connectivity, and the view
 * says so. No execution path exists here or is added.
 *
 * The two services can be started and stopped from the dashboard, each with
 * its own virtualenv (`.venv` in its repo), logging to ~/.jarvis/logs.
 */

import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { git } from './git.mjs'
import { expand, loadConfig } from './config.mjs'
import * as hub from './store.mjs'

function findRepo(candidates = []) {
  for (const c of candidates.map(expand)) if (c && existsSync(join(c, '.git'))) return c
  return null
}

async function lastCommit(repo) {
  try {
    const [short, ct, ...s] = (await git(repo, ['log', '-1', '--format=%h%x09%ct%x09%s'])).trim().split('\t')
    return { short, committedAt: Number(ct) * 1000, subject: s.join('\t') }
  } catch {
    return null
  }
}

async function health(svc) {
  const t0 = Date.now()
  try {
    const res = await fetch(svc.url + (svc.health ?? '/'), { signal: AbortSignal.timeout(3000) })
    return { up: res.ok, status: res.status, ms: Date.now() - t0 }
  } catch {
    return { up: false, status: 0, ms: Date.now() - t0 }
  }
}

// ---------------------------------------------------------------- the data

/** Rows from a SQLite file, opened read-only (Node's own SQLite, else the sqlite3 that ships with macOS). */
async function readRows(file, sql) {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      return db.prepare(sql).all()
    } finally {
      db.close()
    }
  } catch (err) {
    if (!/node:sqlite|No such built-in|Cannot find|ERR_UNKNOWN_BUILTIN_MODULE/i.test(String(err.message ?? err.code))) throw err
  }
  const out = await new Promise((resolve, reject) =>
    execFile('sqlite3', ['-readonly', '-json', file, sql], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout))),
  )
  return out.trim() ? JSON.parse(out) : []
}

/** SQLAlchemy writes UTC as "YYYY-MM-DD HH:MM:SS[.ffffff]". */
const when = (v) => {
  if (v == null) return null
  const t = Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'))
  return Number.isFinite(t) ? t : null
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const json = (v, fallback) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : (v ?? fallback)
  } catch {
    return fallback
  }
}

/** The newest of the files that exist. */
function newest(paths) {
  const have = paths.filter((p) => p && existsSync(p))
  return have.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

/** master-hub's database: HUB_DATABASE_URL in its .env, else masterhub.db where it runs. */
function masterHubDb(repo) {
  let url = process.env.HUB_DATABASE_URL ?? null
  try {
    url = readFileSync(join(repo, '.env'), 'utf8').match(/^\s*HUB_DATABASE_URL\s*=\s*["']?([^"'\n]+)/m)?.[1] ?? url
  } catch {
    /* no .env */
  }
  const file = url?.startsWith('sqlite:///') ? url.slice('sqlite:///'.length) : 'masterhub.db'
  return { file: isAbsolute(file) ? file : join(repo, file), from: url ? 'HUB_DATABASE_URL' : 'default' }
}

/** The Scout's: data/scout.db in its repo, or the packaged app's under Application Support. */
function scoutDb(repo) {
  const app = join(homedir(), 'Library', 'Application Support', 'FuturesTraderScout', 'data', 'scout.db')
  const file = newest([process.env.SCOUT_DB_PATH, repo && join(repo, 'data', 'scout.db'), app]) ?? (repo ? join(repo, 'data', 'scout.db') : app)
  return { file }
}

async function masterHubData(repo) {
  const { file } = masterHubDb(repo)
  if (!existsSync(file)) return { db: file, error: 'No database yet: master-hub writes it on its first refresh.' }
  const out = { db: file, error: null, findings: [], kinds: {}, strategies: [] }
  try {
    const rows = await readRows(file, 'SELECT * FROM findings ORDER BY persisted_at DESC LIMIT 400')
    for (const r of rows) out.kinds[r.kind] = (out.kinds[r.kind] ?? 0) + 1
    out.findings = rows
      .map((r) => ({
        engine: r.source_engine,
        kind: r.kind,
        subject: r.subject,
        title: r.title ?? null,
        summary: r.summary ?? null,
        confidence: num(r.confidence),
        sampleSize: num(r.sample_size),
        // Kept apart, never summed (master-hub's own rule).
        realizedPnl: num(r.realized_pnl),
        unrealizedPnl: num(r.unrealized_pnl),
        riskFlags: json(r.risk_flags_json, []),
        paper: r.paper_trade_status ?? null,
        forward: r.forward_test_status ?? null,
        reviewOnly: r.review_only == null ? true : Boolean(r.review_only),
        url: r.source_url ?? null,
        rank: num(r.rank_score),
        at: when(r.finding_ts),
        savedAt: when(r.persisted_at),
      }))
      .sort((a, b) => (b.rank ?? -Infinity) - (a.rank ?? -Infinity) || (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .slice(0, 30)
    out.updatedAt = Math.max(0, ...rows.map((r) => when(r.persisted_at) ?? 0)) || null
  } catch (err) {
    out.error = `findings: ${err.message}`
  }
  try {
    // The strategy lab's forward paper trades: realized points only, never backfilled.
    const pts = await readRows(file, 'SELECT * FROM equity_points ORDER BY resolved_at DESC LIMIT 5000')
    const by = new Map()
    for (const p of pts.reverse()) {
      const key = `${p.source_engine}|${p.strategy}`
      const s = by.get(key) ?? { engine: p.source_engine, strategy: p.strategy, trades: 0, equity: null, lastAt: null, points: [] }
      s.trades++
      s.equity = num(p.equity)
      s.lastAt = when(p.resolved_at)
      s.points.push([s.lastAt, num(p.equity)])
      by.set(key, s)
    }
    out.strategies = [...by.values()].map((s) => ({ ...s, points: s.points.slice(-120) })).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  } catch (err) {
    out.equityError = /no such table/i.test(err.message) ? 'No strategy-lab paper trades recorded yet.' : err.message
  }
  return out
}

async function scoutData(repo) {
  const { file } = scoutDb(repo)
  if (!existsSync(file)) return { db: file, error: 'No database yet: the Scout writes it on its first scan ("Run scan now").' }
  const out = { db: file, error: null, traders: [], live: [], sources: null }
  try {
    const rows = await readRows(file, 'SELECT * FROM trader_profiles ORDER BY final_score DESC LIMIT 15')
    out.traders = rows.map((r) => ({
      name: r.trader_name,
      platform: r.platform || null,
      url: r.channel_url || null,
      propFirm: r.prop_firm || null,
      products: r.products || null,
      payouts30d: num(r.verified_payout_count_30d),
      payouts90d: num(r.verified_payout_count_90d),
      paid90d: num(r.total_verified_payouts_90d),
      consistency: num(r.consistency_score),
      redFlags: num(r.red_flag_score),
      score: num(r.final_score),
      why: r.score_reason || null,
    }))
  } catch (err) {
    out.error = `rankings: ${err.message}`
  }
  try {
    out.live = (await readRows(file, 'SELECT * FROM live_streams WHERE is_live = 1 ORDER BY detected_at DESC LIMIT 10')).map((r) => ({
      platform: r.platform,
      channel: r.channel_name,
      title: r.stream_title,
      url: r.stream_url || r.channel_url,
      viewers: num(r.viewer_count_if_available),
      products: r.products_detected || null,
      at: when(r.detected_at),
    }))
  } catch {
    /* older databases: no live table */
  }
  try {
    const src = await readRows(file, 'SELECT status, last_checked_at FROM sources')
    out.sources = { count: src.length, errors: src.filter((x) => x.status === 'error').length, lastChecked: Math.max(0, ...src.map((x) => when(x.last_checked_at) ?? 0)) || null }
  } catch {
    /* no sources table */
  }
  return out
}

// ---------------------------------------------------------------- start / stop

/** How each service runs from its repo, with its own virtualenv. */
const RUN = {
  'master-hub': {
    cmd: ['.venv/bin/streamlit', 'run', 'dashboard/app.py', '--server.headless', 'true', '--server.port', '8501'],
    setup: 'cd ~/master-hub && python3 -m venv .venv && .venv/bin/pip install -e ../insideredge -e ../traderedge -e ".[serve]"',
  },
  'futures-trader-scout': {
    cmd: ['.venv/bin/uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    setup: 'cd ~/futures-trader-scout && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
  },
}
const PIDS = join(hub.DATA_DIR, 'services.json')
const LOGS = join(hub.DATA_DIR, 'logs')
const pids = () => {
  try {
    return JSON.parse(readFileSync(PIDS, 'utf8'))
  } catch {
    return {}
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
/** The process JARVIS started for a service, if it's still running. */
function ours(id) {
  const rec = pids()[id]
  return rec && alive(rec.pid) ? rec : null
}

function startService(cfg, id) {
  const svc = cfg.services.find((s) => s.id === id)
  const run = RUN[id]
  if (!svc || !run) throw new Error(`No service ${id}`)
  const repo = findRepo(svc.repoCandidates)
  if (!repo) throw new Error(`${svc.name}'s repo isn't on this Mac (looked in ${svc.repoCandidates.join(', ')}).`)
  if (ours(id)) throw new Error(`${svc.name} is already running (started by JARVIS).`)
  const bin = join(repo, run.cmd[0])
  if (!existsSync(bin)) throw new Error(`${svc.name} has no virtualenv yet. Set it up once: ${run.setup}`)
  mkdirSync(LOGS, { recursive: true })
  const log = join(LOGS, `${id}.log`)
  const fd = openSync(log, 'a')
  // Its own process group, so stopping it takes its workers with it.
  const child = spawn(bin, run.cmd.slice(1), { cwd: repo, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PYTHONUNBUFFERED: '1' } })
  closeSync(fd)
  child.unref()
  writeFileSync(PIDS, JSON.stringify({ ...pids(), [id]: { pid: child.pid, startedAt: Date.now(), log } }, null, 2), { mode: 0o600 })
  hub.activity({ source: 'jarvis', project: 'finance', title: `Started ${svc.name}`, detail: `${run.cmd.join(' ')} in ${repo} · log ${log}`, level: 'info' })
  return { pid: child.pid, log }
}

async function stopService(cfg, id) {
  const svc = cfg.services.find((s) => s.id === id)
  if (!svc) throw new Error(`No service ${id}`)
  const rec = ours(id)
  if (!rec) {
    const h = await health(svc)
    throw new Error(h.up ? `${svc.name} is running, but JARVIS didn't start it — stop it where it was started.` : `${svc.name} isn't running.`)
  }
  const kill = (sig) => {
    try {
      process.kill(-rec.pid, sig)
    } catch {
      try {
        process.kill(rec.pid, sig)
      } catch {
        /* gone */
      }
    }
  }
  kill('SIGTERM')
  for (let i = 0; i < 20 && alive(rec.pid); i++) await new Promise((r) => setTimeout(r, 250))
  if (alive(rec.pid)) kill('SIGKILL')
  const rest = pids()
  delete rest[id]
  writeFileSync(PIDS, JSON.stringify(rest, null, 2), { mode: 0o600 })
  hub.activity({ source: 'jarvis', project: 'finance', title: `Stopped ${svc.name}`, level: 'info' })
}

async function refresh(cfg) {
  const services = await Promise.all(
    cfg.services.map(async (s) => {
      const repo = findRepo(s.repoCandidates)
      const run = RUN[s.id]
      const mine = ours(s.id)
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        ...(await health(s)),
        repo,
        commit: repo ? await lastCommit(repo) : null,
        checkedAt: Date.now(),
        // Start/stop: what JARVIS can do with it, honestly.
        control: !run ? null : { managed: Boolean(mine), startedAt: mine?.startedAt ?? null, log: mine?.log ?? join(LOGS, `${s.id}.log`), ready: Boolean(repo && existsSync(join(repo, run.cmd[0]))), setup: run.setup },
      }
    }),
  )
  const repoOf = (id) => services.find((x) => x.id === id)?.repo ?? null
  const [masterHub, scout] = await Promise.all([
    repoOf('master-hub') ? masterHubData(repoOf('master-hub')).catch((err) => ({ error: err.message })) : { error: 'master-hub repo not on this Mac.' },
    scoutData(repoOf('futures-trader-scout')).catch((err) => ({ error: err.message })),
  ])
  const research = await Promise.all(
    cfg.research.map(async (r) => {
      const repo = findRepo(r.repoCandidates)
      return { id: r.id, name: r.name, repo, commit: repo ? await lastCommit(repo) : null }
    }),
  )
  hub.setProject('finance', {
    id: 'finance',
    name: 'Finance',
    mode: 'monitoring only',
    broker: null,
    services,
    research,
    data: { masterHub, scout },
    charts: cfg.charts,
    quantView: cfg.quantView,
    note: 'Research and monitoring. No broker or execution connection exists; nothing here can place an order.',
  })

  const qv = cfg.quantView ?? {}
  hub.upsertItem({
    id: 'finance:quant-view',
    source: 'jarvis',
    project: 'finance',
    title: 'Which service is "Quant View"?',
    why: 'You asked for Quant View in the finance workspace, but no project, link or config mentions it (QuantVue? something else?), so JARVIS cannot connect or even link to it yet.',
    instructions: `Tell JARVIS what it is ("Quant View is … at …") — he records it — or put it in finance.quantView in ${hub.DATA_DIR}/projects.json.`,
    prepared: 'Searched every repo (master-hub, futures-trader-scout, traderedge) and the Windows PC: no references.',
    verify: { kind: 'config', key: 'finance.quantView.name', note: 'Resolves once you tell JARVIS what it is (or it is set in the config).' },
    resumes: 'A Quant View card with the right link and whatever it supports (embed, export or link only).',
    priority: 'P3',
    state: qv.url || qv.name ? 'resolved' : undefined,
    actions: [{ kind: 'copy', label: 'Copy config path', value: `${hub.DATA_DIR}/projects.json` }, { kind: 'check', label: 'Check again' }],
  })
}

export function startFinance(cfg) {
  // Re-read the config each time, so edits to projects.json take effect.
  const run = () => refresh(loadConfig().finance).catch((err) => console.warn('[hub] finance:', err.message))
  void run()
  setInterval(run, Math.max(1, cfg.refreshMinutes) * 60000).unref()
  return {
    refresh: run,
    start: async (id) => {
      const r = startService(loadConfig().finance, id)
      // Give it a moment to come up before saying how it is.
      setTimeout(() => void run(), 4000)
      return r
    },
    stop: async (id) => {
      await stopService(loadConfig().finance, id)
      await run()
    },
  }
}
