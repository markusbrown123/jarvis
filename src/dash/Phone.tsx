import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { PhoneStatus } from '../hub/types'
import { ago, until } from '../hub/format'
import { Chip } from './shared'
import { copy } from './state'

/**
 * Settings → Phone. Telegram is the two-way line (text or voice notes, and
 * JARVIS reports back); Pushover is the urgent line that can break through
 * Do Not Disturb. Tokens never come through here — they go into the Mac's
 * Keychain from Terminal — so this card only shows what is set up and lets
 * Markus pair, test and choose when to be told things.
 */

async function act(fn: () => Promise<unknown>, done: string) {
  try {
    await fn()
    useHub.getState().say(done)
  } catch (err) {
    useHub.getState().say((err as Error).message)
  }
}

export function PhonePanel({ phone }: { phone?: PhoneStatus }) {
  const [busy, setBusy] = useState(false)
  if (!phone) {
    return (
      <section className="card">
        <header className="card-head">
          <h3>Phone</h3>
        </header>
        <p className="muted">The phone link isn’t running in this bridge. Restart JARVIS (type jarvis stop, then jarvis).</p>
      </section>
    )
  }
  const tg = phone.telegram
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    await act(fn, done)
    setBusy(false)
  }
  return (
    <section className="card phone-card">
      <header className="card-head">
        <h3>Phone</h3>
        <span className="muted small">{phone.inQuietHours ? 'Quiet hours now — reports arrive silently' : 'Reports when you’re away from this screen'}</span>
      </header>

      <div className="field">
        <span>
          Telegram — text or voice-note JARVIS, and it reports back{' '}
          {tg.paired ? <Chip tone="ok">paired</Chip> : tg.configured ? <Chip tone="need">not paired</Chip> : <Chip tone="muted">not set up</Chip>}
        </span>
        {!tg.configured && (
          <div className="steps">
            <p>1. In Telegram, open <b>@BotFather</b>, send <span className="mono">/newbot</span>, pick any name. It replies with a token.</p>
            <p>2. In Terminal run this and paste the token when asked (it goes into your Mac’s Keychain, nowhere else):</p>
            <div className="field-row">
              <code className="mono">~/jarvis/bin/jarvis setup-phone telegram</code>
              <button className="btn" onClick={() => copy('~/jarvis/bin/jarvis setup-phone telegram')}>Copy</button>
            </div>
            <p>3. Come back here and press Pair.</p>
          </div>
        )}
        {tg.configured && !tg.paired && (
          <div className="steps">
            {tg.pairing ? (
              <>
                <p>
                  In Telegram, open <b>{tg.bot ? `@${tg.bot}` : 'your bot'}</b> and send:
                </p>
                <div className="field-row">
                  <code className="mono pair-code">/start {tg.pairing.code}</code>
                  <button className="btn" onClick={() => copy(`/start ${tg.pairing!.code}`)}>Copy</button>
                </div>
                <p className="fine">Code expires in {until(tg.pairing.expires)}. Only the chat that sends it can talk to JARVIS.</p>
              </>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={() => run(hubActions.phonePair, 'Pairing code ready')}>
                Pair my phone
              </button>
            )}
          </div>
        )}
        {tg.paired && (
          <div className="field-row">
            <span>
              {tg.chatName}
              <span className="muted small"> · last message {tg.lastInbound ? ago(tg.lastInbound) : 'never'}</span>
            </span>
            <span className="row-gap">
              <button className="btn" disabled={busy} onClick={() => run(() => hubActions.phoneTest('telegram'), 'Test message sent')}>
                Send test
              </button>
              <button className="btn btn-warn" disabled={busy} onClick={() => run(hubActions.phoneUnpair, 'Phone unpaired')}>
                Unpair
              </button>
            </span>
          </div>
        )}
        {tg.error && <p className="fine warn">Last problem: {tg.error}</p>}
      </div>

      <div className="field">
        <span>
          Urgent alerts (Pushover) — repeat until acknowledged, can sound through Do Not Disturb{' '}
          {phone.pushover.configured ? <Chip tone="ok">set up</Chip> : <Chip tone="muted">not set up</Chip>}
        </span>
        {phone.pushover.configured ? (
          <div className="field-row">
            <span className="fine">In the Pushover app: Settings → allow Critical Alerts, so urgent ones ring through silent mode.</span>
            <span className="row-gap">
              <button className="btn" disabled={busy} onClick={() => run(() => hubActions.phoneTest('pushover'), 'Pushover test sent')}>
                Test
              </button>
              <button className="btn btn-warn" disabled={busy} onClick={() => run(() => hubActions.phoneTest('pushover-urgent'), 'Urgent test sent — acknowledge it on the phone')}>
                Test urgent
              </button>
            </span>
          </div>
        ) : (
          <div className="steps">
            <p>1. Install Pushover on the iPhone and sign up (one-time purchase after the trial). Your <b>User Key</b> is on its home page at pushover.net.</p>
            <p>2. On pushover.net, “Create an Application/API Token”, name it JARVIS.</p>
            <div className="field-row">
              <code className="mono">~/jarvis/bin/jarvis setup-phone pushover</code>
              <button className="btn" onClick={() => copy('~/jarvis/bin/jarvis setup-phone pushover')}>Copy</button>
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <span>When to tell you</span>
        <label className="check">
          <input
            type="radio"
            checked={phone.reportWhen === 'away'}
            onChange={() => act(() => hubActions.phoneSettings({ reportWhen: 'away' }), 'Saved')}
          />
          Only when I’ve been away from this screen for
          <input
            className="input input-num"
            type="number"
            min={1}
            max={240}
            defaultValue={phone.awayMinutes}
            onBlur={(e) => act(() => hubActions.phoneSettings({ awayMinutes: Number(e.target.value) }), 'Saved')}
            aria-label="Minutes away"
          />
          min
        </label>
        <label className="check">
          <input type="radio" checked={phone.reportWhen === 'always'} onChange={() => act(() => hubActions.phoneSettings({ reportWhen: 'always' }), 'Saved')} />
          Always
        </label>
        {(
          [
            ['jobs', 'JARVIS background jobs finish or fail'],
            ['needs', 'Something new needs me (P1/P2)'],
            ['studio', 'A Roblox studio task fails'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={phone.reports[k]} onChange={(e) => act(() => hubActions.phoneSettings({ reports: { [k]: e.target.checked } }), 'Saved')} />
            {label}
          </label>
        ))}
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={phone.quiet.enabled}
            onChange={(e) => act(() => hubActions.phoneSettings({ quiet: { ...phone.quiet, enabled: e.target.checked } }), 'Saved')}
          />
          Quiet hours — reports arrive without a sound from
          <input
            className="input input-time"
            type="time"
            defaultValue={phone.quiet.start}
            onBlur={(e) => act(() => hubActions.phoneSettings({ quiet: { ...phone.quiet, start: e.target.value } }), 'Saved')}
            aria-label="Quiet hours start"
          />
          to
          <input
            className="input input-time"
            type="time"
            defaultValue={phone.quiet.end}
            onBlur={(e) => act(() => hubActions.phoneSettings({ quiet: { ...phone.quiet, end: e.target.value } }), 'Saved')}
            aria-label="Quiet hours end"
          />
        </label>
        <p className="fine">Urgent alerts ignore quiet hours and “away” — that is what they are for. JARVIS only sends one when you ask for it or a job you flagged urgent fails.</p>
      </div>
    </section>
  )
}
