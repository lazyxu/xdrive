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
  const loadRequestRef = useRef(0)
  const mutationTailRef = useRef<Promise<unknown>>(Promise.resolve())

  loadItemsRef.current = loadItems
  touchItemRef.current = touchItem
  clearItemsRef.current = clearItems

  const loadFresh = useCallback(async (requestID: number) => {
    const raw = await loadItemsRef.current()
    if (requestID === loadRequestRef.current) {
      rawItemsRef.current = new Map(raw.map((item) => [item.node.id, item]))
      setItems(raw.map(projectRecentItem))
    }
    return raw
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) {
      loadRequestRef.current += 1
      rawItemsRef.current.clear()
      setItems([])
      setLoading(false)
      return []
    }
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      return await loadFresh(requestID)
    } catch {
      return []
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [enabled, loadFresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>) => {
    const result = mutationTailRef.current.then(operation, operation)
    mutationTailRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  const record = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(async () => {
      try {
        const raw = await touchItemRef.current(nodeID)
        loadRequestRef.current += 1
        setLoading(false)
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
    })
  }, [enabled, enqueueMutation])

  const clear = useCallback(() => {
    if (!enabled) return Promise.resolve(false)
    return enqueueMutation(async () => {
      try {
        await clearItemsRef.current()
        loadRequestRef.current += 1
        setLoading(false)
        rawItemsRef.current.clear()
        setItems([])
        return true
      } catch {
        return false
      }
    })
  }, [enabled, enqueueMutation])

  const activate = useCallback(async (
    nodeID: number,
    handlers: {
      onDirectory: (crumbs: XDriveCloudFilesCrumb[]) => void | Promise<void>
      onFile: (item: XDriveFileRecentItem<TNode>) => void | Promise<void>
    },
  ) => {
    if (!enabled || nodeID <= 0) return false
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      const latest = await loadFresh(requestID)
      if (requestID !== loadRequestRef.current) return false
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
      if (requestID === loadRequestRef.current) setLoading(false)
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
