import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuotaUsage } from '../models'
import type {
  XDriveCloudFilesCrumb,
  XDriveCloudFilesPort,
} from '../cloud-files'
import {
  XDRIVE_FILE_EXPLORER_PAGE_SIZE,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerPageSort,
} from '../file-explorer-controller'
import { useXDriveVirtualCollection } from './VirtualCollectionController'

export type XDriveCloudFilesVirtualDirectory<TNode extends { id: number }> = {
  itemCount: number
  loadedItems: ReadonlyMap<number, TNode>
  itemAt: (index: number) => TNode | undefined
  ensureViewport: (startIndex: number, endIndex: number) => Promise<void>
  collectRange: (startIndex: number, endIndex: number) => Promise<TNode[] | null>
}

type XDriveCloudFilesVirtualTarget<
  TSort extends XDriveFileExplorerPageSort,
> = {
  parentID: number
  sort: TSort
  requestID: number
}

export type XDriveCloudFilesControllerOptions<
  TNode extends { id: number },
  TQuota extends QuotaUsage,
  TSort extends XDriveFileExplorerPageSort,
> = {
  port: XDriveCloudFilesPort<TNode, TQuota, TSort>
  enabled: boolean
  defaultSort: TSort
  rootLabel?: string
  quotaRefreshIntervalMs?: number
  onError: (error: unknown) => void
}

function xDriveCloudFilesVirtualQueryKey<
  TSort extends XDriveFileExplorerPageSort,
>(
  target: XDriveCloudFilesVirtualTarget<TSort> | null,
) {
  if (!target) return 'cloud-files:virtual:disabled'
  return [
    'cloud-files:virtual',
    target.parentID,
    target.sort.key,
    target.sort.direction,
    target.requestID,
  ].join(':')
}

export function useXDriveCloudFilesController<
  TNode extends { id: number },
  TQuota extends QuotaUsage,
  TSort extends XDriveFileExplorerPageSort,
>({
  port,
  enabled,
  defaultSort,
  rootLabel = '我的文件',
  quotaRefreshIntervalMs = 60_000,
  onError,
}: XDriveCloudFilesControllerOptions<TNode, TQuota, TSort>) {
  const [quota, setQuota] = useState<TQuota | null>(null)
  const [items, setItems] = useState<TNode[]>([])
  const [crumbs, setCrumbs] = useState<XDriveCloudFilesCrumb[]>([])
  const [loading, setLoading] = useState(true)
  const [virtualTarget, setVirtualTarget] = useState<XDriveCloudFilesVirtualTarget<TSort> | null>(null)
  const directoryRequestRef = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const reportError = useCallback((error: unknown) => {
    onErrorRef.current(error)
  }, [])

  const current = crumbs.at(-1)
  const virtualQueryKey = xDriveCloudFilesVirtualQueryKey(virtualTarget)

  const loadVirtualRange = useCallback(async (
    range: { offset: number; limit: number },
  ) => {
    const target = virtualTarget
    if (!target) {
      return {
        items: [] as TNode[],
        offset: range.offset,
        limit: range.limit,
        totalCount: 0,
      }
    }
    const page = await port.getRange(
      target.parentID,
      range.offset,
      range.limit,
      target.sort,
    )
    return {
      items: page.items,
      offset: page.offset,
      limit: page.limit,
      totalCount: page.total_count,
    }
  }, [port, virtualTarget])

  const virtualCollection = useXDriveVirtualCollection<TNode>({
    queryKey: virtualQueryKey,
    loadRange: loadVirtualRange,
    onError: reportError,
  })

  const activateVirtualDirectory = useCallback((
    parentID: number,
    sort: TSort,
    requestID: number,
    firstRange: {
      items: readonly TNode[]
      total_count: number
      offset: number
      limit: number
    },
  ) => {
    const target = { parentID, sort, requestID }
    const nextKey = xDriveCloudFilesVirtualQueryKey(target)
    virtualCollection.reset(nextKey)
    virtualCollection.primePage({
      items: firstRange.items,
      totalCount: firstRange.total_count,
      offset: firstRange.offset,
      limit: firstRange.limit,
    })
    setVirtualTarget(target)
  }, [virtualCollection.primePage, virtualCollection.reset])

  const virtualDirectory = useMemo<XDriveCloudFilesVirtualDirectory<TNode> | null>(() => {
    if (!virtualTarget) return null
    return {
      itemCount: virtualCollection.totalCount ?? items.length,
      loadedItems: virtualCollection.loadedItems,
      itemAt: virtualCollection.itemAt,
      ensureViewport: virtualCollection.ensureViewport,
      collectRange: virtualCollection.collectRange,
    }
  }, [
    items.length,
    virtualCollection.collectRange,
    virtualCollection.ensureViewport,
    virtualCollection.itemAt,
    virtualCollection.loadedItems,
    virtualCollection.totalCount,
    virtualTarget,
  ])

  const applyQuota = useCallback((value: TQuota) => {
    setQuota(value)
  }, [])

  const refreshQuota = useCallback(async () => {
    try {
      setQuota(await port.getQuota())
    } catch (error) {
      reportError(error)
    }
  }, [port, reportError])

  const loadDirectory = useCallback(async (
    id: number,
    nextCrumbs?: readonly XDriveCloudFilesCrumb[],
    sort?: TSort,
  ) => {
    const effectiveSort = sort ?? virtualTarget?.sort ?? defaultSort
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    setLoading(true)
    try {
      const range = await port.getRange(
        id,
        0,
        XDRIVE_FILE_EXPLORER_PAGE_SIZE,
        effectiveSort,
      )
      if (requestID !== directoryRequestRef.current) return
      setItems([...range.items])
      if (nextCrumbs) setCrumbs([...nextCrumbs])
      activateVirtualDirectory(id, effectiveSort, requestID, range)
    } catch (error) {
      if (requestID === directoryRequestRef.current) reportError(error)
    } finally {
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [activateVirtualDirectory, defaultSort, port, reportError, virtualTarget?.sort])

  const loadInitial = useCallback(async () => {
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    setLoading(true)
    try {
      const [quotaValue, root] = await Promise.all([
        port.getQuota(),
        port.getRoot(),
      ])
      const range = await port.getRange(
        root.id,
        0,
        XDRIVE_FILE_EXPLORER_PAGE_SIZE,
        defaultSort,
      )
      if (requestID !== directoryRequestRef.current) return
      setQuota(quotaValue)
      setCrumbs([{ id: root.id, name: rootLabel }])
      setItems([...range.items])
      activateVirtualDirectory(root.id, defaultSort, requestID, range)
    } catch (error) {
      if (requestID === directoryRequestRef.current) reportError(error)
    } finally {
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [activateVirtualDirectory, defaultSort, port, reportError, rootLabel])

  useEffect(() => {
    if (!enabled) {
      directoryRequestRef.current += 1
      virtualCollection.reset('cloud-files:virtual:disabled')
      setVirtualTarget(null)
      setQuota(null)
      setItems([])
      setCrumbs([])
      setLoading(false)
      return
    }
    void loadInitial()
  }, [enabled, loadInitial, virtualCollection.reset])

  useEffect(() => {
    if (!enabled || quotaRefreshIntervalMs <= 0) return
    const timer = globalThis.setInterval(() => {
      void refreshQuota()
    }, quotaRefreshIntervalMs)
    return () => globalThis.clearInterval(timer)
  }, [enabled, quotaRefreshIntervalMs, refreshQuota])

  return {
    quota,
    items,
    crumbs,
    current,
    sort: virtualTarget?.sort ?? defaultSort,
    loading,
    virtualDirectory,
    applyQuota,
    refreshQuota,
    loadInitial,
    loadDirectory,
  }
}
