import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  XDriveCloudFilesCrumb,
  XDriveFileQuickAccessItem,
} from '../cloud-files'

export type XDriveFileExplorerQuickAccessEntry = {
  id: number
  name: string
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  position: number
  pinnedAt: string
}

function rollbackQuickAccessOrder(
  current: XDriveFileExplorerQuickAccessEntry[],
  previous: XDriveFileExplorerQuickAccessEntry[],
) {
  const currentByID = new Map(current.map((item) => [item.id, item]))
  const restoredIDs = new Set<number>()
  const next = previous.flatMap((item) => {
    const latest = currentByID.get(item.id)
    // A re-created pin owns its new Server position, even for the same folder.
    if (!latest || latest.pinnedAt !== item.pinnedAt) return []
    restoredIDs.add(item.id)
    return [{ ...latest, position: item.position }]
  })
  for (const item of current) {
    if (!restoredIDs.has(item.id)) next.push(item)
  }
  return next
}

function projectQuickAccessItem<TNode extends { id: number; name: string }>(
  item: XDriveFileQuickAccessItem<TNode>,
): XDriveFileExplorerQuickAccessEntry {
  return {
    id: item.node.id,
    name: item.node.name,
    path: item.path,
    crumbs: item.crumbs.map((crumb) => ({ ...crumb })),
    position: item.position ?? 0,
    pinnedAt: item.pinned_at,
  }
}

export function useXDriveFileExplorerQuickAccess<
  TNode extends { id: number; name: string },
>({
  lifecycleKey = '',
  enabled = true,
  loadItems,
  pinItem,
  unpinItem,
  reorderItems,
  onError,
}: {
  lifecycleKey?: string
  enabled?: boolean
  loadItems: () => Promise<XDriveFileQuickAccessItem<TNode>[]>
  pinItem: (nodeID: number) => Promise<XDriveFileQuickAccessItem<TNode>>
  unpinItem: (nodeID: number) => Promise<unknown>
  reorderItems?: (nodeIDs: number[]) => Promise<unknown>
  onError: (error: unknown) => void
}) {
  const [items, setItems] = useState<XDriveFileExplorerQuickAccessEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busyID, setBusyID] = useState<number | null>(null)
  const loadItemsRef = useRef(loadItems)
  const pinItemRef = useRef(pinItem)
  const unpinItemRef = useRef(unpinItem)
  const reorderItemsRef = useRef(reorderItems)
  const onErrorRef = useRef(onError)
  const loadRequestRef = useRef(0)
  const mutationTailRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingMutationCountRef = useRef(0)
  const pendingMutationRef = useRef(new Map<string, {
    generation: number
    promise: Promise<boolean>
  }>())
  const enabledRef = useRef(enabled)
  const lifecycleKeyRef = useRef(lifecycleKey)
  // Render-phase ownership is separate from the request generation: clearing
  // old session items in a passive effect is too late for the first frame.
  const visibleScopeRef = useRef({ lifecycleKey, enabled })
  const lifecycleGenerationRef = useRef(1)
  const reorderGenerationRef = useRef(0)

  if (
    enabledRef.current !== enabled ||
    lifecycleKeyRef.current !== lifecycleKey
  ) {
    enabledRef.current = enabled
    lifecycleKeyRef.current = lifecycleKey
    loadRequestRef.current += 1
    lifecycleGenerationRef.current += 1
    reorderGenerationRef.current += 1
    mutationTailRef.current = Promise.resolve()
    pendingMutationCountRef.current = 0
    pendingMutationRef.current.clear()
  }

  loadItemsRef.current = loadItems
  pinItemRef.current = pinItem
  unpinItemRef.current = unpinItem
  reorderItemsRef.current = reorderItems
  onErrorRef.current = onError

  const loadFresh = useCallback(async (requestID: number) => {
    const reorderGeneration = reorderGenerationRef.current
    const next = (await loadItemsRef.current()).map(projectQuickAccessItem)
    if (
      requestID === loadRequestRef.current &&
      reorderGeneration === reorderGenerationRef.current
    ) setItems(next)
    return next
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) {
      loadRequestRef.current += 1
      setItems([])
      setLoading(false)
      setBusyID(null)
      return []
    }
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      return await loadFresh(requestID)
    } catch (error) {
      if (requestID === loadRequestRef.current) onErrorRef.current(error)
      return []
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [enabled, lifecycleKey, loadFresh])

  useEffect(() => {
    visibleScopeRef.current = { lifecycleKey, enabled }
    setItems([])
    setLoading(false)
    setBusyID(null)
    void refresh()
  }, [lifecycleKey, refresh])

  useEffect(() => () => {
    loadRequestRef.current += 1
    lifecycleGenerationRef.current += 1
    reorderGenerationRef.current += 1
    mutationTailRef.current = Promise.resolve()
    pendingMutationCountRef.current = 0
    pendingMutationRef.current.clear()
  }, [])

  const scopeVisible = enabled && visibleScopeRef.current.lifecycleKey === lifecycleKey &&
    visibleScopeRef.current.enabled === enabled
  const visibleItems = scopeVisible ? items : []
  const pinnedIDs = useMemo(
    () => new Set(visibleItems.map((item) => item.id)),
    [visibleItems],
  )

  const enqueueMutation = useCallback((
    mutationKey: string,
    nodeID: number,
    operation: (generation: number) => Promise<boolean>,
  ) => {
    const generation = lifecycleGenerationRef.current
    const pending = pendingMutationRef.current.get(mutationKey)
    if (pending?.generation === generation) return pending.promise
    loadRequestRef.current += 1
    setLoading(false)
    pendingMutationCountRef.current += 1
    if (pendingMutationCountRef.current === 1) setBusyID(nodeID)

    const run = async () => {
      if (
        generation !== lifecycleGenerationRef.current ||
        !enabledRef.current
      ) return false
      setBusyID(nodeID)
      return operation(generation)
    }
    const queued = mutationTailRef.current.then(run, run)
    const holder = {
      generation,
      promise: Promise.resolve(false) as Promise<boolean>,
    }
    const tracked = queued.finally(() => {
      if (pendingMutationRef.current.get(mutationKey) === holder) {
        pendingMutationRef.current.delete(mutationKey)
      }
      if (generation !== lifecycleGenerationRef.current) return
      pendingMutationCountRef.current = Math.max(
        0,
        pendingMutationCountRef.current - 1,
      )
      if (pendingMutationCountRef.current === 0) setBusyID(null)
    })
    holder.promise = tracked
    pendingMutationRef.current.set(mutationKey, holder)
    mutationTailRef.current = tracked.then(
      () => undefined,
      () => undefined,
    )
    return tracked
  }, [])

  const pin = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(`pin:${nodeID}`, nodeID, async (generation) => {
      try {
        const pinned = projectQuickAccessItem(await pinItemRef.current(nodeID))
        if (
          generation !== lifecycleGenerationRef.current ||
          !enabledRef.current
        ) return true
        // A lookup started during the mutation may return an older server
        // snapshot after this write succeeds. Give the write ownership.
        loadRequestRef.current += 1
        setLoading(false)
        setItems((current) => (
          current.some((item) => item.id === pinned.id)
            ? current.map((item) => item.id === pinned.id ? pinned : item)
            : [...current, pinned]
        ))
        return true
      } catch (error) {
        if (
          generation === lifecycleGenerationRef.current &&
          enabledRef.current
        ) onErrorRef.current(error)
        return false
      }
    })
  }, [enabled, enqueueMutation])

  const unpin = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(`unpin:${nodeID}`, nodeID, async (generation) => {
      try {
        await unpinItemRef.current(nodeID)
        if (
          generation !== lifecycleGenerationRef.current ||
          !enabledRef.current
        ) return true
        loadRequestRef.current += 1
        setLoading(false)
        setItems((current) => current.filter((item) => item.id !== nodeID))
        return true
      } catch (error) {
        if (
          generation === lifecycleGenerationRef.current &&
          enabledRef.current
        ) onErrorRef.current(error)
        return false
      }
    })
  }, [enabled, enqueueMutation])

  const toggle = useCallback(
    (nodeID: number) => pinnedIDs.has(nodeID) ? unpin(nodeID) : pin(nodeID),
    [pin, pinnedIDs, unpin],
  )

  const reorder = useCallback(async (nodeIDs: number[]) => {
    if (!enabled || !reorderItemsRef.current) return false
    const generation = lifecycleGenerationRef.current
    const reorderGeneration = reorderGenerationRef.current + 1
    reorderGenerationRef.current = reorderGeneration
    const previous = items
    const position = new Map(nodeIDs.map((id, index) => [id, index]))
    setItems((current) => [...current].sort(
      (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    ).map((item, index) => ({ ...item, position: index })))
    try {
      await reorderItemsRef.current(nodeIDs)
      return true
    } catch (error) {
      if (
        generation !== lifecycleGenerationRef.current ||
        reorderGeneration !== reorderGenerationRef.current ||
        !enabledRef.current
      ) return false
      setItems((current) => rollbackQuickAccessOrder(current, previous))
      onErrorRef.current(error)
      return false
    }
  }, [enabled, items])

  const navigate = useCallback(async (
    nodeID: number,
    onNavigate: (crumbs: XDriveCloudFilesCrumb[]) => void | Promise<void>,
  ) => {
    if (!enabled || nodeID <= 0) return false
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      const latest = await loadFresh(requestID)
      if (requestID !== loadRequestRef.current) return false
      const target = latest.find((item) => item.id === nodeID)
      if (!target) return false
      await onNavigate(target.crumbs)
      return true
    } catch (error) {
      if (requestID === loadRequestRef.current) onErrorRef.current(error)
      return false
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [enabled, loadFresh])

  return {
    items: visibleItems,
    loading: scopeVisible ? loading : enabled,
    busyID: scopeVisible ? busyID : null,
    pinnedIDs,
    refresh,
    pin,
    unpin,
    toggle,
    reorder,
    navigate,
  }
}
