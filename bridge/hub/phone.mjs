/**
 * Markus's phone.
 *
 * Telegram is the two-way line: he can text JARVIS (or send a voice note)
 * from anywhere, and JARVIS reports back on his own — a background job
 * finished or failed, something new needs Markus, a studio task failed. The
 * bot long-polls from this Mac, so no port is opened, and it answers exactly
 * one chat: the one paired with a code shown on the dashboard. Everyone else
 * is ignored.
 *
 * Pushover is the urgent line. An urgent alert goes out at emergency
 * priority, which repeats until acknowledged and — with Critical Alerts
 * allowed in the Pushover app — sounds through Do Not Disturb. It is used only
 * when something is explicitly urgent, never for routine reports.
 *
 * Reports go to the phone only while Markus is away from the dashboard, and
 * arrive silently during quiet hours. Urgent alerts ignore both, by design.
 *
 * Secrets come from the macOS Keychain (or the environment) and never leave
 * this process except to the service they belong to.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import * as hub from './store.mjs'
import { saveReceipt } from './expenses.mjs'

const FILE = join(hub.DATA_DIR, 'phone.json')
const TG = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'
const PO = process.env.PUSHOVER_API_BASE ?? 'https://api.pushover.net'

/** A secret from the environment, or from the macOS Keychain by service name. */
export function secret(envName, service) {
  if (process.env[envName]) return process.env[envName]
  if (process.platform !== 'darwin') return null
  try {
    const v = execFileSync('security', ['find-generic-password', '-a', process.env.USER ?? '', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
    return v || null
  } catch {
    return null
  }
}

const DEFAULTS = {
  chatId: null,
  chatName: null,
  pairedAt: null,
  offset: 0,
  pairing: null,
  quiet: { enabled: true, start: '22:30', end: '07:30' },
  awayMinutes: 10,
  reportWhen: 'away',
  reports: { jobs: true, needs: true, studio: true },
  reported: [],
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

let cfg = load()
const save = () => writeFileSync(FILE, JSON.stringify({ ...cfg, reported: cfg.reported.slice(-500) }, null, 2), { mode: 0o600 })

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h % 24) * 60 + (m % 60)
}

export function inQuietHours(now = new Date()) {
  if (!cfg.quiet?.enabled) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const a = minutes(cfg.quiet.start)
  const b = minutes(cfg.quiet.end)
  return a <= b ? t >= a && t < b : t >= a || t < b
}

function away() {
  const seen = hub.snapshot().presence?.lastSeenAt ?? 0
  return Date.now() - seen > cfg.awayMinutes * 60000
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * start({ makeChat, transcribe, speak }) — makeChat() returns { ask(text) }
 * for the phone conversation; transcribe/speak are the ElevenLabs helpers.
 */
export function startPhone({ makeChat, transcribe, speak }) {
  const tgToken = () => secret('TELEGRAM_BOT_TOKEN', 'jarvis-telegram')
  const poUser = () => secret('PUSHOVER_USER_KEY', 'jarvis-pushover-user')
  const poApp = () => secret('PUSHOVER_APP_TOKEN', 'jarvis-pushover-token')
  let chat = null
  let lastError = null
  let lastInbound = 0
  let lastOutbound = 0
  let botName = null

  const publish = () =>
    hub.setPhone({
      telegram: { configured: Boolean(tgToken()), bot: botName, paired: Boolean(cfg.chatId), chatName: cfg.chatName, pairedAt: cfg.pairedAt, pairing: cfg.pairing && cfg.pairing.expires > Date.now() ? cfg.pairing : null, lastInbound, lastOutbound, error: lastError },
      pushover: { configured: Boolean(poUser() && poApp()) },
      quiet: cfg.quiet,
      awayMinutes: cfg.awayMinutes,
      reportWhen: cfg.reportWhen,
      reports: cfg.reports,
      inQuietHours: inQuietHours(),
    })

  async function tg(method, body, { form = false, timeout = 30000 } = {}) {
    const token = tgToken()
    if (!token) throw new Error('Telegram is not set up')
    const res = await fetch(`${TG}/bot${token}/${method}`, {
      method: 'POST',
      ...(form ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    })
    const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    if (!j.ok) throw new Error(j.description ?? 'Telegram error')
    return j.result
  }

  /** Text to the paired chat. Long text is split; quiet hours send silently. */
  async function sendText(text, { silent = false } = {}) {
    if (!cfg.chatId) throw new Error('No phone is paired')
    for (let i = 0; i < text.length; i += 3900) {
      await tg('sendMessage', { chat_id: cfg.chatId, text: text.slice(i, i + 3900), disable_notification: silent })
    }
    lastOutbound = Date.now()
    publish()
  }

  /** A voice note in his voice; falls back to text if speech is unavailable. */
  async function sendVoice(text) {
    try {
      const spoken = text.replace(/[•*#_`>]/g, '').replace(/\n{2,}/g, '\n').slice(0, 2400)
      const audio = await speak(spoken, 'opus_48000_64')
      const form = new FormData()
      form.append('chat_id', String(cfg.chatId))
      form.append('voice', new Blob([audio], { type: 'audio/ogg' }), 'jarvis.ogg')
      await tg('sendVoice', form, { form: true, timeout: 60000 })
      lastOutbound = Date.now()
    } catch (err) {
      hub.activity({ source: 'phone', project: 'jarvis', title: `Voice reply failed, sent text instead (${err.message})`, level: 'warn' })
    }
  }

  async function pushover({ title, message, urgent }) {
    const user = poUser()
    const token = poApp()
    if (!user || !token) throw new Error('Pushover is not set up')
    const form = new URLSearchParams({ token, user, title, message: message.slice(0, 1000), priority: urgent ? '2' : '1' })
    if (urgent) {
      form.set('retry', '60')
      form.set('expire', '1800')
    }
    const res = await fetch(`${PO}/1/messages.json`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) })
    const j = await res.json().catch(() => ({}))
    if (j.status !== 1) throw new Error((j.errors ?? [`HTTP ${res.status}`]).join(', '))
    return j.receipt ?? null
  }

  /**
   * Tell Markus something. `urgent` goes to every channel at full volume;
   * otherwise only when he is away (or reportWhen is 'always'), silently in
   * quiet hours. Returns where it went.
   */
  async function notify({ title = 'JARVIS', message, urgent = false, force = false }) {
    const sent = []
    if (!urgent && !force && cfg.reportWhen === 'away' && !away()) return { sent, skipped: 'Markus is at the dashboard' }
    const silent = !urgent && inQuietHours()
    if (cfg.chatId && tgToken()) {
      try {
        await sendText(`${urgent ? '🚨 ' : ''}${title === 'JARVIS' ? '' : `${title}\n`}${message}`, { silent })
        sent.push('telegram')
      } catch (err) {
        lastError = err.message
      }
    }
    if (urgent && poUser() && poApp()) {
      try {
        const receipt = await pushover({ title, message, urgent: true })
        sent.push('pushover')
        hub.activity({ source: 'phone', project: 'jarvis', title: `Urgent alert sent: ${title}`, detail: message, level: 'warn', ref: receipt ? { kind: 'item', id: `pushover:${receipt}` } : null })
      } catch (err) {
        lastError = err.message
      }
    }
    publish()
    return { sent, silent }
  }

  // ------------------------------------------------------------ inbound

  async function reply(text, voice) {
    if (voice) await sendVoice(text)
    await sendText(text)
  }

  function quickAnswer(cmd) {
    const s = hub.snapshot()
    if (cmd === '/needs') {
      const items = Object.values(s.items).filter((i) => ['open', 'in_progress'].includes(i.state))
      return items.length ? items.map((i) => `• [${i.priority}] ${i.title}`).join('\n') : 'Nothing needs you.'
    }
    if (cmd === '/jobs') {
      const jobs = Object.values(s.jobs).filter((j) => ['running', 'needs_markus', 'cancel_requested'].includes(j.state))
      return jobs.length ? jobs.map((j) => `• ${j.taskId ?? ''} ${j.title} — ${j.state.replace('_', ' ')}${j.stale ? ' (no heartbeat)' : ''}`).join('\n') : 'Nothing running.'
    }
    const running = Object.values(s.jobs).filter((j) => j.state === 'running').length
    const needs = Object.values(s.items).filter((i) => i.state === 'open').length
    const w = s.usage.windows.five_hour
    return [
      `${running} running · ${needs} need you`,
      w && (!w.resetsAt || w.resetsAt > Date.now()) ? `Claude 5h window: ${Math.round(100 - w.usedPct)}% left` : 'Claude allowance: unavailable',
      s.projects.roblox?.activeGame ? `Roblox active game: ${s.projects.roblox.activeGame}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }

  async function handle(msg) {
    if (!msg?.chat) return
    const text = (msg.text ?? '').trim()
    const fromPaired = cfg.chatId && msg.chat.id === cfg.chatId

    // Pairing: "/start 123456" with the code on the dashboard.
    const m = text.match(/^\/start(?:@\w+)?\s+(\d{6})$/)
    if (m) {
      if (cfg.pairing && cfg.pairing.code === m[1] && cfg.pairing.expires > Date.now()) {
        cfg.chatId = msg.chat.id
        cfg.chatName = [msg.from?.first_name, msg.from?.username && `@${msg.from.username}`].filter(Boolean).join(' ') || String(msg.chat.id)
        cfg.pairedAt = Date.now()
        cfg.pairing = null
        save()
        publish()
        hub.activity({ source: 'phone', project: 'jarvis', title: `Phone paired: ${cfg.chatName}`, level: 'success' })
        await tg('sendMessage', { chat_id: msg.chat.id, text: 'Paired, sir. Text me or send a voice note any time. /status, /needs and /jobs answer instantly.' })
      } else {
        // Five wrong guesses burn the code, so it can't be brute-forced.
        if (cfg.pairing && (cfg.pairing.misses = (cfg.pairing.misses ?? 0) + 1) >= 5) cfg.pairing = null
        save()
        publish()
        await tg('sendMessage', { chat_id: msg.chat.id, text: 'That code is wrong or expired. Get a new one in JARVIS → Settings → Phone.' })
      }
      return
    }
    if (!fromPaired) {
      // Private bot. Note it once on the dashboard; say nothing useful back.
      hub.activity({ id: `phone:stranger:${msg.chat.id}`, source: 'phone', project: 'jarvis', title: `Ignored a Telegram message from an unpaired chat (${msg.chat.id})`, level: 'warn' })
      return
    }
    lastInbound = Date.now()
    hub.observePresence({ where: 'phone' })

    if (['/status', '/needs', '/jobs'].includes(text.split('@')[0])) {
      await sendText(quickAnswer(text.split('@')[0]))
      return
    }

    // A photo (or an image sent as a file): most likely a receipt. Keep it,
    // and let JARVIS read it — logging it only if the total is legible.
    const photo = msg.photo?.at(-1) ?? (msg.document?.mime_type?.startsWith('image/') ? msg.document : null)
    let image = null
    if (photo) {
      try {
        await tg('sendChatAction', { chat_id: cfg.chatId, action: 'typing' })
        const file = await tg('getFile', { file_id: photo.file_id })
        const res = await fetch(`${TG}/file/bot${tgToken()}/${file.file_path}`, { signal: AbortSignal.timeout(60000) })
        if (!res.ok) throw new Error(`download ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 4.5 * 1024 * 1024) throw new Error('that image is too large; send it as a photo, not a file')
        const type = photo.mime_type ?? 'image/jpeg'
        const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
        image = { type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type) ? type : 'image/jpeg', data: buf.toString('base64'), path: saveReceipt(buf, ext) }
      } catch (err) {
        return sendText(`I couldn't get that photo (${err.message}).`)
      }
    }

    let said = image ? (msg.caption ?? '').trim() : text
    const voice = msg.voice ?? msg.audio
    if (voice) {
      try {
        await tg('sendChatAction', { chat_id: cfg.chatId, action: 'typing' })
        const file = await tg('getFile', { file_id: voice.file_id })
        const res = await fetch(`${TG}/file/bot${tgToken()}/${file.file_path}`, { signal: AbortSignal.timeout(60000) })
        if (!res.ok) throw new Error(`download ${res.status}`)
        said = await transcribe(Buffer.from(await res.arrayBuffer()), voice.mime_type ?? 'audio/ogg', 'voice.ogg')
        if (!said) return sendText("I couldn't make out any words in that, sir.")
      } catch (err) {
        return sendText(`I couldn't hear that voice note (${err.message}). Text works.`)
      }
    }
    if (!said && !image) return
    hub.term('phone', `markus${voice ? ' (voice note)' : image ? ' (photo)' : ''} › ${said || 'photo'}`, 'user')
    const content = image
      ? [
          { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } },
          {
            type: 'text',
            text:
              `[Photo from Markus's phone, saved at ${image.path}.]${said ? ` He wrote: "${said}"` : ''}\n` +
              'If it is a receipt or invoice, log it with expense_log (receipt set to that path): vendor, the total actually paid, the date and currency as printed. ' +
              'Choose the business and category from what he wrote or the vendor; if you cannot tell which business, or the total is not clearly legible, ask him instead of guessing. ' +
              'If it is not a receipt, just reply to the photo.',
          },
        ]
      : said

    await tg('sendChatAction', { chat_id: cfg.chatId, action: 'typing' }).catch(() => {})
    try {
      chat ??= makeChat()
      const answer = await chat.ask(content)
      hub.term('phone', `jarvis › ${answer}`, 'reply')
      await reply(answer || 'Done, sir.', Boolean(voice))
    } catch (err) {
      chat = null
      await sendText(`Something went wrong on my side: ${err.message}`)
    }
  }

  async function poll() {
    let warned = false
    for (;;) {
      if (!tgToken()) {
        await sleep(60000)
        continue
      }
      try {
        if (!botName) botName = (await tg('getMe', {})).username ?? null
        const updates = await tg('getUpdates', { offset: cfg.offset, timeout: 50, allowed_updates: ['message'] }, { timeout: 65000 })
        lastError = null
        for (const u of updates) {
          cfg.offset = u.update_id + 1
          save()
          await handle(u.message).catch((err) => {
            lastError = err.message
          })
        }
        warned = false
        publish()
      } catch (err) {
        lastError = err.message
        if (!warned) {
          hub.activity({ source: 'phone', project: 'jarvis', title: `Telegram unreachable: ${err.message}`, level: 'warn' })
          warned = true
        }
        publish()
        await sleep(5000)
      }
    }
  }

  // ------------------------------------------------------------ reports

  const reportedOnce = (key) => {
    if (cfg.reported.includes(key)) return true
    cfg.reported.push(key)
    save()
    return false
  }

  function watch() {
    // The first snapshot is the baseline: nothing that is already true at
    // start-up is "news".
    let primed = false
    hub.subscribe((s) => {
      if (!primed) {
        for (const j of Object.values(s.jobs)) if (['completed', 'failed', 'canceled'].includes(j.state)) reportedOnce(`job:${j.id}:${j.state}`)
        for (const i of Object.values(s.items)) if (i.state === 'open') reportedOnce(`item:${i.id}`)
        primed = true
        return
      }
      for (const j of Object.values(s.jobs)) {
        const mine = j.source === 'jarvis'
        const studioFail = j.source === 'roblox' && j.state === 'failed'
        if (!['completed', 'failed'].includes(j.state)) continue
        if (!((mine && cfg.reports.jobs) || (studioFail && cfg.reports.studio))) continue
        if (reportedOnce(`job:${j.id}:${j.state}`)) continue
        const result = (j.output ?? '').trim().slice(0, 1500)
        void notify({
          title: `${j.state === 'completed' ? '✅' : '❌'} ${j.title}`,
          message: result || (j.state === 'completed' ? 'Finished.' : `Failed: ${j.stage ?? 'unknown error'}`),
          force: Boolean(j.notify),
          urgent: Boolean(j.notify === 'urgent' && j.state === 'failed'),
        })
      }
      if (cfg.reports.needs) {
        for (const i of Object.values(s.items)) {
          if (i.state !== 'open' || !['P1', 'P2'].includes(i.priority)) continue
          if (reportedOnce(`item:${i.id}`)) continue
          void notify({ title: `Needs you: ${i.title}`, message: [i.why, i.instructions].filter(Boolean).join('\n\n').slice(0, 1500) })
        }
      }
    })
  }

  // ------------------------------------------------------------ dashboard API

  const api = {
    status: publish,
    newPairingCode() {
      cfg.pairing = { code: String(randomInt(100000, 1000000)), expires: Date.now() + 15 * 60000 }
      save()
      publish()
      return cfg.pairing
    },
    unpair() {
      cfg.chatId = null
      cfg.chatName = null
      cfg.pairedAt = null
      save()
      publish()
    },
    settings(p) {
      if (p.quiet) cfg.quiet = { enabled: Boolean(p.quiet.enabled), start: /^\d{1,2}:\d{2}$/.test(p.quiet.start) ? p.quiet.start : cfg.quiet.start, end: /^\d{1,2}:\d{2}$/.test(p.quiet.end) ? p.quiet.end : cfg.quiet.end }
      if (Number.isFinite(p.awayMinutes)) cfg.awayMinutes = Math.min(240, Math.max(1, p.awayMinutes))
      if (['away', 'always'].includes(p.reportWhen)) cfg.reportWhen = p.reportWhen
      if (p.reports) cfg.reports = { ...cfg.reports, ...p.reports }
      save()
      publish()
    },
    async test(channel) {
      if (channel === 'pushover-urgent') return pushover({ title: 'JARVIS test', message: 'Urgent test — acknowledge it in Pushover to stop the repeats.', urgent: true })
      if (channel === 'pushover') return pushover({ title: 'JARVIS test', message: 'Pushover works.', urgent: false })
      return sendText('JARVIS here — your phone link works, sir.')
    },
    notify,
  }

  publish()
  watch()
  void poll()
  return api
}
