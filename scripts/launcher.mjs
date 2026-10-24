#!/usr/bin/env node
/**
 * The `jarvis` command's helper: asks the running bridge how he is, so the
 * terminal can say so and link the phone without opening Settings.
 *
 *   node scripts/launcher.mjs phone   telegram|paired|bot|chat|pushover (1/0 flags)
 *   node scripts/launcher.mjs pair    a fresh pairing code (valid 15 minutes)
 *   node scripts/launcher.mjs board   what's running: brain, write mode, voice, phone, iPhone voice, Claude Code, awake
 *   tailscale status --json | node scripts/launcher.mjs remote-save
 *                                     record this Mac's tailnet name and your login (~/.jarvis/remote.json)
 *
 * It reads the bridge on localhost with the local API token (~/.jarvis/token).
 * No secret is printed: the phone's tokens stay in the Keychain.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BRIDGE = `http://localhost:${process.env.JARVIS_PORT ?? 8788}`
const DATA = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis')
const token = () => {
  try {
    return readFileSync(join(DATA, 'token'), 'utf8').trim()
  } catch {
    return ''
  }
}

async function get(path) {
  const res = await fetch(BRIDGE + path, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

async function post(path, body = {}) {
  const res = await fetch(BRIDGE + path, { method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

const phoneOf = async () => (await get('/api/state')).phone ?? {}

/** Whether Claude Code forwards its usage and activity here (`jarvis setup-claude`). */
function claudeForwarded() {
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'))
    return String(s.statusLine?.command ?? '').includes('jarvis-statusline')
  } catch {
    return false
  }
}

/** Whether `caffeinate` is holding the Mac awake (bin/jarvis starts it beside him). */
function keptAwake() {
  try {
    return execFileSync('pgrep', ['-x', 'caffeinate'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0
  } catch {
    return false
  }
}

/** `jarvis remote`'s record: this Mac's tailnet name and the login allowed in. */
function remote() {
  try {
    return JSON.parse(readFileSync(join(DATA, 'remote.json'), 'utf8'))
  } catch {
    return null
  }
}

const what = process.argv[2]
if (what === 'remote-save') {
  let s = ''
  for await (const c of process.stdin) s += c
  try {
    const st = JSON.parse(s)
    const host = String(st.Self?.DNSName ?? '').replace(/\.$/, '')
    const login = st.User?.[String(st.Self?.UserID)]?.LoginName
    if (!host.endsWith('.ts.net')) throw new Error('This Mac has no ts.net name: turn on MagicDNS for your tailnet (Tailscale admin console → DNS).')
    if (!login) throw new Error("Couldn't tell which Tailscale account this Mac is signed in to.")
    mkdirSync(DATA, { recursive: true })
    writeFileSync(join(DATA, 'remote.json'), JSON.stringify({ host, login, at: Date.now() }, null, 2) + '\n', { mode: 0o600 })
    console.log(`\nOn your iPhone (Tailscale on, signed in as ${login}), open in Safari:\n\n    https://${host}:5173\n\nTap to start him, allow the microphone, and talk. Share → Add to Home Screen keeps it one tap away.\nOnly ${login} is let in, through Tailscale; nothing is open to the internet. Undo with: jarvis remote off\n`)
  } catch (err) {
    console.error(`  ${err.message}`)
    process.exit(1)
  }
  process.exit(0)
}
try {
  if (what === 'phone') {
    const p = await phoneOf()
    const t = p.telegram ?? {}
    console.log([t.configured ? 1 : 0, t.paired ? 1 : 0, t.bot ?? '', t.chatName ?? '', p.pushover?.configured ? 1 : 0].join('|'))
  } else if (what === 'pair') {
    console.log((await post('/api/phone/pair')).pairing?.code ?? '')
  } else if (what === 'board') {
    const h = await get('/health')
    const p = await phoneOf()
    const t = p.telegram ?? {}
    const on = (b) => (b ? '\x1b[32m' : '\x1b[33m')
    const row = (k, ok, v) => console.log(`  ${k.padEnd(12)} ${on(ok)}${v}\x1b[0m`)
    console.log('')
    row('Brain', true, `${h.model} · effort ${h.effort}`)
    row('Write mode', h.writes, h.writes ? 'ON — he can act: files, shell, browser, phone, sending' : 'off — read-only (jarvis without --safe turns it on)')
    row('Voice', h.tts, h.tts ? 'ElevenLabs' : 'browser speech (no ElevenLabs key in the Keychain)')
    const phone = !t.configured ? 'not linked — jarvis setup-phone telegram' : !t.paired ? `bot ready${t.bot ? ` (@${t.bot})` : ''}, not paired yet` : `Telegram, paired with ${t.chatName ?? 'your chat'}${t.bot ? ` via @${t.bot}` : ''}${t.error ? ` — ${t.error}` : ''}`
    row('Phone', Boolean(t.configured && t.paired && !t.error), phone)
    row('Urgent', Boolean(p.pushover?.configured), p.pushover?.configured ? 'Pushover ready (rings through Do Not Disturb)' : 'Pushover not set up — jarvis setup-phone pushover')
    const r = remote()
    row('iPhone voice', Boolean(r), r ? `https://${r.host}:5173 (Tailscale, ${r.login})` : 'not set up — jarvis remote (needs Tailscale)')
    row('Claude Code', claudeForwarded(), claudeForwarded() ? 'usage + activity forwarded' : 'not forwarded — jarvis setup-claude')
    const awake = keptAwake()
    row('Awake', awake, awake ? 'kept awake while he runs (closing the lid still sleeps it)' : "may sleep when idle — the phone can't reach a sleeping Mac")
    if (!existsSync(join(DATA, 'token'))) row('API token', false, 'missing (the bridge makes it on first start)')
    console.log('')
  } else {
    console.error('usage: launcher.mjs phone|pair|board')
    process.exit(2)
  }
} catch (err) {
  // Advisory only: the launcher carries on without it.
  if (what === 'phone') console.log('0|0|||0')
  else console.error(`  (couldn't ask the bridge: ${err.message})`)
}
