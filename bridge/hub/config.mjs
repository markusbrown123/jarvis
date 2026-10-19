/**
 * Where each project lives, in ~/.jarvis/projects.json.
 *
 * Written once with the defaults below (found by looking at the actual repos)
 * and then left alone, so edits stick. Paths starting with ~ are expanded.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DATA_DIR } from './store.mjs'

const FILE = join(DATA_DIR, 'projects.json')

const DEFAULTS = {
  roblox: {
    repo: 'https://github.com/markusbrown123/traderedge',
    branch: 'claude/new-session-z8d9d8',
    studioPath: 'MarkusRobloxStudio',
    // A clone you already have is read in place (never checked out or changed).
    repoCandidates: ['~/traderedge', '~/dev/traderedge', '~/Documents/traderedge'],
    worker: { name: 'Windows PC (KUSTOP)', lan: '192.168.50.243' },
    refreshMinutes: 2,
  },
  automaton: {
    publicUrl: 'https://automaton.llc',
    supabaseUrl: 'https://zbpbkthvywkbhnydslkc.supabase.co',
    repoCandidates: ['~/automaton-premium', '~/automaton-', '~/automaton', '~/Documents/automaton-premium'],
    refreshMinutes: 5,
  },
  finance: {
    services: [
      { id: 'master-hub', name: 'master-hub', url: 'http://localhost:8501', health: '/_stcore/health', repoCandidates: ['~/master-hub'] },
      { id: 'futures-trader-scout', name: 'Futures Trader Scout', url: 'http://127.0.0.1:8000', health: '/', repoCandidates: ['~/futures-trader-scout', '~/futures_trader_scout'] },
    ],
    research: [
      { id: 'traderedge', name: 'traderedge (Polymarket research)', repoCandidates: ['~/traderedge'] },
      { id: 'insideredge', name: 'InsiderEdge Momentum', repoCandidates: ['~/insideredge'] },
    ],
    charts: [
      { symbol: 'CME_MINI:MNQ1!', label: 'Micro Nasdaq (MNQ)' },
      { symbol: 'CME:MBT1!', label: 'Micro Bitcoin (MBT)' },
    ],
    // The service Markus calls "Quant View". Unknown until he names it.
    quantView: { name: null, url: null },
    refreshMinutes: 1,
  },
}

export function expand(p) {
  return typeof p === 'string' && p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(over ?? {})) out[k] = k in base ? merge(base[k], v) : v
  return out
}

export function loadConfig() {
  let saved = {}
  if (existsSync(FILE)) {
    try {
      saved = JSON.parse(readFileSync(FILE, 'utf8'))
    } catch (err) {
      console.error(`[hub] ${FILE} is not valid JSON (${err.message}); using defaults`)
    }
  } else {
    writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2) + '\n')
  }
  return merge(DEFAULTS, saved)
}

export function saveConfig(cfg) {
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n')
}

export const CONFIG_FILE = FILE
