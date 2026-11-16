/*
 * The phone app's service worker (registered by src/main.tsx on touch screens).
 *
 * It does one thing: when the app is opened and the Mac can't be reached —
 * asleep, JARVIS not running, Tailscale off — it shows offline.html (the lock
 * screen, saying so) instead of Safari's error page. Everything else goes
 * straight to the network and nothing of the app is cached, so an update to
 * JARVIS is there the next time it opens.
 */
const CACHE = 'jarvis-offline-v1'
const OFFLINE = ['/offline.html', '/icons/icon-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')))
})
