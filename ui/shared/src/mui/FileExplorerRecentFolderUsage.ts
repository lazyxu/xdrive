import { useCallback, useEffect, useRef } from 'react'

// A navigation receipt is not a working-folder access. Only the last folder
// that remains visible for 5 seconds is confirmed; a real file operation may
// confirm its containing folder immediately.
export function xDriveCreateRecentFolderScheduler({
  record,
  canRecord = () => true,
  delayMs = 5000,
  deduplicateMs = 60_000,
  now = () => Date.now(),
  arm = (callback: () => void, ms: number) => setTimeout(callback, ms),
  disarm = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}: {
  record: (nodeID: number) => Promise<boolean> | boolean
  canRecord?: () => boolean
  delayMs?: number
  deduplicateMs?: number
  now?: () => number
  arm?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  disarm?: (timer: ReturnType<typeof setTimeout>) => void
}) {
  let pending: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let last: { id: number; timestamp: number } | null = null
  let inFlight: { id: number; promise: Promise<boolean> } | null = null

  const cancel = () => {
    if (pending !== null) disarm(pending)
    pending = null
  }

  const confirm = (id: number): Promise<boolean> => {
    cancel()
    if (!Number.isSafeInteger(id) || id <= 0 || !canRecord()) return Promise.resolve(false)
    if (last?.id === id && now() - last.timestamp < deduplicateMs) return Promise.resolve(true)
    if (inFlight?.id === id) return inFlight.promise
    const ticket = generation
    const operation = Promise.resolve().then(() => {
      // A queued microtask must not cross an Owner/Server lifecycle reset.
      // Guard before invoking the adapter: recordRef may now point to another
      // account. Previous generations are not authorized to submit writes.
      if (ticket !== generation || !canRecord()) return false
      return record(id)
    }).then(
      (accepted) => {
        if (accepted && ticket === generation) last = { id, timestamp: now() }
        return accepted
      },
      () => false,
    )
    inFlight = { id, promise: operation }
    void operation.finally(() => {
      if (inFlight?.promise === operation) inFlight = null
    })
    return operation
  }

  const consider = (id: number) => {
    cancel()
    if (!Number.isSafeInteger(id) || id <= 0 || !canRecord()) return
    const ticket = generation
    pending = arm(() => {
      pending = null
      if (ticket === generation && canRecord()) void confirm(id)
    }, delayMs)
  }

  const reset = () => {
    cancel()
    generation += 1
    inFlight = null
    last = null
  }
  return { consider, confirm, cancel, reset }
}

export function useXDriveFileExplorerRecentFolderUsage({
  lifecycleKey,
  enabled = true,
  record,
}: {
  lifecycleKey: string
  enabled?: boolean
  record: (folderID: number) => Promise<boolean>
}) {
  const recordRef = useRef(record)
  recordRef.current = record
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const scopeRef = useRef<{ key: string; enabled: boolean; scheduler: ReturnType<typeof xDriveCreateRecentFolderScheduler> } | null>(null)
  if (!scopeRef.current) {
    scopeRef.current = {
      key: lifecycleKey, enabled,
      scheduler: xDriveCreateRecentFolderScheduler({
        record: (id) => recordRef.current(id),
        canRecord: () => enabledRef.current && (typeof document === 'undefined' || !document.hidden),
      }),
    }
  } else if (scopeRef.current.key !== lifecycleKey || scopeRef.current.enabled !== enabled) {
    // Fence the old account synchronously, before a passive effect can run.
    scopeRef.current.scheduler.reset()
    scopeRef.current.key = lifecycleKey
    scopeRef.current.enabled = enabled
  }

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onHidden = () => {
      if (document.hidden) scopeRef.current?.scheduler.cancel()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [])

  useEffect(() => () => { scopeRef.current?.scheduler.reset() }, [])

  const consider = useCallback((id: number) => scopeRef.current?.scheduler.consider(id), [])
  const confirm = useCallback((id: number) =>
    scopeRef.current?.scheduler.confirm(id) ?? Promise.resolve(false), [])
  const cancel = useCallback(() => scopeRef.current?.scheduler.cancel(), [])
  return { consider, confirm, cancel }
}
