import { useCallback, useRef, useState } from 'react'

/** Read-only, current-Owner request to reveal one verified child in Files. */
export type XDriveFileExplorerLocalRevealTarget = Readonly<{
  parentID: number
  nodeID: number
  requestID: string
}>

type RevealOwner = Readonly<{
  lifecycleKey: string
  requestPrefix: 'local' | 'desktop-local'
  externalKey: string
}>

/**
 * One shared show-in-folder local reveal lifecycle for Web/PWA and Desktop.
 *
 * Each Owner/Host route change gets a NEW render-time identity, even when
 * navigation is A -> B -> A. Late callbacks from any retired identity are
 * rejected before they publish a target. An external deep link immediately
 * supersedes a prior in-app reveal without setting state during render.
 *
 * This only emits a UI request: FileExplorer still verifies the real child
 * Node/revision/position with its current authenticated Host Range. There is
 * no native IPC, network fallback, persisted path or mutation here.
 */
export function useXDriveFileExplorerLocalReveal({
  lifecycleKey,
  requestPrefix,
  externalKey = '',
}: {
  lifecycleKey: string
  requestPrefix: RevealOwner['requestPrefix']
  externalKey?: string
}) {
  const ownerRef = useRef<RevealOwner>({ lifecycleKey, requestPrefix, externalKey })
  if (ownerRef.current.lifecycleKey !== lifecycleKey ||
      ownerRef.current.requestPrefix !== requestPrefix ||
      ownerRef.current.externalKey !== externalKey) {
    ownerRef.current = { lifecycleKey, requestPrefix, externalKey }
  }
  const owner = ownerRef.current
  const sequenceRef = useRef(0)
  const [held, setHeld] = useState<{
    owner: RevealOwner
    target: XDriveFileExplorerLocalRevealTarget
  } | null>(null)

  const requestReveal = useCallback((parentID: number, nodeID: number): boolean => {
    if (ownerRef.current !== owner ||
        !Number.isSafeInteger(parentID) || parentID <= 0 ||
        !Number.isSafeInteger(nodeID) || nodeID <= 0) return false
    const nextSequence = ++sequenceRef.current
    setHeld({
      owner,
      target: {
        parentID, nodeID,
        requestID: `${requestPrefix}:${lifecycleKey}:${nextSequence}`,
      },
    })
    return true
  }, [owner, lifecycleKey, requestPrefix])

  const clearLocalReveal = useCallback(() => setHeld(null), [])
  const localRevealTarget = held?.owner === owner ? held.target : null
  return { localRevealTarget, requestReveal, clearLocalReveal }
}
