import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Shared Files Owner/request lifecycle across Desktop and DSM Hosts.
 *
 * Session identity is the concrete Host transport, authenticated Owner scope
 * and revalidation revision. A stale callback must never publish into a new
 * Owner/page, including during render before passive effects run.
 *
 * This is a UI freshness fence, NOT authorization. Every request must still
 * independently authorize the real Server/Agent Owner and Root.
 */
export function useXDriveFileExplorerOwnerFence<THost extends object>(
  host: THost,
  scopeKey: string,
  revision = 0,
) {
  const ownerRef = useRef({ host, scopeKey, revision })
  if (ownerRef.current.host !== host ||
      ownerRef.current.scopeKey !== scopeKey ||
      ownerRef.current.revision !== revision) {
    ownerRef.current = { host, scopeKey, revision }
  }
  const owner = ownerRef.current
  const mountedRef = useRef<typeof owner | null>(owner)

  useLayoutEffect(() => {
    mountedRef.current = owner
    return () => {
      if (mountedRef.current === owner) mountedRef.current = null
    }
  }, [owner])

  const isCurrent = useCallback(
    () => ownerRef.current === owner && mountedRef.current === owner,
    [owner],
  )
  // Invalidate before manual reauthentication or browser resume. An old
  // callback cannot revoke a newer Owner.
  const invalidate = useCallback(() => {
    if (ownerRef.current === owner && mountedRef.current === owner) {
      mountedRef.current = null
    }
  }, [owner])

  return { isCurrent, invalidate }
}
