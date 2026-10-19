/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null

const VOICE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

const open = (deviceId?: string) =>
  navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...VOICE, deviceId: { exact: deviceId } } : VOICE,
  })

/**
 * macOS hands the default input to a nearby iPhone (Continuity) whenever it
 * can, and that microphone is often unavailable by the time the page asks for
 * it — or it works, and JARVIS listens to a phone in another room. Prefer the
 * Mac's own microphone; any other input that isn't a phone will do.
 */
const PHONE = /iphone|ipad/i

async function localMic(): Promise<string | null> {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) =>
      d.kind === 'audioinput' &&
      d.deviceId !== 'default' &&
      d.deviceId !== 'communications' &&
      !PHONE.test(d.label),
  )
  const builtIn = inputs.find((d) => /macbook|built-in/i.test(d.label))
  return (builtIn ?? inputs[0])?.deviceId ?? null
}

export async function getMic(): Promise<MediaStream> {
  if (stream) return stream
  let s: MediaStream
  try {
    s = await open()
  } catch (err) {
    // A refused permission is final. Anything else may be the phone's mic
    // having gone away, so try the Mac's own before giving up.
    if (err instanceof DOMException && err.name === 'NotAllowedError') throw err
    const id = await localMic()
    if (!id) throw err
    s = await open(id)
  }
  if (PHONE.test(s.getAudioTracks()[0]?.label ?? '')) {
    const id = await localMic()
    if (id) {
      try {
        const own = await open(id)
        s.getTracks().forEach((t) => t.stop())
        s = own
      } catch {
        // The phone works; better than nothing.
      }
    }
  }
  stream = s
  return stream
}

/** Which microphone is actually open, for the diagnostics panel. */
export function micName(): string {
  return stream?.getAudioTracks()[0]?.label ?? ''
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
