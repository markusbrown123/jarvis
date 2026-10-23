#!/usr/bin/env node
/**
 * The `jarvis` command's helper: asks the running bridge how he is, so the
 * terminal can say so and link the phone without opening Settings.
 *
 *   node scripts/launcher.mjs phone   telegram|paired|bot|chat|pushover (1/0 flags)
 *   node scripts/launcher.mjs pair    a fresh pairing code (valid 15 minutes)
 *   node scripts/launcher.mjs board   what's running: brain, write mode, voice, phone, Claude Code
 *
 * It reads the bridge on localhost with the local API token (~/.jarvis/token).
 * No secret is printed: the phone's tokens stay in the Keychain.
 */

import { existsSync, readFileSync } from 'node:fs'
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

const what = process.argv[2]
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
    row('Claude Code', claudeForwarded(), claudeForwarded() ? 'usage + activity forwarded' : 'not forwarded — jarvis setup-claude')
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
