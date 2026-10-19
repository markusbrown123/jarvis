/**
 * Automaton source: the website pipeline at automaton.llc.
 *
 * Reads, never writes. Site rows come from Supabase with the public anon key
 * the site already ships to every browser (read from the local repo at run
 * time, so it is never copied anywhere), selecting status columns only —
 * never generated_html. The repo itself is read with plain git commands. No
 * deploy, email, call or payment path is touched from here.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.mjs'
import { expand, loadConfig } from './config.mjs'
import * as hub from './store.mjs'

/** portfolio_sites.status, in pipeline order (see _lib/portfolio-status.js). */
export const SITE_STAGES = ['generated_draft', 'needs_review', 'needs_edits', 'approved', 'client_ready', 'deployed']
/** leads.sale_stage, in order. */
export const SALE_STAGES = [
  'pitched', 'sample_built', 'sample_sent', 'in_revision', 'approved', 'pay_link_sent',
  'paid', 'survey_sent', 'survey_done', 'site_live', 'google_connected', 'complete', 'lost',
]

const ROUTES = [
  ['/', 'Landing'], ['/builder', 'Builder'], ['/editor', 'Editor'], ['/portfolio', 'Portfolio'],
  ['/review', 'Review'], ['/manager', 'Manager'], ['/caller', 'Caller'], ['/survey', 'Survey'],
  ['/data', 'Data'], ['/scanner', 'Scanner'],
]

let boardCache = { mtime: 0, tasks: [] }

function findRepo(candidates) {
  for (const c of candidates.map(expand)) {
    if (c && existsSync(join(c, 'netlify-deploy')) && existsSync(join(c, '.git'))) return c
  }
  return null
}

/** The anon key the site itself ships, read from the repo, or from the env. */
function anonKey(repo) {
  if (process.env.AUTOMATON_SUPABASE_ANON_KEY) return process.env.AUTOMATON_SUPABASE_ANON_KEY
  if (!repo) return null
  for (const f of ['netlify-deploy/portfolio.html', 'netlify-deploy/builder.html']) {
    try {
      const m = readFileSync(join(repo, f), 'utf8').match(/SB_KEY\s*=\s*'([A-Za-z0-9._-]{40,})'/)
      if (m) return m[1]
    } catch {
      /* try the next */
    }
  }
  return null
}

async function rest(cfg, key, path) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  return res.json()
}

async function probe(url) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) })
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 }
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: err.message }
  }
}

/** Active tasks on the AI task board: `### slug` headings under ## Active Tasks. */
function boardTasks(repo) {
  const f = join(repo, 'AI_TASK_BOARD.md')
  try {
    const m = statSync(f).mtimeMs
    if (m === boardCache.mtime) return boardCache.tasks
    const text = readFileSync(f, 'utf8')
    const start = text.indexOf('## Active Tasks')
    const end = text.indexOf('\n## Done', start)
    const section = start === -1 ? '' : text.slice(start, end === -1 ? undefined : end)
    const tasks = [...section.matchAll(/^###\s+(.+)$/gm)].map((x) => x[1].trim())
    boardCache = { mtime: m, tasks }
    return tasks
  } catch {
    return []
  }
}

async function repoInfo(repo) {
  const [log, branch, status] = await Promise.all([
    git(repo, ['log', '-1', '--format=%h%x09%ct%x09%s']),
    git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repo, ['status', '--porcelain']),
  ])
  const [short, ct, ...subject] = log.trim().split('\t')
  return {
    path: repo,
    branch: branch.trim(),
    commit: { short, committedAt: Number(ct) * 1000, subject: subject.join('\t') },
    changedFiles: status.split('\n').filter(Boolean).length,
  }
}

async function refresh(cfg) {
  const repo = findRepo(cfg.repoCandidates)
  const key = anonKey(repo)
  const out = {
    id: 'automaton',
    name: 'Automaton',
    publicUrl: cfg.publicUrl,
    routes: ROUTES.map(([path, label]) => ({ path, label, url: cfg.publicUrl + path })),
    repo: null,
    site: null,
    sites: null,
    sitesError: null,
    leads: null,
    leadsError: null,
    board: null,
  }

  out.site = { ...(await probe(cfg.publicUrl)), checkedAt: Date.now() }

  if (repo) {
    try {
      out.repo = await repoInfo(repo)
    } catch (err) {
      out.repo = { path: repo, error: err.message }
    }
    out.board = { active: boardTasks(repo) }
  }

  if (key) {
    try {
      // Status columns only. generated_html is the whole site and never needed.
      const cols = 'id,business_name,category,location,status,preview_site_url,created_at,updated_at,deleted_at'
      let rows
      try {
        rows = await rest(cfg, key, `portfolio_sites?select=${cols},published_url,publish_status,published_at&order=updated_at.desc&limit=200`)
      } catch {
        rows = await rest(cfg, key, `portfolio_sites?select=${cols}&order=updated_at.desc&limit=200`)
      }
      out.sites = rows
        .filter((r) => !r.deleted_at && r.status !== 'deleted')
        .map((r) => ({
          id: r.id,
          name: r.business_name,
          category: r.category,
          location: r.location,
          stage: r.status === 'published' ? 'needs_review' : r.status,
          previewUrl: r.preview_site_url,
          publishedUrl: r.published_url ?? null,
          publishStatus: r.publish_status ?? null,
          publishedAt: r.published_at ? Date.parse(r.published_at) : null,
          updatedAt: Date.parse(r.updated_at),
        }))
      const keep = []
      for (const s of out.sites.slice(0, 40)) {
        const id = `automaton:${s.id}`
        keep.push(id)
        hub.setPreview({
          id,
          project: 'automaton',
          kind: 'SITE',
          title: s.name,
          url: s.publishedUrl ?? s.previewUrl,
          stage: s.stage,
          capturedAt: s.updatedAt,
          note: s.publishedUrl ? 'Published site' : 'Hosted preview (automaton.llc/p/…)',
        })
      }
      hub.prunePreviews('automaton', keep)
    } catch (err) {
      out.sitesError = err.message
    }
    try {
      const rows = await rest(cfg, key, 'leads?select=sale_stage&limit=10000')
      const by = {}
      for (const r of rows) by[r.sale_stage ?? 'unset'] = (by[r.sale_stage ?? 'unset'] ?? 0) + 1
      out.leads = { total: rows.length, byStage: by }
    } catch (err) {
      out.leadsError = err.message.startsWith('401') || err.message.startsWith('403')
        ? 'Not readable with the public key (protected by row-level security).'
        : err.message
    }
  }

  hub.setProject('automaton', out)

  if (!repo) {
    hub.upsertItem({
      id: 'automaton:repo-path',
      source: 'jarvis',
      project: 'automaton',
      title: 'Tell JARVIS where your Automaton folder is',
      why: 'The site pipeline, previews and task board are read from your local Automaton repo, and none of the usual folders exist on this Mac.',
      instructions: `Add its path to automaton.repoCandidates in ${hub.DATA_DIR}/projects.json (for example "~/automaton-premium").`,
      prepared: `Checked: ${cfg.repoCandidates.join(', ')}.`,
      verify: { kind: 'source', note: 'Resolves on the next refresh that finds the repo.' },
      resumes: 'Site list, previews and repo state appear automatically.',
      priority: 'P2',
      actions: [{ kind: 'copy', label: 'Copy config path', value: `${hub.DATA_DIR}/projects.json` }, { kind: 'check', label: 'Check again' }],
    })
  } else if (hub.getItem('automaton:repo-path')?.state !== 'resolved' && hub.getItem('automaton:repo-path')) {
    hub.upsertItem({ id: 'automaton:repo-path', state: 'resolved' }, { fromSource: false })
  }
  if (out.site && !out.site.ok) {
    hub.activity({
      id: `automaton:site-down:${Math.floor(Date.now() / 600000)}`,
      source: 'automaton',
      project: 'automaton',
      title: `automaton.llc did not answer (${out.site.status || out.site.error})`,
      level: 'error',
    })
  }
}

export function startAutomaton(cfg) {
  // Re-read the config each time, so edits to projects.json take effect.
  const run = () => refresh(loadConfig().automaton).catch((err) => console.warn('[hub] automaton:', err.message))
  void run()
  setInterval(run, Math.max(1, cfg.refreshMinutes) * 60000).unref()
  return { refresh: run }
}
