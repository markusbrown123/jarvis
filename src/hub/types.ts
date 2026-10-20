/** The command center's state, as the bridge's /api/state serves it. */

export type JobState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'needs_markus'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'

export type Job = {
  id: string
  source: string
  project: string
  title: string
  state: JobState
  stale?: boolean
  stage?: string
  nextStep?: string
  worker?: string | null
  who?: string
  model?: string
  game?: string
  taskId?: string
  revision?: string
  priority?: string
  lease?: { worker: string; claimedAt: number; expiresAt: number } | null
  heartbeatAt?: number
  createdAt?: number
  updatedAt: number
  blocker?: string | null
  summary?: string
  acceptance?: string[]
  attempts?: number
  done?: number
  total?: number
  cwd?: string
  cancel?: 'supported' | 'unsupported'
}

export type ItemState = 'open' | 'in_progress' | 'snoozed' | 'verifying' | 'resolved' | 'canceled'

export type ItemAction =
  | { kind: 'copy'; label: string; value: string }
  | { kind: 'open'; label: string; url: string }
  | { kind: 'check'; label: string }

export type Item = {
  id: string
  source: string
  project: string
  title: string
  why?: string
  instructions?: string
  destination?: { label: string; url: string | null; path?: string } | null
  prepared?: string | null
  estimate?: string | null
  verify?: { kind: string; note?: string }
  resumes?: string | null
  priority: 'P1' | 'P2' | 'P3'
  state: ItemState
  createdAt: number
  updatedAt: number
  snoozedUntil?: number | null
  lastCheck?: { at: number; ok: boolean | null; detail: string }
  actions?: ItemAction[]
}

export type Activity = {
  id: string
  ts: number
  source: string
  project: string | null
  title: string
  detail: string
  level: 'info' | 'success' | 'warn' | 'error'
  ref: { kind: 'job' | 'item'; id: string } | null
}

export type Preview = {
  id: string
  project: string
  game?: string
  kind: 'LIVE' | 'LAST_PLAYTEST' | 'WEB_PROTOTYPE' | 'ASSET' | 'SITE'
  title: string
  url?: string | null
  file?: string
  revision?: string
  capturedAt?: number
  stage?: string
  note?: string
}

export type Commit = { sha?: string; short: string; committedAt: number; subject: string }

export type Playtest = {
  latest: { heading: string; date: string } | null
  runtimeVerified: number
  staticallyChecked: number
  pass: number
  fail: number
}

export type Game = {
  id: string
  name: string
  tagline: string | null
  readmeStatus: string | null
  published: boolean
  placeId: string | null
  playtest: Playtest | null
  art: { thumbnail?: string; hero?: string; icon?: string; alternates?: string[]; count?: number }
  tasks: { running: number; queued: number; blocked: number; done: number }
  active: boolean
  next: boolean
}

export type RobloxProject = {
  id: 'roblox'
  name: string
  error?: string
  source?: { repo: string; branch: string; path: string; commit: Commit; fetchedAt: number }
  worker?: { name: string; lan?: string; lastSeenAt: number }
  activeGame?: string | null
  nextGame?: string | null
  backlog?: string[]
  pcSession?: string | null
  games?: Game[]
  live?: { available: boolean; reason: string }
  updatedAt: number
}

export type Site = {
  id: string
  name: string
  category: string | null
  location: string | null
  stage: string
  previewUrl: string | null
  publishedUrl: string | null
  publishStatus: string | null
  publishedAt: number | null
  updatedAt: number
}

export type AutomatonProject = {
  id: 'automaton'
  name: string
  publicUrl: string
  routes: { path: string; label: string; url: string }[]
  repo: { path: string; branch?: string; commit?: Commit; changedFiles?: number; error?: string } | null
  site: { ok: boolean; status: number; ms: number; error?: string; checkedAt: number } | null
  sites: Site[] | null
  sitesError: string | null
  leads: { total: number; byStage: Record<string, number> } | null
  leadsError: string | null
  board: { active: string[] } | null
  updatedAt: number
}

export type Service = {
  id: string
  name: string
  url: string
  up: boolean
  status: number
  ms: number
  repo: string | null
  commit: Commit | null
  checkedAt: number
}

export type FinanceProject = {
  id: 'finance'
  name: string
  mode: string
  broker: null
  services: Service[]
  research: { id: string; name: string; repo: string | null; commit: Commit | null }[]
  charts: { symbol: string; label: string }[]
  quantView: { name: string | null; url: string | null }
  note: string
  updatedAt: number
}

export type UsageWindow = { usedPct: number; resetsAt: number | null; observedAt: number; source: string }

export type Usage = {
  windows: { five_hour?: UsageWindow; seven_day?: UsageWindow; spend_limit?: UsageWindow }
  context: { usedPct: number | null; size: number | null; observedAt: number; source: string } | null
  requests: {
    count: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    costUsd: number
    since?: number
  }
  status: { status: string | null; window: string | null; resetsAt: number | null; usingOverage: boolean; observedAt: number } | null
  statusLine?: { at: number; model: string | null; version: string | null; hasRateLimits: boolean }
  sources: Record<string, number>
}

export type HubState = {
  version: number
  jobs: Record<string, Job>
  items: Record<string, Item>
  projects: {
    roblox?: RobloxProject
    automaton?: AutomatonProject
    finance?: FinanceProject
  }
  previews: Record<string, Preview>
  usage: Usage
  activity: Activity[]
  serverTime: number
}
