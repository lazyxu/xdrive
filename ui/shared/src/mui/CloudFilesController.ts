import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuotaUsage } from '../models'
import type {
  XDriveCloudFilesCrumb,
  XDriveCloudFilesPort,
} from '../cloud-files'
import {
  xDriveFileExplorerCanLoadMore,
  xDriveFileExplorerDirectoryPageTransition,
  xDriveFileExplorerPageRequestOptions,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerPageSort,
  XDriveFileExplorerPageState,
} from '../file-explorer-controller'

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
  const [pageState, setPageState] = useState<XDriveFileExplorerPageState<TSort> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const directoryRequestRef = useRef(0)
  const loadMoreRequestRef = useRef(false)
  const directoryItemIDsRef = useRef(new Set<number>())

  const current = crumbs.at(-1)

  const applyQuota = useCallback((value: TQuota) => {
    setQuota(value)
  }, [])

  const refreshQuota = useCallback(async () => {
    try {
      setQuota(await port.getQuota())
    } catch (error) {
      onError(error)
    }
  }, [onError, port])

  const loadDirectory = useCallback(async (
    id: number,
    nextCrumbs?: readonly XDriveCloudFilesCrumb[],
    sort?: TSort,
  ) => {
    const effectiveSort = sort ?? pageState?.sort ?? defaultSort
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    loadMoreRequestRef.current = false
    setLoadingMore(false)
    setLoading(true)
    try {
      const page = await port.getPage(
        id,
        xDriveFileExplorerPageRequestOptions(effectiveSort),
      )
      if (requestID !== directoryRequestRef.current) return
      const transition = xDriveFileExplorerDirectoryPageTransition(
        id,
        page,
        effectiveSort,
        false,
        directoryItemIDsRef.current,
      )
      setItems(transition.applyItems)
      setPageState(transition.pageState)
      if (nextCrumbs) setCrumbs([...nextCrumbs])
    } catch (error) {
      if (requestID === directoryRequestRef.current) onError(error)
    } finally {
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [defaultSort, onError, pageState?.sort, port])

  const loadMoreDirectory = useCallback(async (id: number, sort: TSort) => {
    const currentPage = pageState
    if (
      loadMoreRequestRef.current ||
      !xDriveFileExplorerCanLoadMore(currentPage, id, sort, loadingMore)
    ) return

    const requestID = directoryRequestRef.current
    loadMoreRequestRef.current = true
    setLoadingMore(true)
    try {
      const page = await port.getPage(
        id,
        xDriveFileExplorerPageRequestOptions(sort, currentPage.cursor),
      )
      if (requestID !== directoryRequestRef.current) return
      const transition = xDriveFileExplorerDirectoryPageTransition(
        id,
        page,
        sort,
        true,
        directoryItemIDsRef.current,
      )
      setItems(transition.applyItems)
      setPageState(transition.pageState)
    } catch (error) {
      if (requestID === directoryRequestRef.current) onError(error)
    } finally {
      loadMoreRequestRef.current = false
      if (requestID === directoryRequestRef.current) setLoadingMore(false)
    }
  }, [loadingMore, onError, pageState, port])

  const loadInitial = useCallback(async () => {
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    loadMoreRequestRef.current = false
    setLoadingMore(false)
    setLoading(true)
    try {
      const [quotaValue, root] = await Promise.all([
        port.getQuota(),
        port.getRoot(),
      ])
      const page = await port.getPage(
        root.id,
        xDriveFileExplorerPageRequestOptions(defaultSort),
      )
      if (requestID !== directoryRequestRef.current) return
      const transition = xDriveFileExplorerDirectoryPageTransition(
        root.id,
        page,
        defaultSort,
        false,
        directoryItemIDsRef.current,
      )
      setQuota(quotaValue)
      setCrumbs([{ id: root.id, name: rootLabel }])
      setItems(transition.applyItems)
      setPageState(transition.pageState)
    } catch (error) {
      if (requestID === directoryRequestRef.current) onError(error)
    } finally {
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [defaultSort, onError, port, rootLabel])

  useEffect(() => {
    if (!enabled) {
      directoryRequestRef.current += 1
      loadMoreRequestRef.current = false
      directoryItemIDsRef.current.clear()
      setQuota(null)
      setItems([])
      setCrumbs([])
      setPageState(null)
      setLoading(false)
      setLoadingMore(false)
      return
    }
    void loadInitial()
  }, [enabled, loadInitial])

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
    pageState,
    loading,
    loadingMore,
    applyQuota,
    refreshQuota,
    loadInitial,
    loadDirectory,
    loadMoreDirectory,
  }
}
