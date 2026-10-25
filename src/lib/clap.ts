import { getMic } from './audio'

/**
 * Clap to wake him up.
 *
 * The ignition button exists because browsers will not let a page make a sound
 * until someone has interacted with it. That is still true, so the button is
 * not going anywhere — but there is no reason it should be the only way in, and
 * clapping at a dark room to bring it up is a better opening than clicking a
 * button.
 *
 * A clap is not loud, it is SHARP. Distinguishing it from a door, a cough or a
 * dropped mug is entirely a question of shape: a clap goes from silence to peak
 * in a couple of milliseconds and is gone again inside a tenth of a second.
 * Almost nothing else in a room does both. So this looks for three things in
 * order — quiet before, a near-instant rise, and a fast collapse — and refuses
 * anything that fails one of them. Loudness alone is not evidence.
 */

/** How far above the running floor counts as a candidate transient. */
const PEAK_OVER_FLOOR = 7
/** ...and an absolute floor, so a silent room cannot make a whisper a clap (lower for a finger snap). */
const MIN_PEAK = 0.055

/**
 * The level is measured over every 256 samples of the microphone (about 5 ms),
 * in the audio thread, so a clap is never missed between two drawn frames
 * however busy the page is, and a snap isn't averaged away.
 */
const WINDOW = 256

/** The room has to have been this quiet just before the strike. */
const QUIET_BEFORE = 0.16
/** Windows of history kept: about a fifth of a second. */
const HISTORY = 40
/** How far back "just before" means: about 85 ms. */
const LOOKBACK = 16
/** A clap is up from nothing in a couple of milliseconds: two windows (about 11 ms) back, it was under this share of its level. */
const RISE_FROM = 0.35

/** Confirmed once the level (smoothed over two windows) has stayed this far below the peak for two readings... */
const DECAY_TO = 0.35
/** ...within this long. A clap is gone in a few tens of milliseconds; speech and music simply do not collapse this fast. */
const DECAY_MS = 100
/** A candidate that has not decayed by now was something sustained. */
const GIVE_UP_MS = 260

/** Nothing counts for this long after a clap, so one strike is one event. */
const COOLDOWN_MS = 1200

/** Runs in the audio thread: the level of every WINDOW samples, sent to the page. */
const LEVELS = `registerProcessor('clap-level', class extends AudioWorkletProcessor {
  constructor() { super(); this.sum = 0; this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) this.sum += ch[i] * ch[i]
    this.n += ch.length
    if (this.n >= ${WINDOW}) { this.port.postMessage(Math.sqrt(this.sum / this.n)); this.sum = 0; this.n = 0 }
    return true
  }
})`

export type ClapListener = { stop: () => void }

export const diag = {
  listening: false,
  claps: 0,
  lastPeak: 0,
  rejected: '',
  /** The levels leading up to the last clap, for a look at what set it off. */
  lastLevels: [] as number[],
  /** Readings taken, per listener (by its sensitivity): is it hearing anything at all? */
  readings: {} as Record<string, number>,
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__clap = diag
}

/**
 * Listen until told to stop. Resolves once the microphone is actually open, so
 * a caller can tell "not listening" from "listening and hearing nothing".
 *
 * Never throws for a refused microphone — clapping is an alternative to the
 * button, not a requirement, and an interface that reports an error about a
 * feature the user never asked for is worse than one that quietly does without.
 */
export async function listenForClap(onClap: () => void, { minPeak = MIN_PEAK }: { minPeak?: number } = {}): Promise<ClapListener> {
  let stream: MediaStream
  try {
    stream = await getMic()
  } catch {
    diag.rejected = 'microphone unavailable'
    return { stop: () => {} }
  }

  const ctx = new AudioContext()
  void ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  let node: AudioWorkletNode
  const url = URL.createObjectURL(new Blob([LEVELS], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
    node = new AudioWorkletNode(ctx, 'clap-level')
  } catch {
    // No audio worklets (an old browser, or a page that isn't a secure origin).
    diag.rejected = 'no audio worklet'
    void ctx.close()
    return { stop: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
  source.connect(node)

  const history: number[] = []
  let floor = 0.01
  let stopped = false
  let lastClap = -Infinity

  /** A transient under examination, waiting to prove it decays. */
  let candidate: { at: number; peak: number; low: number } | null = null

  // Time by the audio, not by when a reading reaches the page: readings can
  // arrive bunched up while the page is busy.
  let windows = 0
  const step = (level: number) => {
    if (stopped) return
    diag.readings[minPeak] = (diag.readings[minPeak] ?? 0) + 1
    const now = (++windows * WINDOW * 1000) / ctx.sampleRate
    const prev = history[history.length - 1] ?? level
    history.push(level)
    if (history.length > HISTORY) history.shift()
    // Over the last two windows: one quiet 5 ms of noise isn't a collapse.
    const smooth = Math.sqrt((level * level + prev * prev) / 2)

    // The floor tracks the room, and never while a candidate is in flight —
    // otherwise the clap itself raises the bar it is being measured against.
    if (!candidate && level < floor * 3) {
      floor += (level - floor) * 0.03
      floor = Math.max(floor, 0.002)
    }

    if (candidate) {
      candidate.low = smooth < candidate.peak * DECAY_TO ? candidate.low + 1 : 0
      if (candidate.low >= 2 && now - candidate.at < DECAY_MS) {
        // Quiet before, instant rise, immediate collapse. That is a clap.
        candidate = null
        lastClap = now
        diag.claps++
        diag.rejected = ''
        diag.lastLevels = history.map((v) => Math.round(v * 1000) / 1000)
        onClap()
      } else if (now - candidate.at > GIVE_UP_MS) {
        // Still going. A voice, a chair, music — something with a body to it.
        diag.rejected = 'too sustained to be a clap'
        candidate = null
      } else {
        candidate.peak = Math.max(candidate.peak, smooth)
      }
      return
    }

    if (now - lastClap < COOLDOWN_MS) return
    if (level < minPeak || level < floor * PEAK_OVER_FLOOR) return

    // Was the room actually quiet a moment ago? A rise out of noise is a swell,
    // not a strike, and this is the test that rejects most of speech.
    const before = history[history.length - 1 - LOOKBACK]
    if (before === undefined || before > level * QUIET_BEFORE) {
      diag.rejected = 'no silence before it'
      return
    }
    // ...and did it get there at once? A syllable takes tens of milliseconds.
    if (history[history.length - 3] > level * RISE_FROM) {
      diag.rejected = 'too slow a rise'
      return
    }

    diag.lastPeak = level
    candidate = { at: now, peak: smooth, low: 0 }
  }
  node.port.onmessage = (e: MessageEvent<number>) => step(e.data)
  diag.listening = true

  return {
    stop: () => {
      stopped = true
      diag.listening = false
      node.port.onmessage = null
      try {
        source.disconnect()
        // The shared microphone stream is NOT stopped here. It belongs to
        // audio.ts and the voice loop takes it over the moment JARVIS boots;
        // stopping it would take the assistant's hearing with it.
        void ctx.close()
      } catch {
        /* already gone */
      }
    },
  }
}
