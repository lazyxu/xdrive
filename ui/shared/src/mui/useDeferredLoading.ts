import { useEffect, useRef, useState } from 'react'

// Feedback belongs to the current request generation. The previous delayed
// status cannot flash at the start of a new refresh, even if React batches two
// fast operations. Requests/errors are never delayed; only their spinner is.
export const XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300

export function useXDriveDeferredLoading(
  pending: boolean,
  requestGeneration: number,
  delayMs = XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS,
): boolean {
  // A request ID can be reused for a later visual pending cycle (e.g. a
  // same-folder retry), and the display delay may also change. An effect-only
  // reset runs after paint, so fence the old spinner in this render.
  const cycleRef = useRef({ pending, requestGeneration, delayMs, cycle: 0 })
  if (cycleRef.current.pending !== pending ||
      cycleRef.current.requestGeneration !== requestGeneration ||
      cycleRef.current.delayMs !== delayMs) {
    cycleRef.current = {
      pending, requestGeneration, delayMs, cycle: cycleRef.current.cycle + 1,
    }
  }
  const cycle = cycleRef.current.cycle
  const [visibleCycle, setVisibleCycle] = useState<number | null>(null)
  useEffect(() => {
    if (!pending) return
    const timer = globalThis.setTimeout(() => setVisibleCycle(cycle), delayMs)
    return () => globalThis.clearTimeout(timer)
  }, [pending, cycle, delayMs])
  return pending && visibleCycle === cycle
}
// Some presentational panes expose only a pending Boolean and have no request
// sequence ID. Restart the *visual* delay for each pending cycle; the real
// network request, failure and accepted content are never delayed.
export function useXDriveDeferredPendingLoading(
  pending: boolean,
  delayMs = XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS,
): boolean {
  // The previous cycle's visible spinner must NOT leak into the new render.
  // A passive-effect Boolean reset is after paint; fence display during render.
  const cycleRef = useRef({ pending, delayMs, generation: 0 })
  if (cycleRef.current.pending !== pending || cycleRef.current.delayMs !== delayMs) {
    cycleRef.current = {
      pending, delayMs, generation: cycleRef.current.generation + 1,
    }
  }
  const generation = cycleRef.current.generation
  const [visibleGeneration, setVisibleGeneration] = useState<number | null>(null)
  useEffect(() => {
    if (!pending) return
    const timer = globalThis.setTimeout(() => setVisibleGeneration(generation), delayMs)
    return () => globalThis.clearTimeout(timer)
  }, [pending, generation, delayMs])
  const visible = visibleGeneration === generation
  return pending && visible
}
