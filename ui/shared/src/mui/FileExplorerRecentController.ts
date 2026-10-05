import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  XDriveCloudFilesCrumb,
  XDriveFileRecentItem,
} from '../cloud-files'

export type XDriveFileExplorerRecentEntry = {
  id: number
  name: string
  kind: string
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  accessedAt: string
}

function projectRecentItem<TNode extends { id: number; name: string; type: string }>(
  item: XDriveFileRecentItem<TNode>,
): XDriveFileExplorerRecentEntry {
  return {
    id: item.node.id,
    name: item.node.name,
    kind: item.node.type,
    path: item.path,
    crumbs: item.crumbs.map((crumb) => ({ ...crumb })),
    accessedAt: item.accessed_at,
  }
}

export function useXDriveFileExplorerRecent<
  TNode extends { id: number; name: string; type: string },
>({
  enabled = true,
  loadItems,
  touchItem,
  clearItems,
}: {
  enabled?: boolean
  loadItems: () => Promise<XDriveFileRecentItem<TNode>[]>
  touchItem: (nodeID: number) => Promise<XDriveFileRecentItem<TNode>>
  clearItems: () => Promise<unknown>
}) {
  const [items, setItems] = useState<XDriveFileExplorerRecentEntry[]>([])
  const [loading, setLoading] = useState(false)
  const loadItemsRef = useRef(loadItems)
  const touchItemRef = useRef(touchItem)
  const clearItemsRef = useRef(clearItems)
  const rawItemsRef = useRef(new Map<number, XDriveFileRecentItem<TNode>>())

  loadItemsRef.current = loadItems
  touchItemRef.current = touchItem
  clearItemsRef.current = clearItems

  const loadFresh = useCallback(async () => {
    const raw = await loadItemsRef.current()
    rawItemsRef.current = new Map(raw.map((item) => [item.node.id, item]))
    const next = raw.map(projectRecentItem)
    setItems(next)
    return raw
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) {
      rawItemsRef.current.clear()
      setItems([])
      return []
    }
    setLoading(true)
    try {
      return await loadFresh()
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }, [enabled, loadFresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const record = useCallback(async (nodeID: number) => {
    if (!enabled || nodeID <= 0) return false
    try {
      const raw = await touchItemRef.current(nodeID)
      rawItemsRef.current.set(nodeID, raw)
      const projected = projectRecentItem(raw)
      setItems((current) => [
        projected,
        ...current.filter((item) => item.id !== nodeID),
      ].slice(0, 16))
      return true
    } catch {
      return false
    }
  }, [enabled])

  const clear = useCallback(async () => {
    if (!enabled) return false
    try {
      await clearItemsRef.current()
      rawItemsRef.current.clear()
      setItems([])
      return true
    } catch {
      return false
    }
  }, [enabled])

  const activate = useCallback(async (
    nodeID: number,
    handlers: {
      onDirectory: (crumbs: XDriveCloudFilesCrumb[]) => void | Promise<void>
      onFile: (item: XDriveFileRecentItem<TNode>) => void | Promise<void>
    },
  ) => {
    if (!enabled || nodeID <= 0) return false
    setLoading(true)
    try {
      const latest = await loadFresh()
      const target = latest.find((item) => item.node.id === nodeID)
      if (!target) return false
      if (target.node.type === 'dir') {
        await handlers.onDirectory(target.crumbs)
      } else {
        await handlers.onFile(target)
        await record(nodeID)
      }
      return true
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [enabled, loadFresh, record])

  return {
    items,
    loading,
    refresh,
    record,
    clear,
    activate,
  }
}
