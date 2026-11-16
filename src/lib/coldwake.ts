/**
 * Saying "Jarvis" on the intro screen powers him up.
 *
 * The browser's own recogniser listens here, because it needs no audio
 * context and so no key press first. It only starts when the microphone is
 * already allowed for this page — opening the intro must never pop a
 * permission prompt — and it stops the moment he boots, when the real voice
 * loop takes the microphone.
 */

type Rec = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  abort: () => void
}

const NAME = /\b(jarvis|wake up)\b/i

export async function listenForName(onName: () => void): Promise<{ stop: () => void }> {
  const none = { stop: () => {} }
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return none
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (perm.state !== 'granted') return none
  } catch {
    return none
  }

  let stopped = false
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = 'en-US'
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (NAME.test(e.results[i][0].transcript)) {
        stopped = true
        rec.abort()
        onName()
        return
      }
    }
  }
  // Chrome ends recognition sessions on its own every so often; keep going.
  rec.onend = () => {
    if (stopped) return
    setTimeout(() => {
      if (stopped) return
      try {
        rec.start()
      } catch {
        /* already running */
      }
    }, 300)
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true
  }
  try {
    rec.start()
  } catch {
    return none
  }
  return {
    stop: () => {
      stopped = true
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
    },
  }
}
