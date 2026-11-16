#!/usr/bin/env node
/**
 * `jarvis watch` — the station's terminal feed in your own Terminal window:
 * every question, tool call, job step, Claude Code edit and phone message,
 * live, in colour. Read-only; Ctrl-C to stop.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.JARVIS_BRIDGE_PORT ?? '8788'
const DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis')

const esc = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`
const dim = esc('2')
const bold = esc('1')
const color = {
  user: esc('38;5;216'),
  reply: esc('38;5;80'),
  tool: esc('38;5;146'),
  text: esc('38;5;252'),
  success: esc('38;5;114'),
  warn: esc('38;5;214'),
  error: esc('38;5;203'),
  info: esc('38;5;250'),
  history: esc('38;5;242'),
}
const srcColor = { VOICE: esc('38;5;215'), JOB: esc('38;5;183'), CODE: esc('38;5;75'), PHONE: esc('38;5;219'), STUDIO: esc('38;5;120'), JARVIS: esc('38;5;141') }

function tag(src) {
  if (src.startsWith('job:')) return ['JOB', src.slice(4)]
  if (src.startsWith('claude:')) return ['CODE', src.slice(7)]
  if (src === 'claude') return ['CODE', '']
  if (src === 'roblox') return ['STUDIO', '']
  return [src.toUpperCase(), '']
}

function print(l) {
  const ts = new Date(l.ts).toLocaleTimeString([], { hour12: false })
  const [k, sub] = tag(l.src)
  const label = (srcColor[k] ?? esc('38;5;141'))(k) + (sub ? dim(`·${sub.slice(0, 28)}`) : '')
  const text = (color[l.kind] ?? color.info)((l.kind === 'tool' ? '⚙ ' : '') + l.text)
  process.stdout.write(`${dim(ts)}  ${label}  ${text}\n`)
}

let token
try {
  token = readFileSync(join(DIR, 'token'), 'utf8').trim()
} catch {
  console.error('No ~/.jarvis/token yet — start JARVIS first (type: jarvis).')
  process.exit(1)
}

process.stdout.write(`\n${bold(esc('38;5;141')('  J A R V I S'))}  ${dim('live terminal · Ctrl-C to stop')}\n\n`)

let last = 0
let warned = false
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/stream`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (warned) process.stdout.write(dim('  — reconnected —\n'))
    warned = false
    let buf = ''
    const dec = new TextDecoder()
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (!frame.startsWith('event: term')) continue
        const data = frame.slice(frame.indexOf('data: ') + 6)
        let lines
        try {
          lines = JSON.parse(data)
        } catch {
          continue
        }
        // A bridge restart resets ids; take its backlog as new.
        if (lines.length && lines[lines.length - 1].id < last) last = 0
        for (const l of lines) if (l.id > last) print(l)
        last = Math.max(last, ...lines.map((l) => l.id))
      }
    }
  } catch (err) {
    if (!warned) process.stdout.write(color.warn(`  JARVIS isn't answering (${err.message}) — retrying…\n`))
    warned = true
  }
  await new Promise((r) => setTimeout(r, 3000))
}
