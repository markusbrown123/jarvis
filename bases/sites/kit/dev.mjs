#!/usr/bin/env node
// Preview the kit locally: the pages from public/, the API from the real
// function handlers, leads and bookings kept in memory.
//
//   node dev.mjs                      # http://localhost:8888
//   ANTHROPIC_API_KEY=… node dev.mjs  # the assistant answers for real
//   KIT_FAKE_MODEL=1 node dev.mjs     # a canned assistant, no key, no cost
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('./public/', import.meta.url))
const PORT = Number(process.env.PORT) || 8888
process.env.CONTEXT = 'dev'
globalThis.__kitMemory = {}

if (process.env.KIT_FAKE_MODEL) {
  const { deps } = await import('./lib/bot.mjs')
  process.env.ANTHROPIC_API_KEY ||= 'fake'
  deps.client = {
    beta: {
      messages: {
        create: async ({ messages }) => {
          const q = messages.at(-1).content.toLowerCase()
          const out = /book|call|start|want/.test(q)
            ? { reply: 'Happy to set that up — pick a time for a 15-minute call and we’ll go through your site.', action: 'booking' }
            : /fast|long|live/.test(q)
              ? { reply: 'Most sites are ready to review within 12–24 hours of the short survey, and go live the same day you approve.', action: 'none' }
              : { reply: 'A fully custom site for your trade and area — mobile-first, click-to-call, local SEO, hosting and SSL — for $299 one time, paid only once you approve it.', action: 'none' }
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }
        },
      },
    },
  }
}

const routes = {}
for (const name of ['chat', 'lead', 'booking', 'feed', 'site']) {
  const mod = await import(`./netlify/functions/${name}.mjs`)
  routes[mod.config.path] = mod.default
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const handler = routes[url.pathname]
  if (handler) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) })
    const out = await handler(request, { ip: req.socket.remoteAddress })
    res.writeHead(out.status, Object.fromEntries(out.headers))
    return res.end(Buffer.from(await out.arrayBuffer()))
  }
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)))
  if (!path.startsWith(ROOT)) return res.writeHead(403).end()
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}).listen(PORT, () => console.log(`site kit on http://localhost:${PORT}`))
