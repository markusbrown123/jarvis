import { useStore } from '../store'
import { setHandsEnabled } from '../lib/handsControl'

/**
 * The switch for hand tracking, and the camera indicator when it is on.
 *
 * One control for both on purpose: whatever turns the camera on is the thing
 * that says so and turns it off again.
 */
export function HandsToggle({ className = '' }: { className?: string }) {
  const on = useStore((s) => s.gestures)
  return (
    <button
      type="button"
      className={`hands-toggle ${on ? 'is-on' : ''} ${className}`}
      aria-pressed={on}
      title={on ? 'Camera on — hand tracking runs locally. Click or press G to stop.' : 'Use your hand as a cursor (camera, processed on this Mac only). Press G.'}
      onClick={() => void setHandsEnabled()}
    >
      {on ? 'CAMERA ON · CLICK OR G TO STOP' : 'HANDS · G'}
    </button>
  )
}
