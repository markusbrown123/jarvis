/**
 * Connect Claude Code to JARVIS: status line (usage) and hooks (activity).
 *
 *   node scripts/setup-claude.mjs           add JARVIS's forwarding
 *   node scripts/setup-claude.mjs --remove  take it out again
 *
 * Edits ~/.claude/settings.json after copying it to a timestamped backup.
 * Keeps every hook you already have, and keeps your status line by chaining
 * it: the old command is saved to ~/.jarvis/statusline-chain and still runs.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BIN = resolve(here, '..', 'bin')
const HOOK = join(BIN, 'jarvis-hook')
const STATUS = join(BIN, 'jarvis-statusline')
const SETTINGS = join(homedir(), '.claude', 'settings.json')
const CHAIN = join(homedir(), '.jarvis', 'statusline-chain')
const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SessionEnd',
  'SubagentStart', 'SubagentStop',
]
const remove = process.argv.includes('--remove')

mkdirSync(dirname(SETTINGS), { recursive: true })
mkdirSync(dirname(CHAIN), { recursive: true })
let settings = {}
if (existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  } catch (err) {
    console.error(`${SETTINGS} is not valid JSON (${err.message}). Nothing changed.`)
    process.exit(1)
  }
  const backup = `${SETTINGS}.jarvis-backup-${Date.now()}`
  copyFileSync(SETTINGS, backup)
  console.log(`Backed up your settings to ${backup}`)
}

const isOurs = (h) => h?.command === HOOK
settings.hooks ??= {}
for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length)
  if (!remove) groups.push({ hooks: [{ type: 'command', command: HOOK, async: true, timeout: 5 }] })
  if (groups.length) settings.hooks[ev] = groups
  else delete settings.hooks[ev]
}
if (!Object.keys(settings.hooks).length) delete settings.hooks

const current = settings.statusLine?.command
if (remove) {
  if (current === STATUS) {
    if (existsSync(CHAIN) && readFileSync(CHAIN, 'utf8').trim()) {
      settings.statusLine = { type: 'command', command: readFileSync(CHAIN, 'utf8').trim() }
    } else delete settings.statusLine
  }
  rmSync(CHAIN, { force: true })
} else if (current !== STATUS) {
  if (current) writeFileSync(CHAIN, current + '\n')
  settings.statusLine = { ...(settings.statusLine ?? {}), type: 'command', command: STATUS }
}

writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
console.log(remove ? 'Removed JARVIS from Claude Code settings.' : 'Claude Code now forwards its status line and hooks to JARVIS (127.0.0.1 only).')
console.log('Takes effect in new Claude Code sessions, or after /hooks in a running one.')
