import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Honour PORT so a second instance can run alongside the first. The bridge
    // only accepts sockets from localhost:5173-5199, so stay inside that range
    // or set JARVIS_ALLOWED_ORIGINS to match.
    port: Number(process.env.PORT) || 5173,
    // That port or nothing: drifting to the next one free (an old copy still
    // on 5173) left the phone, which Tailscale sends to 5173, on a blank page
    // and the launcher waiting for a page that never came.
    strictPort: true,
    // IPv4 loopback, like the bridge. Left to "localhost", Node on a Mac
    // resolves it to ::1 first and Vite listens there only, so `tailscale
    // serve` (pointed at 127.0.0.1:5173) would find nothing; the browser on
    // the Mac still reaches http://localhost:5173 either way.
    host: '127.0.0.1',
    // `jarvis remote` serves the page to your iPhone at <mac>.<tailnet>.ts.net
    // (Tailscale's own proxy, tailnet only); Vite refuses unknown host names.
    allowedHosts: ['.ts.net'],
  },
  optimizeDeps: {
    // kokoro-js pulls in `phonemizer`, which carries espeak-ng as inline WASM.
    // Vite's dependency pre-bundler rewrites that initialisation and the
    // language table ends up empty — the symptom is
    // `Invalid language identifier: "en". Should be one of: .` at generate()
    // time, long after the model has loaded successfully. Serving these
    // untouched fixes it.
    exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
  },
})
