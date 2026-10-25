import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(<App />)

// The phone app (added to the home screen): a service worker whose only job is
// to show a "can't reach your Mac" screen when the Mac is out of reach
// (public/sw.js). Not on the Mac itself, where there's nothing to reach.
if ('serviceWorker' in navigator && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
