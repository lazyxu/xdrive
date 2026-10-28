import { useCallback, useEffect, useRef, useState } from 'react'
import { useXDriveFileExplorerOwnerFence } from './FileExplorerOwnerFence'

export type XDriveFileExplorerOwnerActionToken = Readonly<{
  key: string
  generation: number
}>

/**
 * Host-neutral exclusive action lease for the Files workspace.
 *
 * Owner and Host identity are protected by the shared synchronous Owner fence.
 * Even if an old async callback resolves before passive cleanup, it cannot
 * complete or publish against a replacement account/Host. The generation
 * also retires stale preview tickets and upload/download callbacks.
 *
 * This is a UI lifecycle guard, not an authorization grant: the real Server,
 * DSM CGI and Agent remain responsible for per-request Owner/Root checks.
 */
export function useXDriveFileExplorerOwnerActionLifecycle<THost extends object>(
  host: THost, scopeKey: string,
) {
  const { isCurrent: isCurrentFilesOwner } = useXDriveFileExplorerOwnerFence(
    host, scopeKey,
  )
  const [actionBusy, setActionBusy] = useState('')
  const actionBusyRef = useRef<XDriveFileExplorerOwnerActionToken | null>(null)
  const actionGenerationRef = useRef(1)

  useEffect(() => {
    actionGenerationRef.current += 1
    actionBusyRef.current = null
    setActionBusy('')
    return () => {
      actionGenerationRef.current += 1
      actionBusyRef.current = null
    }
  }, [host, scopeKey])

  const beginActionBusy = useCallback((key: string) => {
    if (!isCurrentFilesOwner() || actionBusyRef.current) return null
    const token: XDriveFileExplorerOwnerActionToken = {
      key, generation: actionGenerationRef.current,
    }
    actionBusyRef.current = token
    setActionBusy(key)
    return token
  }, [isCurrentFilesOwner])

  const isActionBusyCurrent = useCallback((
    token: XDriveFileExplorerOwnerActionToken,
  ) => (
    token.generation === actionGenerationRef.current &&
    actionBusyRef.current === token &&
    isCurrentFilesOwner()
  ), [isCurrentFilesOwner])

  const finishActionBusy = useCallback((
    token: XDriveFileExplorerOwnerActionToken,
  ) => {
    if (!isActionBusyCurrent(token)) return
    actionBusyRef.current = null
    setActionBusy('')
  }, [isActionBusyCurrent])

  return {
    actionBusy, actionBusyRef, actionGenerationRef,
    isCurrentFilesOwner, beginActionBusy, isActionBusyCurrent, finishActionBusy,
  }
}
