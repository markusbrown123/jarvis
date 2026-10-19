/**
 * Finance source: monitoring only.
 *
 * What exists today is research tooling — master-hub (Streamlit), Futures
 * Trader Scout (FastAPI), traderedge and InsiderEdge — none of which connects
 * to a broker or places orders. This reports whether each local service is up
 * and what revision each repo is on. Charts are TradingView widgets drawn in
 * the page; an embedded chart is not account connectivity, and the view says
 * so. No execution path exists here or is added.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
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

async function refresh(cfg) {
  const services = await Promise.all(
    cfg.services.map(async (s) => {
      const repo = findRepo(s.repoCandidates)
      return { id: s.id, name: s.name, url: s.url, ...(await health(s)), repo, commit: repo ? await lastCommit(repo) : null, checkedAt: Date.now() }
    }),
  )
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
    instructions: `Send the exact site link, or put it in finance.quantView.url in ${hub.DATA_DIR}/projects.json.`,
    prepared: 'Searched every repo (master-hub, futures-trader-scout, traderedge) and the Windows PC: no references.',
    verify: { kind: 'config', key: 'finance.quantView.url', note: 'Resolves once a link is configured.' },
    resumes: 'A Quant View card with the right link and whatever it supports (embed, export or link only).',
    priority: 'P3',
    state: qv.url ? 'resolved' : undefined,
    actions: [{ kind: 'copy', label: 'Copy config path', value: `${hub.DATA_DIR}/projects.json` }, { kind: 'check', label: 'Check again' }],
  })
}

export function startFinance(cfg) {
  // Re-read the config each time, so edits to projects.json take effect.
  const run = () => refresh(loadConfig().finance).catch((err) => console.warn('[hub] finance:', err.message))
  void run()
  setInterval(run, Math.max(1, cfg.refreshMinutes) * 60000).unref()
  return { refresh: run }
}
