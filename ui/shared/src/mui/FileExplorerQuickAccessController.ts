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
  pinnedAt: string
}

function projectQuickAccessItem<TNode extends { id: number; name: string }>(
  item: XDriveFileQuickAccessItem<TNode>,
): XDriveFileExplorerQuickAccessEntry {
  return {
    id: item.node.id,
    name: item.node.name,
    path: item.path,
    crumbs: item.crumbs.map((crumb) => ({ ...crumb })),
    pinnedAt: item.pinned_at,
  }
}

export function useXDriveFileExplorerQuickAccess<
  TNode extends { id: number; name: string },
>({
  enabled = true,
  loadItems,
  pinItem,
  unpinItem,
  onError,
}: {
  enabled?: boolean
  loadItems: () => Promise<XDriveFileQuickAccessItem<TNode>[]>
  pinItem: (nodeID: number) => Promise<XDriveFileQuickAccessItem<TNode>>
  unpinItem: (nodeID: number) => Promise<unknown>
  onError: (error: unknown) => void
}) {
  const [items, setItems] = useState<XDriveFileExplorerQuickAccessEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busyID, setBusyID] = useState<number | null>(null)
  const loadItemsRef = useRef(loadItems)
  const pinItemRef = useRef(pinItem)
  const unpinItemRef = useRef(unpinItem)
  const onErrorRef = useRef(onError)

  loadItemsRef.current = loadItems
  pinItemRef.current = pinItem
  unpinItemRef.current = unpinItem
  onErrorRef.current = onError

  const loadFresh = useCallback(async () => {
    const next = (await loadItemsRef.current()).map(projectQuickAccessItem)
    setItems(next)
    return next
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([])
      return []
    }
    setLoading(true)
    try {
      return await loadFresh()
    } catch (error) {
      onErrorRef.current(error)
      return []
    } finally {
      setLoading(false)
    }
  }, [enabled, loadFresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pinnedIDs = useMemo(
    () => new Set(items.map((item) => item.id)),
    [items],
  )

  const pin = useCallback(async (nodeID: number) => {
    if (!enabled || busyID !== null || nodeID <= 0) return false
    setBusyID(nodeID)
    try {
      const pinned = projectQuickAccessItem(await pinItemRef.current(nodeID))
      setItems((current) => (
        current.some((item) => item.id === pinned.id)
          ? current.map((item) => item.id === pinned.id ? pinned : item)
          : [...current, pinned]
      ))
      return true
    } catch (error) {
      onErrorRef.current(error)
      return false
    } finally {
      setBusyID(null)
    }
  }, [busyID, enabled])

  const unpin = useCallback(async (nodeID: number) => {
    if (!enabled || busyID !== null || nodeID <= 0) return false
    setBusyID(nodeID)
    try {
      await unpinItemRef.current(nodeID)
      setItems((current) => current.filter((item) => item.id !== nodeID))
      return true
    } catch (error) {
      onErrorRef.current(error)
      return false
    } finally {
      setBusyID(null)
    }
  }, [busyID, enabled])

  const toggle = useCallback(
    (nodeID: number) => pinnedIDs.has(nodeID) ? unpin(nodeID) : pin(nodeID),
    [pin, pinnedIDs, unpin],
  )

  const navigate = useCallback(async (
    nodeID: number,
    onNavigate: (crumbs: XDriveCloudFilesCrumb[]) => void | Promise<void>,
  ) => {
    if (!enabled || nodeID <= 0) return false
    setLoading(true)
    try {
      const latest = await loadFresh()
      const target = latest.find((item) => item.id === nodeID)
      if (!target) return false
      await onNavigate(target.crumbs)
      return true
    } catch (error) {
      onErrorRef.current(error)
      return false
    } finally {
      setLoading(false)
    }
  }, [enabled, loadFresh])

  return {
    items,
    loading,
    busyID,
    pinnedIDs,
    refresh,
    pin,
    unpin,
    toggle,
    navigate,
  }
}
