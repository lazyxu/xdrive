import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { XDriveCloudFilesCrumb, XDriveFileFavoriteItem } from '../cloud-files'

type FavoriteNodeShape = {
  id: number
  name: string
  size?: number
  revision?: number
  updated_at?: string
}

export type XDriveFileExplorerFavoriteNavigationEntry = {
  id: number
  name: string
  path: string
  size?: number
  revision?: number
  updatedAt?: string
  favoritedAt: string
}

export type XDriveFileExplorerFavoriteEntry<TNode extends FavoriteNodeShape> =
  XDriveFileExplorerFavoriteNavigationEntry & {
    node: TNode
    crumbs: XDriveCloudFilesCrumb[]
  }

function projectFavoriteItem<TNode extends FavoriteNodeShape>(
  item: XDriveFileFavoriteItem<TNode>,
): XDriveFileExplorerFavoriteEntry<TNode> {
  return {
    id: item.node.id,
    name: item.node.name,
    path: item.path,
    size: item.node.size,
    revision: item.node.revision,
    updatedAt: item.node.updated_at,
    favoritedAt: item.favorited_at,
    node: item.node,
    crumbs: item.crumbs.map((crumb) => ({ ...crumb })),
  }
}

export function useXDriveFileExplorerFavorites<TNode extends FavoriteNodeShape>({
  lifecycleKey = '',
  enabled = true,
  loadItems,
  favoriteItem,
  unfavoriteItem,
  onError,
}: {
  lifecycleKey?: string
  enabled?: boolean
  loadItems: () => Promise<XDriveFileFavoriteItem<TNode>[]>
  favoriteItem: (nodeID: number) => Promise<XDriveFileFavoriteItem<TNode>>
  unfavoriteItem: (nodeID: number) => Promise<unknown>
  onError: (error: unknown) => void
}) {
  const [items, setItems] = useState<XDriveFileExplorerFavoriteEntry<TNode>[]>([])
  const [loading, setLoading] = useState(false)
  const [busyID, setBusyID] = useState<number | null>(null)
  const loadItemsRef = useRef(loadItems)
  const favoriteItemRef = useRef(favoriteItem)
  const unfavoriteItemRef = useRef(unfavoriteItem)
  const onErrorRef = useRef(onError)
  const loadRequestRef = useRef(0)
  const mutationTailRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingMutationCountRef = useRef(0)
  const enabledRef = useRef(enabled)
  const lifecycleKeyRef = useRef(lifecycleKey)
  const lifecycleGenerationRef = useRef(1)

  if (
    enabledRef.current !== enabled ||
    lifecycleKeyRef.current !== lifecycleKey
  ) {
    enabledRef.current = enabled
    lifecycleKeyRef.current = lifecycleKey
    loadRequestRef.current += 1
    lifecycleGenerationRef.current += 1
    mutationTailRef.current = Promise.resolve()
    pendingMutationCountRef.current = 0
  }

  loadItemsRef.current = loadItems
  favoriteItemRef.current = favoriteItem
  unfavoriteItemRef.current = unfavoriteItem
  onErrorRef.current = onError

  const loadFresh = useCallback(async (requestID: number) => {
    const next = (await loadItemsRef.current()).map(projectFavoriteItem)
    if (requestID === loadRequestRef.current) setItems(next)
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
    setItems([])
    setLoading(false)
    setBusyID(null)
    void refresh()
  }, [lifecycleKey, refresh])

  useEffect(() => () => {
    loadRequestRef.current += 1
    lifecycleGenerationRef.current += 1
    mutationTailRef.current = Promise.resolve()
    pendingMutationCountRef.current = 0
  }, [])

  const favoriteIDs = useMemo(() => new Set(items.map((item) => item.id)), [items])

  const enqueueMutation = useCallback((
    nodeID: number,
    operation: (generation: number) => Promise<boolean>,
  ) => {
    const generation = lifecycleGenerationRef.current
    loadRequestRef.current += 1
    setLoading(false)
    pendingMutationCountRef.current += 1
    if (pendingMutationCountRef.current === 1) setBusyID(nodeID)

    const run = async () => {
      if (generation !== lifecycleGenerationRef.current || !enabledRef.current) return false
      setBusyID(nodeID)
      return operation(generation)
    }
    const queued = mutationTailRef.current.then(run, run)
    const tracked = queued.finally(() => {
      if (generation !== lifecycleGenerationRef.current) return
      pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1)
      if (pendingMutationCountRef.current === 0) setBusyID(null)
    })
    mutationTailRef.current = tracked.then(() => undefined, () => undefined)
    return tracked
  }, [])

  const favorite = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(nodeID, async (generation) => {
      try {
        const next = projectFavoriteItem(await favoriteItemRef.current(nodeID))
        if (generation !== lifecycleGenerationRef.current || !enabledRef.current) return true
        setItems((current) => (
          current.some((item) => item.id === next.id)
            ? current.map((item) => item.id === next.id ? next : item)
            : [...current, next]
        ))
        return true
      } catch (error) {
        if (generation === lifecycleGenerationRef.current && enabledRef.current) onErrorRef.current(error)
        return false
      }
    })
  }, [enabled, enqueueMutation])

  const unfavorite = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(nodeID, async (generation) => {
      try {
        await unfavoriteItemRef.current(nodeID)
        if (generation !== lifecycleGenerationRef.current || !enabledRef.current) return true
        setItems((current) => current.filter((item) => item.id !== nodeID))
        return true
      } catch (error) {
        if (generation === lifecycleGenerationRef.current && enabledRef.current) onErrorRef.current(error)
        return false
      }
    })
  }, [enabled, enqueueMutation])

  const toggle = useCallback(
    (nodeID: number) => favoriteIDs.has(nodeID) ? unfavorite(nodeID) : favorite(nodeID),
    [favorite, favoriteIDs, unfavorite],
  )

  const activate = useCallback(async (
    nodeID: number,
    onActivate: (node: TNode, crumbs: XDriveCloudFilesCrumb[]) => void | Promise<void>,
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
      await onActivate(target.node, target.crumbs)
      return true
    } catch (error) {
      if (requestID === loadRequestRef.current) onErrorRef.current(error)
      return false
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [enabled, loadFresh])

  return { items, loading, busyID, favoriteIDs, refresh, favorite, unfavorite, toggle, activate }
}
