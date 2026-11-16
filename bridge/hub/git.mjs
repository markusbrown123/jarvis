/**
 * Read-only git access for the project sources.
 *
 * Nothing here checks anything out or touches a branch you work on: updates
 * land in a private ref (refs/jarvis/<name>) via `git fetch`, and files are
 * read with `git show` / `git ls-tree` against that ref. A repo you have
 * checked out stays exactly as you left it.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './store.mjs'

export function git(cwd, args, { timeout = 60000, buffer = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        encoding: buffer ? 'buffer' : 'utf8',
        // Never stop and wait for a password prompt in the background.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const why = String(stderr || err.message).trim().split('\n').slice(-2).join(' ')
          reject(new Error(why))
        } else resolve(stdout)
      },
    )
  })
}

export async function remoteUrl(dir) {
  try {
    return (await git(dir, ['remote', 'get-url', 'origin'])).trim()
  } catch {
    return ''
  }
}

/**
 * A repo to read from: the first candidate whose origin matches, or a
 * blob-less bare clone kept under ~/.jarvis/repos that fetches file contents
 * only when they are read.
 */
export async function locateRepo({ name, url, branch, candidates = [] }) {
  const slug = url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').toLowerCase()
  for (const dir of candidates) {
    if (!dir || !existsSync(join(dir, '.git'))) continue
    if ((await remoteUrl(dir)).toLowerCase().includes(slug)) return { dir, managed: false }
  }
  const dir = join(DATA_DIR, 'repos', `${name}.git`)
  if (!existsSync(dir)) {
    mkdirSync(join(DATA_DIR, 'repos'), { recursive: true })
    await new Promise((resolve, reject) =>
      execFile(
        'git',
        ['clone', '--bare', '--filter=blob:none', '--depth', '1', '--branch', branch, url, dir],
        { timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } },
        (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve()),
      ),
    )
  }
  return { dir, managed: true }
}

/** Bring refs/jarvis/<name> up to the remote branch. Returns its commit info. */
export async function fetchRef(dir, name, branch) {
  await git(dir, ['fetch', '--quiet', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/jarvis/${name}`], {
    timeout: 120000,
  })
  return commitInfo(dir, `refs/jarvis/${name}`)
}

export async function commitInfo(dir, ref) {
  const out = (await git(dir, ['log', '-1', '--format=%H%x09%ct%x09%s', ref])).trim()
  const [sha, ct, ...subject] = out.split('\t')
  return { sha, short: sha.slice(0, 7), committedAt: Number(ct) * 1000, subject: subject.join('\t') }
}

export async function showText(dir, ref, path) {
  return git(dir, ['show', `${ref}:${path}`])
}

export async function listTree(dir, ref, path, { recursive = false } = {}) {
  const args = ['ls-tree', '--full-tree', ...(recursive ? ['-r'] : []), ref, path.endsWith('/') ? path : `${path}/`]
  const out = await git(dir, args)
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t')
      const [, type, sha] = meta.split(' ')
      return { type, sha, path: file, name: file.split('/').pop() }
    })
}

/**
 * Copy one blob to the image cache and return its path. Blobs are immutable,
 * so the sha in the name is the whole cache key.
 */
export async function cacheBlob(dir, sha, name) {
  const cacheDir = join(DATA_DIR, 'cache')
  mkdirSync(cacheDir, { recursive: true })
  const file = join(cacheDir, `${sha.slice(0, 12)}-${name}`)
  if (!existsSync(file)) {
    const data = await git(dir, ['cat-file', 'blob', sha], { buffer: true, timeout: 120000 })
    writeFileSync(file, data)
  }
  return file
}
