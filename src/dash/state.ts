import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { diag as voiceDiag } from '../lib/voice'
import { useHub } from '../hub/client'
import type { Item } from '../hub/types'

/** Re-render on a timer, for countdowns and polled voice state. */
export function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

export type InputState = { label: string; tone: 'off' | 'idle' | 'live' | 'held' | 'busy' | 'speak' | 'fail' }

/**
 * What the microphone pipeline is really doing, in words. Never says
 * "Listening" when capture has failed or the mic has been released.
 */
export function inputState(): InputState {
  const { phase, micArmed, talkMode, caption, activeTool } = useStore.getState()
  if (phase === 'offline') return { label: 'Offline — press Start', tone: 'off' }
  if (phase === 'boot') return { label: 'Starting…', tone: 'busy' }
  if (!micArmed) return { label: 'Microphone off', tone: 'off' }
  if (voiceDiag.lastError === 'mic') return { label: 'Microphone unavailable', tone: 'fail' }
  if (!voiceDiag.running) return { label: 'Reconnecting microphone…', tone: 'fail' }
  switch (phase) {
    case 'dormant':
      return {
        label: talkMode === 'auto' ? 'Standby — say “Hey Jarvis”' : talkMode === 'hold' ? 'Standby — hold Space to talk' : 'Standby — press Space to talk',
        tone: 'idle',
      }
    case 'waking':
    case 'listening':
      if (voiceDiag.holding) return { label: 'You paused — still listening', tone: 'held' }
      if (caption && caption !== '…') return { label: 'Hearing you', tone: 'live' }
      return { label: 'Listening', tone: 'live' }
    case 'thinking':
      return { label: 'Thinking', tone: 'busy' }
    case 'tooling':
      return { label: activeTool ? `Working — ${activeTool}` : 'Working', tone: 'busy' }
    case 'speaking':
      return { label: 'Speaking', tone: 'speak' }
  }
  return { label: phase, tone: 'idle' }
}

export function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => useHub.getState().say('Copied'),
    () => useHub.getState().say('Could not copy — select the text instead'),
  )
}

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 }

export function openItems(items: Record<string, Item> | undefined, all = false): Item[] {
  return Object.values(items ?? {})
    .filter((i) => (all ? true : ['open', 'in_progress', 'verifying'].includes(i.state)))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt - a.updatedAt)
}

