/**
 * Ideas: Markus's, caught wherever he has them — said to JARVIS, typed at
 * the desk — and worked on together. Each is the idea in his words, JARVIS's
 * notes as it's developed (angles, first steps, risks), the project it's for,
 * and where it stands: new, developing, building (handed to Claude Code),
 * done or parked. One JSON file in the data dir; every change goes straight
 * to the desk.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './store.mjs'

const FILE = join(DATA_DIR, 'ideas.json')
export const STATES = ['new', 'developing', 'building', 'done', 'parked']
export const PROJECTS = ['jarvis', 'automaton', 'roblox', 'finance', 'other']
const MAX = 300

let ideas = []
try {
  if (existsSync(FILE)) ideas = JSON.parse(readFileSync(FILE, 'utf8')).ideas ?? []
} catch {
  ideas = []
}
const listeners = new Set()

function save() {
  // Whole file, then a rename: a crash mid-write never leaves half a list.
  writeFileSync(`${FILE}.tmp`, JSON.stringify({ ideas }, null, 2))
  renameSync(`${FILE}.tmp`, FILE)
  for (const fn of listeners) fn(list())
}

export const list = () => [...ideas].sort((a, b) => b.updatedAt - a.updatedAt)
export const get = (id) => ideas.find((i) => i.id === id) ?? null

export function add({ text, project, source = 'desk' }) {
  const words = String(text ?? '').trim().slice(0, 4000)
  if (!words) throw new Error('An idea needs some words.')
  const now = Date.now()
  const idea = {
    id: `idea-${now.toString(36)}`,
    title: words.split(/[.\n]/)[0].slice(0, 90),
    text: words,
    notes: '',
    project: PROJECTS.includes(project) ? project : 'other',
    state: 'new',
    source,
    createdAt: now,
    updatedAt: now,
  }
  ideas.push(idea)
  if (ideas.length > MAX) ideas.splice(0, ideas.length - MAX)
  save()
  return idea
}

/** Change an idea; `notes` replaces JARVIS's notes, `addNotes` appends to them. */
export function update(id, patch = {}) {
  const idea = get(id)
  if (!idea) throw Object.assign(new Error('No such idea.'), { status: 404 })
  if (typeof patch.title === 'string' && patch.title.trim()) idea.title = patch.title.trim().slice(0, 90)
  if (typeof patch.text === 'string' && patch.text.trim()) idea.text = patch.text.trim().slice(0, 4000)
  if (typeof patch.notes === 'string') idea.notes = patch.notes.trim().slice(0, 8000)
  if (typeof patch.addNotes === 'string' && patch.addNotes.trim()) idea.notes = `${idea.notes ? `${idea.notes}\n\n` : ''}${patch.addNotes.trim()}`.slice(-8000)
  if (PROJECTS.includes(patch.project)) idea.project = patch.project
  if (STATES.includes(patch.state)) idea.state = patch.state
  idea.updatedAt = Date.now()
  save()
  return idea
}

export function remove(id) {
  const n = ideas.length
  ideas = ideas.filter((i) => i.id !== id)
  if (ideas.length === n) return false
  save()
  return true
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
