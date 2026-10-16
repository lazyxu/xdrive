import { useEffect, useState } from 'react'

// Feedback belongs to the current request generation. The previous delayed
// status cannot flash at the start of a new refresh, even if React batches two
// fast operations. Requests/errors are never delayed; only their spinner is.
export const XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300

export function useXDriveDeferredLoading(
  pending: boolean,
  requestGeneration: number,
  delayMs = XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS,
): boolean {
  const [visibleGeneration, setVisibleGeneration] = useState<number | null>(null)
  useEffect(() => {
    if (!pending) return
    const timer = globalThis.setTimeout(() => {
      setVisibleGeneration(requestGeneration)
    }, delayMs)
    return () => globalThis.clearTimeout(timer)
  }, [pending, requestGeneration, delayMs])
  return pending && visibleGeneration === requestGeneration
}