import { useEffect } from 'react'
import { create } from 'zustand'
import { hubActions, useHub, type Autopilot, type Stream } from './client'

/**
 * The streams of work, from their bases (bridge/hub/streams.mjs), for
 * everything that shows them: the Projects page and the project pads in the
 * station. Read every 30 s while shown, and again whenever a run of JARVIS's
 * finishes, since a run ticks milestones in its brief.
 */

export type StreamsData = { streams: Stream[]; links: { label: string; url: string }[]; autopilot: Record<string, Autopilot> }

export const useStreams = create<{ data: StreamsData | null; err: string | null }>(() => ({ data: null, err: null }))

export async function refreshStreams() {
  try {
    useStreams.setState({ data: await hubActions.streams(), err: null })
  } catch (e) {
    useStreams.setState({ err: (e as Error).message })
  }
}

/** Keep the streams fresh while this component is shown. */
export function useStreamsLive() {
  const finished = useHub((x) => Object.values(x.state?.jobs ?? {}).filter((j) => j.autopilot && j.state !== 'running').length)
  useEffect(() => {
    void refreshStreams()
  }, [finished])
  useEffect(() => {
    const t = setInterval(() => void refreshStreams(), 30000)
    return () => clearInterval(t)
  }, [])
  return useStreams()
}
