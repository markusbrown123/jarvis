import { BRIDGE_HTTP_URL } from '../config'
import { getMic } from './audio'
import { speakingNow, speakingSince } from './tts'
import { SILENCE_MS, startVad, type Vad } from './vad'
import { caps } from './capabilities'

/**
 * The voice loop.
 *
 * One recogniser, running for the life of the page. It is never torn down for
 * a turn, and that single fact is most of what separates this from a kiosk:
 * the microphone is still open while JARVIS is talking, so you can cut him off
 * the way you would cut off a person.
 *
 * The obvious design — one recogniser hunting for the wake word, a second one
 * capturing the command, stopping the first to start the second because the
 * browser only hands out one at a time — is what this replaces. It works, but
 * nothing is listening during an answer, so barge-in is impossible, and every
 * restart leaves a quarter-second of deafness that eats whole wake words.
 *
 * Keeping the mic open costs one thing: JARVIS hears himself through the
 * speakers. That is handled here in text rather than in acoustics — see
 * `isEcho` — because the browser gives SpeechRecognition its own capture and
 * won't let us put a canceller in front of it.
 */

export type VoiceMode =
  /** Powered down. Only his name matters. */
  | 'wake'
  /** He is expecting you to speak. Everything is a command, and a pause long
   *  enough ends it. */
  | 'command'
  /** Push-to-talk. Everything is a command, and nothing ends it but the key
   *  (finish). Pauses, however long, are part of the thought. */
  | 'dictate'
  /** He is thinking or talking. Anything you say is an interruption. */
  | 'guard'
  /** Something is playing that must not be transcribed at all. */
  | 'deaf'

export type VoiceHandlers = {
  /** Read fresh on every result, so the app never has to re-subscribe. */
  mode: () => VoiceMode
  /** Fired on his name, from a partial — waiting for endpointing feels slow.
   *  `trailing` is whatever followed it, so "Jarvis, what's the weather" is
   *  one breath rather than two turns. */
  onWake: (trailing: string) => void
  /** The user has genuinely started talking. This is the barge-in trigger. */
  onSpeechStart: () => void
  /** Live transcript, for the caption under the reactor. */
  onPartial: (text: string) => void
  /** A complete, endpointed utterance. */
  onUtterance: (text: string) => void
  /** The recogniser is unusable. Distinct from the user saying nothing. */
  onError: (message: string) => void
}

export type Voice = {
  stop: () => void
  /** Treat what has been said so far as the whole thought, now. Resolves once
   *  the last words are transcribed and the utterance (if any) has been sent. */
  finish: () => Promise<void>
  /** True while a recogniser is actually running. */
  live: () => boolean
}

// ---------------------------------------------------------------------------
// Endpointing
// ---------------------------------------------------------------------------

/** One utterance often produces several partials containing his name. */
const WAKE_DEBOUNCE = 1500

/**
 * His name, and the only wake phrase.
 *
 * The optional prefix is genuinely optional: addressing him by name alone is
 * correct, and during an answer "Jarvis" on its own is the natural way to cut
 * in. The negative lookahead keeps possessives ("Jarvis's job") from waking him.
 *
 * The alternates are not padding. "Jarvis" is not in a general dictation
 * model's high-frequency vocabulary, and Chrome routinely returns Travis,
 * Jervis, Jarvys or Java's for a perfectly clear utterance — every one of which
 * used to be silently discarded, so the wake word "just didn't work" with no
 * indication why. Better a rare false wake than a name that does not answer.
 */
const WAKE =
  /\b(?:hey|hi|ok|okay|yo)?\s*(?:jarvis|jarvys|jervis|jarvis's|travis|jarviss|java's|jarv)\b(?!'s)/i

/** Everything after the wake phrase, which is usually the actual command. */
function afterWake(text: string): string {
  const m = WAKE.exec(text)
  if (!m) return ''
  return text
    .slice(m.index + m[0].length)
    .replace(/^[\s,.:;!?-]+/, '')
    .trim()
}

// ---------------------------------------------------------------------------
// Assembling one utterance out of several segments
// ---------------------------------------------------------------------------

/**
 * Why this exists.
 *
 * The voice-activity detector is an energy gate, and energy is a fact about the
 * room rather than about the sentence. It ends a segment after a fixed quiet
 * gap, so "what's the weather in — " *pause* " — London" is two segments, two
 * transcripts and, before this, two turns: the first one asking the model a
 * truncated question, the second arriving as a bare noun with no question left
 * to attach it to. People pause. They pause to think of the word, to look at
 * something, mid-list, before the important part. An assistant that treats the
 * first gap as the end of the thought is one you have to talk to carefully, and
 * having to talk carefully is the whole failure.
 *
 * So the segment is no longer the turn. Transcripts accumulate here, and the
 * turn fires only when the text looks finished AND the room has gone quiet.
 *
 * Crucially this costs nothing in the common case. A complete sentence with no
 * one speaking fires immediately — `holdFor` returns 0 — so the latency of an
 * ordinary question is exactly what it was. The waiting only happens when there
 * is a reason to wait.
 */

/**
 * Ending on one of these means the sentence is not over, whatever the silence
 * says. Function words only: they are closed-class, so the list is complete in
 * a way a content-word list could never be, and none of them is a plausible
 * last word of a real request.
 */
const CONTINUES =
  /\b(and|or|but|so|because|since|if|when|while|that|which|who|whose|to|of|in|on|at|by|for|with|from|about|into|onto|over|under|between|through|the|a|an|my|your|his|her|its|our|their|is|are|was|were|be|been|do|does|did|have|has|had|can|could|would|should|will|shall|might|must|like|than|then|as|very|really|just|some|any|all|both|either|neither)$/i

/** Trailing punctuation a transcriber emits mid-thought. */
const TRAILS = /[,;:–—-]$/

/**
 * A barge-in this soon after he starts a sentence is him, not you.
 *
 * Echo cancellation and the raised guard threshold stop most of his playback
 * reaching the detector, but the attack of the very first syllable is the
 * loudest, least-cancelled thing in the whole answer — it arrives before the
 * canceller has adapted to it. Without this, a long answer could interrupt
 * itself on its own first word, which reads as JARVIS refusing to speak.
 *
 * Kept short deliberately. This is the one window where a genuine interruption
 * is also least likely: the user has not yet heard enough to want to stop him.
 */
const SELF_GUARD_MS = 350

/**
 * Energy alone is not a person. A cough, a jingle, a door or a passing voice
 * crosses the threshold for a moment, and cutting him off for it made him stop
 * mid-sentence at every noise. A real interruption keeps going, so the cut
 * waits until the signal has held this long.
 */
const BARGE_SUSTAIN_MS = 900

/**
 * Transcribers label non-speech in brackets — [background noise], (coughing),
 * [outro jingle] — or with music notes. Those are the room, never the user.
 */
const stripNoiseTags = (text: string) =>
  text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A quiet gap this long with a finished-looking sentence ends the turn.
 *
 * Small on purpose: by the time a transcript reaches the assembler the detector
 * has already sat through SILENCE_MS of quiet and the transcriber has taken its
 * own few hundred milliseconds, so roughly a second of real silence has passed
 * already. All this window has to catch is someone drawing breath to add one
 * more clause. Making it generous here is what would make every ordinary
 * question feel slow.
 */
const SETTLE_MS = 450
/** ...and this long when the sentence is plainly unfinished. */
const CONTINUE_MS = 1600
/**
 * Nothing is held longer than this in total. A ceiling rather than a timer:
 * without it, someone who ends every clause on "and" could hold a turn open
 * for ever, and the assistant would look like it had stopped listening.
 */
const MAX_HOLD_MS = 6000

/**
 * How long to keep waiting, given what has been said so far.
 * 0 means "this is a complete thought, send it now".
 */
function holdFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return CONTINUE_MS
  // An explicit terminator is the speaker telling us they are done.
  if (/[.!?]$/.test(text)) return 0
  if (TRAILS.test(text.trim())) return CONTINUE_MS
  if (CONTINUES.test(words[words.length - 1])) return CONTINUE_MS
  // One or two words is usually the start of something, not the whole of it —
  // except for the short commands that genuinely are complete.
  if (words.length <= 2 && !OVERRIDE.test(text)) return CONTINUE_MS
  return SETTLE_MS
}

type Assembler = {
  /** Add a transcript. `active` is true if the user is audibly still going. */
  feed: (text: string, active: boolean) => void
  /** Add a transcript and decide nothing: only flush sends it (push-to-talk). */
  hold: (text: string) => void
  /** Send whatever is held right now, if anything. */
  flush: () => void
  /** Throw away whatever is held — used when he stands down. */
  cancel: () => void
  /** The user has started talking again: keep waiting for the rest. */
  extend: () => void
  held: () => string
}

function makeAssembler(h: {
  emit: (text: string) => void
  partial: (text: string) => void
}): Assembler {
  let held = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt = 0

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const fire = () => {
    clear()
    const text = held.trim()
    held = ''
    firstAt = 0
    if (text) h.emit(text)
  }

  return {
    feed(text, active) {
      if (!text.trim()) return
      held = `${held} ${text}`.replace(/\s+/g, ' ').trim()
      if (!firstAt) firstAt = Date.now()
      // The caption shows the whole thought as it assembles, not just the
      // fragment that happened to arrive last.
      h.partial(held)
      diag.holding = held
      clear()

      // Already talking again. Decide nothing now — the next transcript is
      // part of this same sentence and will bring more of it.
      if (active) {
        timer = setTimeout(fire, MAX_HOLD_MS)
        return
      }

      const wait = Math.min(
        holdFor(held),
        Math.max(0, MAX_HOLD_MS - (Date.now() - firstAt)),
      )
      diag.waitedMs = wait
      if (wait === 0) {
        fire()
        return
      }
      timer = setTimeout(fire, wait)
    },
    hold(text) {
      if (!text.trim()) return
      held = `${held} ${text}`.replace(/\s+/g, ' ').trim()
      if (!firstAt) firstAt = Date.now()
      h.partial(held)
      diag.holding = held
      clear()
    },
    flush: fire,
    extend() {
      if (!held) return
      clear()
      // The same ceiling as an active feed: the next transcript re-decides.
      timer = setTimeout(fire, Math.max(0, MAX_HOLD_MS - (Date.now() - firstAt)))
    },
    cancel() {
      clear()
      held = ''
      firstAt = 0
      diag.holding = ''
    },
    held: () => held,
  }
}

// ---------------------------------------------------------------------------
// Hearing himself
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Short words that must always cut through, even when they collide with what
 * he happens to be saying. Suppressing "stop" because he just said "stop"
 * would be the single most infuriating failure this file could have.
 */
const OVERRIDE =
  /\b(stop|wait|jarvis|cancel|enough|quiet|hold on|shut up|never ?mind|forget it|no)\b/i

/**
 * Words too common to be evidence of anything.
 *
 * This set is the difference between a usable filter and an infuriating one.
 * "What about the second one?" is a perfectly ordinary follow-up, and every
 * word in it is likely to appear somewhere in the answer it follows — so a
 * naive bag-of-words match suppresses the user's real question as an echo.
 * Only distinctive words count as proof he is hearing himself.
 */
const STOP = new Set(
  ('a an the and or but so of to in on at by for with from is are was were be ' +
    'it its this that these those i you he she we they me him her them my your ' +
    'our their what which who how why when where do does did can could would ' +
    'should will shall not no yes if then than as about into over under out up ' +
    'down one two three first second third now here there just very really got ' +
    'get have has had say said tell me okay ok well right').split(' '),
)

/**
 * Is this the microphone hearing the speakers?
 *
 * Compared as bags of words rather than by string distance: the recogniser
 * mangles its own playback badly enough that a substring match rarely holds,
 * but the *words* survive.
 */
function isEcho(heard: string, spoken: string): boolean {
  if (!spoken) return false
  if (OVERRIDE.test(heard)) return false

  const all = norm(heard).split(' ').filter(Boolean)
  if (!all.length) return true

  const mine = new Set(norm(spoken).split(' '))
  const content = all.filter((w) => !STOP.has(w))

  // Nothing distinctive was said at all, so there is no strong evidence either
  // way. Demand a total match before discarding it — the cost of dropping a
  // real question is much higher than the cost of one stray echo getting in.
  if (content.length < 2) {
    // One word on its own that he has just said is him. "Yes, sir?" arrives
    // back through the mic as a bare "yes", and letting that through made his
    // own greeting a turn — he answered himself, then answered that, and the
    // user's real request was interrupted by the loop. Control words were let
    // through above, so "stop" and "no" still always work.
    if (all.length < 2) return mine.has(all[0])
    return all.every((w) => mine.has(w))
  }

  let hits = 0
  for (const w of content) if (mine.has(w)) hits++
  return hits / content.length >= 0.6
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Live state of the voice loop, published on `window.__voice`.
 *
 * When someone says the wake word and nothing happens there are only a handful
 * of possible causes — the recogniser never started, it started and died, it is
 * running but hearing silence, or it is hearing you and transcribing the name
 * as something else. From outside the page those are indistinguishable, which
 * makes the failure impossible to report and impossible to fix. This tells them
 * apart in one glance.
 */
export const diag = {
  /** Which input engine is running: 'elevenlabs' (VAD+Scribe) or 'browser'. */
  engine: 'browser',
  /** Whether the microphone pipeline is live. */
  running: false,
  /** Speech segments captured since load. */
  sessions: 0,
  /** The most recent transcript, whatever the mode. */
  heard: '',
  heardAt: 0,
  /** Last failure — a transcription error, or a capture error. */
  lastError: '',
  /** Times the wake word matched. */
  wakes: 0,
  /** When the user's speech last ended (ms epoch), for the turn timeline. */
  lastSpeechAt: 0,
  /** Current mode, as the app last reported it. */
  mode: '',
  /** Why the last transcript was ignored — '' when it was accepted. */
  dropped: '',
  /** Transcripts accepted and passed to the app. */
  accepted: 0,
  /** Text assembled but not yet sent, because the thought looks unfinished. */
  holding: '',
  /** How long the assembler decided to wait before sending, in ms. */
  waitedMs: 0,
  /** Barge-ins suppressed because he had only just started the sentence. */
  selfGuarded: 0,
  /** Transcription failures (network, or the bridge speech proxy). */
  restarts: 0,
  /** Milliseconds the last transcription round-trip took. */
  idleMs: 0,
  /** This window can't hear at all (microphone blocked, or no working speech
   *  recognition) — said on screen rather than left as a silent standby. */
  unusable: false,
}

/** Speech-recognition errors that mean the window can't recognise speech,
 *  as opposed to 'no-speech' or 'aborted', which are ordinary. */
const BROKEN_RECOGNITION = new Set(['network', 'audio-capture', 'language-not-supported', 'bad-grammar'])

/** What to do when this window can't hear: Chrome on the Mac, Settings on the phone. */
const HEAR_HELP =
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
    ? 'On the iPhone, allow the microphone for JARVIS (Settings → Safari → Microphone) and turn on Dictation (Settings → General → Keyboard).'
    : 'Open JARVIS in Chrome at http://localhost:5173 — app and editor preview windows block the microphone and speech recognition. You can still type to him.'

/** Record why a transcript went nowhere. Silence always has a reason; this is
 *  the difference between debugging it and speculating about it. */
function drop(why: string) {
  diag.dropped = why
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__voice = diag
}

/**
 * Pick the voice engine and start it.
 *
 * Two engines, chosen by what the bridge reported at boot (see capabilities.ts):
 *   - ElevenLabs available -> local voice-activity detection for instant
 *     barge-in, and ElevenLabs Scribe for the words. The reliable path.
 *   - nothing configured -> the browser's own SpeechRecognition, so a student
 *     with no keys still has a working assistant. Less robust, but free and
 *     zero-setup, and guarded by a heartbeat so its silent death is recovered.
 *
 * The microphone is opened once here so a denied permission is reported loudly
 * rather than surfacing later as an unexplained deafness, whichever engine runs.
 */
export async function startVoice(h: VoiceHandlers): Promise<Voice> {
  try {
    await getMic()
  } catch (err) {
    diag.lastError = 'mic'
    diag.unusable = true
    h.onError(
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? `Microphone access denied, so I can't hear you. ${HEAR_HELP}`
        : `No microphone available, so I can't hear you. ${HEAR_HELP}`,
    )
    return { stop: () => {}, finish: async () => {}, live: () => false }
  }
  diag.engine = caps().stt ? 'elevenlabs' : 'browser'
  return caps().stt ? startElevenVoice(h) : startBrowserVoice(h)
}

/** VAD + ElevenLabs Scribe. */
async function startElevenVoice(h: VoiceHandlers): Promise<Voice> {
  let lastWake = 0
  let vad: Vad | null = null

  /**
   * Segments waiting for the transcriber, oldest first.
   *
   * This was a boolean — `if (transcribing) return` — and that single line was
   * the worst bug in the pause story. Segments arrive faster than Scribe
   * answers whenever someone speaks in bursts, which is exactly what pausing
   * mid-sentence looks like, so the second half of the thought was not merely
   * mis-timed, it was silently discarded. Queue instead: nothing a person says
   * out loud gets thrown away because the network was busy.
   *
   * Order is preserved because the drain is single-flight, which matters —
   * "London" arriving before "what's the weather in" is worse than either.
   */
  const pendingAudio: { blob: Blob; mode: VoiceMode }[] = []
  let draining: Promise<void> | null = null

  /**
   * The mode each segment began in. A recording that started while the mic did
   * not count (he was talking, or push-to-talk was idle) is his voice or the
   * room, and is never sent — even if the transcript arrives after the user
   * has pressed Space, when the mode would otherwise say it counts.
   */
  let segMode: VoiceMode = 'deaf'
  let lastMode: VoiceMode = 'deaf'

  /** Set while push-to-talk is closing a turn: the words already spoken are
   *  still transcribed and kept, though the app has moved on to thinking. */
  let finishing = false

  /**
   * Transcripts become turns here rather than one-per-segment.
   * See makeAssembler for why.
   */
  const assemble = makeAssembler({
    emit: (text) => {
      diag.dropped = ''
      diag.accepted++
      diag.holding = ''
      h.onUtterance(text)
    },
    partial: (text) => h.onPartial(text),
  })

  /**
   * Send one captured segment to the bridge and act on the words.
   *
   * The mode is re-read here, not at capture time, because a barge-in flips the
   * machine from 'guard' to 'listening' between the segment starting and its
   * transcript arriving — and the transcript belongs to the mode the user is in
   * now, not the one they interrupted.
   */
  const transcribe = async (blob: Blob, startedIn: VoiceMode) => {
    if (startedIn === 'deaf') {
      drop('recorded while the mic was not listening')
      return
    }
    const mode: VoiceMode = finishing ? 'dictate' : h.mode()
    if (mode === 'deaf') return
    const t0 = performance.now()
    try {
      const res = await fetch(`${BRIDGE_HTTP_URL}/stt`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      })
      diag.idleMs = Math.round(performance.now() - t0)
      if (!res.ok) {
        diag.restarts++
        diag.lastError = `stt ${res.status}`
        drop(`transcription failed (${res.status})`)
        return
      }
      const { text } = (await res.json()) as { text?: string }
      const said = stripNoiseTags((text ?? '').trim())
      diag.lastError = ''

      if (!said) {
        drop('nothing intelligible in the segment')
        return
      }

      // Push-to-talk: the mic only counts while he is silent, so there is no
      // echo to filter, and nothing is decided until the key says so.
      if (mode === 'dictate') {
        diag.heard = said
        diag.heardAt = Date.now()
        assemble.hold(said)
        return
      }

      // His own voice, come back through the microphone. The raised guard
      // threshold stops most of it at the door; this catches the rest.
      if (isEcho(said, speakingNow())) {
        drop('echo of his own voice')
        return
      }

      diag.heard = said
      diag.heardAt = Date.now()

      if (mode === 'wake') {
        if (WAKE.test(said) && Date.now() - lastWake > WAKE_DEBOUNCE) {
          lastWake = Date.now()
          diag.wakes++
          diag.dropped = ''
          diag.accepted++
          h.onWake(afterWake(said))
        } else {
          drop(`heard "${said.slice(-40)}" — not his name`)
        }
        return
      }

      // Not a turn yet — a piece of one. The assembler decides when the thought
      // is finished, reading the words and whether the room is still noisy.
      assemble.feed(said, vad?.meter().speaking ?? false)
    } catch (err) {
      diag.restarts++
      diag.lastError = String(err)
      drop('could not reach the speech service')
    }
  }

  /** One transcription at a time, in the order the segments were spoken.
   *  Resolves when the queue is empty, including anything added meanwhile. */
  const drain = (): Promise<void> => {
    if (draining) return draining
    draining = (async () => {
      try {
        while (pendingAudio.length) {
          const next = pendingAudio.shift()!
          await transcribe(next.blob, next.mode)
        }
      } finally {
        draining = null
      }
    })()
    return draining
  }

  let bargeTimer: ReturnType<typeof setTimeout> | null = null

  vad = await startVad({
    onStart: () => {
      const mode = h.mode()
      segMode = mode
      diag.mode = mode
      diag.sessions++
      if (mode === 'deaf' || mode === 'dictate') return
      // Standing down mid-thought throws the thought away with it. Otherwise
      // held text would surface as the opening of the *next* conversation.
      if (mode === 'wake') assemble.cancel()
      // Talking again after a pause: the held words are not the whole thought.
      if (mode === 'command') assemble.extend()
      // The barge-in. In guard mode the user has started talking over him, and
      // because the guard threshold is high this is a real interruption rather
      // than leaked playback — so cut him off now, do not wait for the words.
      if (mode === 'guard') {
        const since = speakingSince()
        if (since && Date.now() - since < SELF_GUARD_MS) {
          diag.selfGuarded++
          return
        }
        // Wait out a short noise: cut only if he is still speaking after the
        // sustain window, and the mode has not changed in the meantime.
        if (bargeTimer) clearTimeout(bargeTimer)
        bargeTimer = setTimeout(() => {
          bargeTimer = null
          if (h.mode() === 'guard' && vad?.meter().speaking) h.onSpeechStart()
          else diag.selfGuarded++
        }, BARGE_SUSTAIN_MS)
      }
    },
    onEnd: (blob) => {
      if (bargeTimer) {
        clearTimeout(bargeTimer)
        bargeTimer = null
      }
      // The segment closes after SILENCE_MS of quiet, so speech ended then.
      diag.lastSpeechAt = Date.now() - SILENCE_MS
      pendingAudio.push({ blob, mode: segMode })
      void drain()
    },
    onLevel: (v) => {
      const mode = h.mode()
      // The moment the mic starts counting for the user, a recording already
      // running is his voice or the room — start a fresh one, so the user's
      // first words are not thrown away along with it.
      if (mode !== lastMode) {
        const wasListening = lastMode === 'command' || lastMode === 'dictate'
        const nowListening = mode === 'command' || mode === 'dictate'
        if (nowListening && !wasListening && segMode === 'deaf' && vad?.meter().speaking) vad.drop()
        lastMode = mode
      }
      // Only paint the live level while actually listening for a command, so a
      // dormant reactor stays calm and does not twitch at every room noise.
      if (mode !== 'command' && mode !== 'dictate') return
      // Never over the assembled text. This used to run unconditionally and
      // overwrote a half-built sentence with an ellipsis sixty times a second,
      // so a pause looked like the interface had forgotten what you just said.
      if (assemble.held()) return
      h.onPartial(v > 0.04 ? '…' : '')
    },
    onError: (message) => {
      diag.lastError = 'capture'
      diag.running = false
      h.onError(message)
    },
  })
  diag.running = vad.live()

  // Raise the trigger bar exactly while he speaks. The mode is polled rather
  // than pushed because nothing in the app pushes phase changes here, and a
  // 200ms lag on the echo gate is imperceptible.
  const guardPoll = setInterval(() => {
    const mode = h.mode()
    vad?.setGuard(mode === 'guard')
    // He has stood down — by Escape, by the idle timeout, or by dropping back
    // to the wake word. Anything half-said belonged to a conversation that is
    // over, and letting the hold expire later would open the next one with a
    // fragment of the last.
    if (!finishing && (mode === 'wake' || mode === 'deaf') && assemble.held()) assemble.cancel()
  }, 200)

  return {
    stop: () => {
      clearInterval(guardPoll)
      assemble.cancel()
      vad?.stop()
      diag.running = false
    },
    finish: async () => {
      if (finishing) return
      finishing = true
      try {
        // Close the segment being spoken now rather than waiting for a pause,
        // then wait for every segment to come back as words, then send.
        await vad?.cut()
        await drain()
        assemble.flush()
      } finally {
        finishing = false
      }
    },
    live: () => vad?.live() ?? false,
  }
}

/* -------------------------------------------------------------------------- */
/* Browser fallback: SpeechRecognition                                        */
/* -------------------------------------------------------------------------- */

/**
 * The keyless path. Uses the browser's own SpeechRecognition for both detection
 * and transcription, so a student who has configured nothing still gets voice.
 *
 * It is the flakier engine — Chrome throttles it and it can go silent with no
 * event to catch — so a heartbeat watches it and forces a fresh session
 * whenever it stops showing signs of life. That single guard is the difference
 * between "the wake word stopped working halfway through the lesson" and an
 * assistant that keeps listening.
 */
function startBrowserVoice(h: VoiceHandlers): Voice {
  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (!Ctor) {
    h.onError('This browser has no speech recognition — use Chrome or Edge, or add an ElevenLabs key.')
    return { stop: () => {}, finish: async () => {}, live: () => false }
  }

  let stopped = false
  let running = false
  let rec: any = null
  let started = false
  let barged = false
  let lastWake = 0
  let lastAlive = Date.now()
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  /** Recognition failures in a row with nothing heard between them. */
  let failures = 0
  /** Whether the recogniser has ever actually started, and why not if not. */
  let opened = false
  let startError = ''
  const bornAt = Date.now()

  /**
   * What has already been used.
   *
   * Chrome's continuous recogniser keeps every result of its session, and a
   * result it is still working on comes back in full, longer each time, until
   * it is final. Taking the text and forgetting it is therefore not enough: the
   * next event hands back "most of the" after "most of" was already sent, so
   * every pause became another turn repeating the last one, each a word
   * longer — and each of those cut off the answer to the one before.
   *
   * So the results themselves are the record. Everything before `base` is
   * spent, and so are the first `skip` words of results[base] (a result still
   * in progress when it was used). Nothing is ever read twice.
   */
  let results: any = null
  let base = 0
  let skip = 0
  /** The mode at the last check, to notice the mic starting to count. */
  let lastMode: VoiceMode = 'deaf'

  const listening = (m: VoiceMode) => m === 'command' || m === 'dictate'
  const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean)

  /** Everything recognised and not yet used, interim words included. */
  const pending = (): string => {
    if (!results) return ''
    const out: string[] = []
    for (let i = base; i < results.length; i++) {
      const w = wordsOf(String(results[i][0]?.transcript ?? ''))
      out.push(...(i === base ? w.slice(skip) : w))
    }
    return out.join(' ')
  }

  /** Mark everything recognised so far as used. */
  const consume = () => {
    const n = results?.length ?? 0
    if (!n) {
      base = 0
      skip = 0
      return
    }
    const last = results[n - 1]
    if (last.isFinal) {
      base = n
      skip = 0
    } else {
      base = n - 1
      skip = wordsOf(String(last[0]?.transcript ?? '')).length
    }
  }

  /** The mic has just started counting: what came before was not for us. */
  const noticeMode = (mode: VoiceMode) => {
    if (listening(mode) && !listening(lastMode)) {
      consume()
      started = false
      barged = false
    }
    lastMode = mode
  }

  /** Same assembly rules as the premium path — a pause is not a full stop. */
  const assemble = makeAssembler({
    emit: (text) => {
      diag.dropped = ''
      diag.accepted++
      diag.holding = ''
      h.onUtterance(text)
    },
    partial: (text) => h.onPartial(text),
  })

  const touch = () => {
    lastAlive = Date.now()
  }

  const clearSilence = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = null
  }

  /** Take what is pending as one segment and hand it on. */
  const emit = () => {
    clearSilence()
    const text = pending()
    consume()
    started = false
    barged = false
    const mode = h.mode()
    if (!text || mode === 'deaf' || mode === 'wake') return
    if (mode !== 'dictate' && isEcho(text, speakingNow())) {
      drop('echo of his own voice')
      return
    }
    diag.heard = text
    diag.heardAt = Date.now()
    if (mode === 'dictate') {
      assemble.hold(text)
      return
    }
    // The recogniser has already endpointed on its own 900ms gap; the assembler
    // decides whether that gap actually ended the thought. `false` because a
    // result only reaches here once the recogniser has gone quiet.
    assemble.feed(text, false)
  }

  const bumpSilence = () => {
    clearSilence()
    // Endpoint on a short quiet gap; the ElevenLabs path tunes this more
    // finely, but a fixed window is plenty for the fallback.
    silenceTimer = setTimeout(emit, 900)
  }

  const onResult = (e: any) => {
    touch()
    failures = 0
    diag.unusable = false
    const mode = h.mode()
    diag.mode = mode
    // Checked against the results as they were before this event, so words
    // that arrive in it are the user's, and words before it are not.
    noticeMode(mode)
    results = e.results

    // Not listening: whatever this is, it is spent.
    if (mode === 'deaf') {
      consume()
      return
    }

    const heard = pending()
    if (!heard) return

    if (mode === 'wake') {
      if (isEcho(heard, speakingNow())) {
        consume()
        return
      }
      if (WAKE.test(heard) && Date.now() - lastWake > WAKE_DEBOUNCE) {
        lastWake = Date.now()
        diag.wakes++
        diag.heard = heard
        diag.heardAt = Date.now()
        const trailing = afterWake(heard)
        consume()
        h.onWake(trailing)
      } else if (results[results.length - 1]?.isFinal || heard.length > 400) {
        // A finished phrase without his name in it is not for him.
        drop(`heard "${heard.slice(-40)}" — not his name`)
        consume()
      }
      return
    }

    // Push-to-talk: show it, keep it, decide nothing — the key ends the turn.
    if (mode === 'dictate') {
      diag.dropped = ''
      diag.lastSpeechAt = Date.now()
      h.onPartial([assemble.held(), heard].filter(Boolean).join(' '))
      return
    }

    if (isEcho(heard, speakingNow())) {
      consume()
      return
    }
    diag.lastSpeechAt = Date.now()

    if (mode === 'command') assemble.extend()
    if (!started || (mode === 'guard' && !barged)) {
      const words = wordsOf(heard).length
      if (mode === 'guard') {
        // An override word cuts through everything below it — "stop" has to
        // work on the first syllable or it is not a stop button.
        if (!OVERRIDE.test(heard)) {
          // His own first syllable, same as the premium path. This engine has
          // no energy gate, so without the clock the only defence is the word
          // count below, and a single clear word is exactly what leaks first.
          const since = speakingSince()
          if (since && Date.now() - since < SELF_GUARD_MS) {
            diag.selfGuarded++
            return
          }
          // Two words before this engine believes an interruption. The energy
          // path can be instant because it triggers on loudness the canceller
          // has already had a pass at; here the evidence is a transcript of
          // audio that includes his own playback, and one word of that is not
          // evidence of anything.
          if (words < 2) return
        }
      }
      started = true
      if (mode === 'guard') barged = true
      h.onSpeechStart()
    }
    diag.dropped = ''
    // Show the whole thought, not just the fragment being spoken now — there
    // may be an earlier half of it held by the assembler.
    const carried = assemble.held()
    h.onPartial(carried ? `${carried} ${heard}` : heard)
    bumpSilence()
  }

  const spin = () => {
    if (stopped || running) return
    rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-GB'
    rec.onstart = () => {
      opened = true
      running = true
      diag.running = true
      diag.sessions++
      touch()
    }
    rec.onresult = onResult
    rec.onerror = (ev: any) => {
      const code = String(ev.error ?? '')
      diag.lastError = code
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        stopped = true
        diag.running = false
        diag.unusable = true
        h.onError(`I can't use the microphone in this window. ${HEAR_HELP}`)
        return
      }
      // A window that can't do speech recognition at all — an app's built-in
      // preview, a browser without the speech service — fails like this on
      // every session, for ever, and used to say nothing: he just sat on
      // standby. Three in a row with nothing heard in between is that.
      if (BROKEN_RECOGNITION.has(code) && ++failures === 3) {
        diag.unusable = true
        h.onError(`I can't hear you in this window: its speech recognition isn't working (${code}). ${HEAR_HELP}`)
      }
    }
    rec.onend = () => {
      running = false
      diag.running = false
      touch()
      rec = null
      // A session ending is an endpoint: whatever it heard and nobody has used
      // yet goes now, before its results are gone with it.
      if (pending()) {
        const mode = h.mode()
        if (mode === 'dictate') {
          const text = pending()
          if (text) assemble.hold(text)
        } else if (mode === 'command' || mode === 'guard') {
          emit()
        }
      }
      results = null
      base = 0
      skip = 0
      if (!stopped) setTimeout(spin, 80)
    }
    try {
      rec.start()
    } catch (err) {
      startError = String((err as Error)?.message ?? err)
      running = false
      setTimeout(spin, 250)
    }
  }

  spin()

  // Mode changes happen between results too — pressing Space, Escape, the
  // answer ending. Noticing them here means nothing from before the mic
  // started counting can ride along with the first words after it.
  const modeWatch = setInterval(() => {
    const mode = h.mode()
    noticeMode(mode)
    if ((mode === 'wake' || mode === 'deaf') && assemble.held()) assemble.cancel()
  }, 100)

  // The heartbeat. If nothing has been heard from the engine for a while it has
  // gone quiet on us — tear it down and build a fresh one.
  const health = setInterval(() => {
    if (stopped) return
    // Never started at all: it throws on start, or starts without ever saying
    // so. The screen used to read "Reconnecting microphone…" for ever while it
    // retried in silence, which is the "stuck on standby" this ends.
    if (!opened && !diag.unusable && Date.now() - bornAt > 12000) {
      diag.unusable = true
      h.onError(`I can't hear you in this window: speech recognition never started${startError ? ` (${startError})` : ''}. ${HEAR_HELP}`)
    }
    const idle = Date.now() - lastAlive
    diag.idleMs = idle
    if (idle < 15000) return
    diag.restarts++
    try {
      rec?.abort()
    } catch {
      /* already gone */
    }
    rec = null
    running = false
    diag.running = false
    touch()
    spin()
  }, 5000)

  return {
    stop: () => {
      stopped = true
      clearInterval(health)
      clearInterval(modeWatch)
      clearSilence()
      assemble.cancel()
      diag.running = false
      try {
        rec?.abort()
      } catch {
        /* noop */
      }
    },
    finish: async () => {
      // Everything recognised so far, including words still being recognised,
      // is the whole thought. Taken directly rather than through emit(): the
      // app may already have moved on to thinking, where the mode says deaf.
      clearSilence()
      const text = pending()
      consume()
      started = false
      barged = false
      if (text) {
        diag.heard = text
        diag.heardAt = Date.now()
        assemble.hold(text)
      }
      assemble.flush()
    },
    live: () => running,
  }
}
