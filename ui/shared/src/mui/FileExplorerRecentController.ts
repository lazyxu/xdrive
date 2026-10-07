import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  XDriveCloudFilesCrumb,
  XDriveFileRecentItem,
} from '../cloud-files'

export type XDriveFileExplorerRecentEntry = {
  id: number
  name: string
  kind: 'dir' | 'file'
  size?: number
  revision?: string | number
  updatedAt?: string
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  accessedAt: string
}

function projectRecentItem<TNode extends {
  id: number
  name: string
  type: string
  size?: number
  revision?: string | number
  updated_at?: string
}>(
  item: XDriveFileRecentItem<TNode>,
): XDriveFileExplorerRecentEntry {
  return {
    id: item.node.id,
    name: item.node.name,
    kind: item.node.type === 'dir' ? 'dir' : 'file',
    size: item.node.size,
    revision: item.node.revision,
    updatedAt: item.node.updated_at,
    path: item.path,
    crumbs: item.crumbs.map((crumb) => ({ ...crumb })),
    accessedAt: item.accessed_at,
  }
}

export function useXDriveFileExplorerRecent<
  TNode extends {
    id: number
    name: string
    type: string
    size?: number
    revision?: string | number
    updated_at?: string
  },
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
  const enabledRef = useRef(enabled)
  const lifecycleGenerationRef = useRef(1)

  if (enabledRef.current !== enabled) {
    enabledRef.current = enabled
    lifecycleGenerationRef.current += 1
  }

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

  useEffect(() => () => {
    loadRequestRef.current += 1
    lifecycleGenerationRef.current += 1
  }, [])

  const enqueueMutation = useCallback((
    operation: (generation: number) => Promise<boolean>,
  ) => {
    const generation = lifecycleGenerationRef.current
    const run = () => {
      if (
        generation !== lifecycleGenerationRef.current ||
        !enabledRef.current
      ) return Promise.resolve(false)
      return operation(generation)
    }
    const result = mutationTailRef.current.then(run, run)
    mutationTailRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  const record = useCallback((nodeID: number) => {
    if (!enabled || nodeID <= 0) return Promise.resolve(false)
    return enqueueMutation(async (generation) => {
      try {
        const raw = await touchItemRef.current(nodeID)
        if (
          generation !== lifecycleGenerationRef.current ||
          !enabledRef.current
        ) return true
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
    return enqueueMutation(async (generation) => {
      try {
        await clearItemsRef.current()
        if (
          generation !== lifecycleGenerationRef.current ||
          !enabledRef.current
        ) return true
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
      onDirectory: (
        crumbs: XDriveCloudFilesCrumb[],
      ) => boolean | void | Promise<boolean | void>
      onFile: (
        item: XDriveFileRecentItem<TNode>,
      ) => boolean | void | Promise<boolean | void>
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
        const activated = await handlers.onDirectory(target.crumbs)
        if (activated === false) return false
      } else {
        const activated = await handlers.onFile(target)
        if (activated === false) return false
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
