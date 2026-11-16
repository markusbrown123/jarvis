import { useStore } from '../store'
import * as hands from './hands'

let starting = false

/**
 * The one way hand tracking is switched on or off — the G key, the on-screen
 * button and the voice tool all come through here, so they cannot disagree.
 *
 * Off by default and never implicit: nothing calls this on load.
 */
export async function setHandsEnabled(on?: boolean): Promise<void> {
  const s = useStore.getState()
  const want = on ?? !s.gestures
  if (!want) {
    hands.disableHands()
    s.setGestures(false)
    return
  }
  if (hands.handsRunning() || starting) return
  starting = true
  s.setError(null)
  // Lit before the model loads: the camera is already live by then, and the
  // indicator must never lag behind it.
  s.setGestures(true)
  try {
    await hands.enableHands()
  } catch (err) {
    s.setGestures(false)
    const e = err as Error
    s.setError(
      e?.name === 'NotAllowedError'
        ? 'Camera access denied — gesture control is unavailable.'
        : `Gesture control failed to start: ${e?.message ?? err}`,
    )
  } finally {
    starting = false
  }
}
