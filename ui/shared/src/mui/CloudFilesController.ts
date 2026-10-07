import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuotaUsage } from '../models'
import {
  xDriveCloudFilesChangeAffectsParent,
} from '../cloud-files'
import type {
  XDriveCloudFilesCrumb,
  XDriveCloudFilesPort,
} from '../cloud-files'
import {
  XDRIVE_FILE_EXPLORER_PAGE_SIZE,
} from '../file-explorer-controller'
import {
  XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
  xDriveFileExplorerGroupingSignature,
} from '../file-explorer-grouping'
import type {
  XDriveFileExplorerGroupIndex,
  XDriveFileExplorerGrouping,
} from '../file-explorer-grouping'
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
  groups: readonly XDriveFileExplorerGroupIndex[]
}

type XDriveCloudFilesVirtualTarget<
  TSort extends XDriveFileExplorerPageSort,
> = {
  parentID: number
  sort: TSort
  grouping: XDriveFileExplorerGrouping
  groups: readonly XDriveFileExplorerGroupIndex[]
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
  changePollIntervalMs?: number
  changeDebounceMs?: number
  preserveStateOnDisable?: boolean
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
    xDriveFileExplorerGroupingSignature(target.grouping),
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
  changePollIntervalMs = 1_500,
  changeDebounceMs = 120,
  preserveStateOnDisable = false,
  onError,
}: XDriveCloudFilesControllerOptions<TNode, TQuota, TSort>) {
  const [quota, setQuota] = useState<TQuota | null>(null)
  const [items, setItems] = useState<TNode[]>([])
  const [crumbs, setCrumbs] = useState<XDriveCloudFilesCrumb[]>([])
  const [loading, setLoading] = useState(true)
  const [virtualTarget, setVirtualTarget] = useState<XDriveCloudFilesVirtualTarget<TSort> | null>(null)
  const directoryRequestRef = useRef(0)
  const directoryInFlightRequestRef = useRef<number | null>(null)
  const directoryInFlightParentIDRef = useRef<number | null>(null)
  const quotaRequestRef = useRef(0)
  const changeCursorRef = useRef<number | null>(null)
  const changeRequestRef = useRef(0)
  const changePollRunningRef = useRef(false)
  const changeHandshakeRefreshRef = useRef(false)
  const changeRefreshTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const enabledRef = useRef(enabled)
  const crumbsRef = useRef(crumbs)
  const virtualTargetRef = useRef(virtualTarget)
  const onErrorRef = useRef(onError)
  enabledRef.current = enabled
  crumbsRef.current = crumbs
  virtualTargetRef.current = virtualTarget
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
        totalCount: null,
      }
    }
    const page = await port.getRange(
      target.parentID,
      range.offset,
      range.limit,
      target.sort,
      false,
      target.grouping,
    )
    return {
      items: page.items,
      offset: page.offset,
      limit: page.limit,
      totalCount: page.total_count_included === false
        ? null
        : page.total_count,
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
    grouping: XDriveFileExplorerGrouping,
    requestID: number,
    firstRange: {
      items: readonly TNode[]
      total_count: number
      total_count_included?: boolean
      offset: number
      limit: number
      groups?: readonly XDriveFileExplorerGroupIndex[]
    },
  ) => {
    if (firstRange.total_count_included === false) {
      throw new Error('Initial directory range must include total_count.')
    }
    const target = {
      parentID,
      sort,
      grouping: { ...grouping },
      groups: firstRange.groups ? [...firstRange.groups] : [],
      requestID,
    }
    const nextKey = xDriveCloudFilesVirtualQueryKey(target)
    virtualCollection.reset(nextKey)
    virtualCollection.primePage({
      items: firstRange.items,
      totalCount: firstRange.total_count,
      offset: firstRange.offset,
      limit: firstRange.limit,
    })
    // State commits on the next render, but async change-feed work can resume
    // immediately after this directory load. Publish the authoritative target
    // to the ref synchronously so stale events cannot observe the old parent.
    virtualTargetRef.current = target
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
      groups: virtualTarget.groups,
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
    quotaRequestRef.current += 1
    if (enabledRef.current) setQuota(value)
  }, [])

  const refreshQuota = useCallback(async () => {
    if (!enabledRef.current) return
    const requestID = quotaRequestRef.current + 1
    quotaRequestRef.current = requestID
    try {
      const value = await port.getQuota()
      if (
        requestID === quotaRequestRef.current &&
        enabledRef.current
      ) setQuota(value)
    } catch (error) {
      if (
        requestID === quotaRequestRef.current &&
        enabledRef.current
      ) reportError(error)
    }
  }, [port, reportError])

  const loadDirectory = useCallback(async (
    id: number,
    nextCrumbs?: readonly XDriveCloudFilesCrumb[],
    sort?: TSort,
    grouping?: XDriveFileExplorerGrouping,
  ) => {
    const effectiveSort = sort ?? virtualTargetRef.current?.sort ?? defaultSort
    const effectiveGrouping = grouping ?? virtualTargetRef.current?.grouping ?? XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    directoryInFlightRequestRef.current = requestID
    directoryInFlightParentIDRef.current = id
    setLoading(true)
    try {
      const range = await port.getRange(
        id,
        0,
        XDRIVE_FILE_EXPLORER_PAGE_SIZE,
        effectiveSort,
        true,
        effectiveGrouping,
      )
      if (requestID !== directoryRequestRef.current) return false
      setItems([...range.items])
      if (nextCrumbs) {
        const copiedCrumbs = [...nextCrumbs]
        crumbsRef.current = copiedCrumbs
        setCrumbs(copiedCrumbs)
      }
      activateVirtualDirectory(id, effectiveSort, effectiveGrouping, requestID, range)
      return true
    } catch (error) {
      if (requestID === directoryRequestRef.current) reportError(error)
      return false
    } finally {
      if (directoryInFlightRequestRef.current === requestID) {
        directoryInFlightRequestRef.current = null
        directoryInFlightParentIDRef.current = null
      }
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [
    activateVirtualDirectory,
    defaultSort,
    port,
    reportError,
  ])

  const refreshChangedDirectory = useCallback(async (
    expectedParentID?: number,
  ) => {
    const target = virtualTargetRef.current
    const latestCrumbs = crumbsRef.current
    if (
      !enabledRef.current ||
      directoryInFlightRequestRef.current !== null ||
      !target ||
      (expectedParentID !== undefined && target.parentID !== expectedParentID) ||
      latestCrumbs.at(-1)?.id !== target.parentID
    ) return false
    return loadDirectory(
      target.parentID,
      latestCrumbs,
      target.sort,
      target.grouping,
    )
  }, [loadDirectory])

  const scheduleChangedDirectoryRefresh = useCallback(async () => {
    if (changeRefreshTimerRef.current !== null) {
      globalThis.clearTimeout(changeRefreshTimerRef.current)
      changeRefreshTimerRef.current = null
    }
    const scheduledParentID = virtualTargetRef.current?.parentID
    if (scheduledParentID === undefined) return false

    const runRefresh = async () => {
      const refreshed = await refreshChangedDirectory(scheduledParentID)
      if (refreshed && changeHandshakeRefreshRef.current) {
        changeHandshakeRefreshRef.current = false
      }
      return refreshed
    }

    if (changeDebounceMs <= 0) {
      return runRefresh()
    }
    changeRefreshTimerRef.current = globalThis.setTimeout(() => {
      changeRefreshTimerRef.current = null
      void runRefresh()
    }, changeDebounceMs)
    // A queued timer is not an acknowledged refresh. Keep any reconnect
    // handshake intent until the debounced refresh actually succeeds.
    return false
  }, [changeDebounceMs, refreshChangedDirectory])

  const refreshChanges = useCallback(async () => {
    const getChanges = port.getChanges
    if (
      !enabledRef.current ||
      !getChanges ||
      changePollRunningRef.current
    ) return false

    changePollRunningRef.current = true
    const requestID = changeRequestRef.current + 1
    changeRequestRef.current = requestID
    try {
      if (changeCursorRef.current === null) {
        const snapshot = await getChanges(0, 1)
        if (
          requestID !== changeRequestRef.current ||
          !enabledRef.current
        ) return false
        changeCursorRef.current = snapshot.latest_cursor
        changeHandshakeRefreshRef.current = true
        if (
          virtualTargetRef.current &&
          directoryInFlightRequestRef.current === null
        ) {
          await scheduleChangedDirectoryRefresh()
        }
        return false
      }

      let cursor = changeCursorRef.current
      let affected = false
      for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
        const page = await getChanges(cursor, 200)
        if (
          requestID !== changeRequestRef.current ||
          !enabledRef.current
        ) return false

        const inFlightParentID = directoryInFlightParentIDRef.current
        if (
          inFlightParentID !== null &&
          (
            page.reset_required ||
            page.changes.some((change) => (
              xDriveCloudFilesChangeAffectsParent(change, inFlightParentID)
            ))
          )
        ) {
          // Keep this page replayable until the directory range that it can
          // invalidate has finished loading. Once that navigation commits,
          // the next poll sees the same event with the target as current and
          // can refresh it without background work superseding navigation.
          return false
        }

        if (page.reset_required) {
          cursor = page.latest_cursor
          affected = true
          break
        }

        const activeParentID = virtualTargetRef.current?.parentID
        if (
          activeParentID !== undefined &&
          page.changes.some((change) => (
            xDriveCloudFilesChangeAffectsParent(change, activeParentID)
          ))
        ) {
          affected = true
        }

        const nextCursor = page.next_cursor
        cursor = nextCursor
        if (!page.has_more || nextCursor >= page.latest_cursor) break
      }

      changeCursorRef.current = cursor
      if (changeHandshakeRefreshRef.current && virtualTargetRef.current) {
        affected = true
      }
      if (affected) await scheduleChangedDirectoryRefresh()
      return affected
    } catch (error) {
      if (
        requestID === changeRequestRef.current &&
        enabledRef.current
      ) reportError(error)
      return false
    } finally {
      if (requestID === changeRequestRef.current) {
        changePollRunningRef.current = false
      }
    }
  }, [port, reportError, scheduleChangedDirectoryRefresh])

  const loadInitial = useCallback(async () => {
    const requestID = directoryRequestRef.current + 1
    directoryRequestRef.current = requestID
    directoryInFlightRequestRef.current = requestID
    directoryInFlightParentIDRef.current = null
    const quotaRequestID = quotaRequestRef.current + 1
    quotaRequestRef.current = quotaRequestID
    setLoading(true)
    try {
      const [quotaValue, root] = await Promise.all([
        port.getQuota(),
        port.getRoot(),
      ])
      if (directoryInFlightRequestRef.current === requestID) {
        directoryInFlightParentIDRef.current = root.id
      }
      const range = await port.getRange(
        root.id,
        0,
        XDRIVE_FILE_EXPLORER_PAGE_SIZE,
        defaultSort,
        true,
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
      )
      if (requestID !== directoryRequestRef.current) return
      if (
        quotaRequestID === quotaRequestRef.current &&
        enabledRef.current
      ) setQuota(quotaValue)
      const rootCrumbs = [{ id: root.id, name: rootLabel }]
      crumbsRef.current = rootCrumbs
      setCrumbs(rootCrumbs)
      setItems([...range.items])
      activateVirtualDirectory(
        root.id,
        defaultSort,
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
        requestID,
        range,
      )
    } catch (error) {
      if (requestID === directoryRequestRef.current) reportError(error)
    } finally {
      if (directoryInFlightRequestRef.current === requestID) {
        directoryInFlightRequestRef.current = null
        directoryInFlightParentIDRef.current = null
      }
      if (requestID === directoryRequestRef.current) setLoading(false)
    }
  }, [activateVirtualDirectory, defaultSort, port, reportError, rootLabel])

  useEffect(() => {
    if (!enabled) {
      directoryRequestRef.current += 1
      directoryInFlightRequestRef.current = null
      directoryInFlightParentIDRef.current = null
      quotaRequestRef.current += 1
      changeRequestRef.current += 1
      changeCursorRef.current = null
      changePollRunningRef.current = false
      changeHandshakeRefreshRef.current = false
      if (changeRefreshTimerRef.current !== null) {
        globalThis.clearTimeout(changeRefreshTimerRef.current)
        changeRefreshTimerRef.current = null
      }
      if (preserveStateOnDisable) {
        // Desktop keeps the current directory and grouping across a temporary
        // Agent transport outage. Abort stale range work without discarding
        // navigation state that should be resumed after reconnect.
        virtualCollection.reset()
        setLoading(false)
        return
      }
      virtualCollection.reset('cloud-files:virtual:disabled')
      setVirtualTarget(null)
      setQuota(null)
      setItems([])
      setCrumbs([])
      setLoading(false)
      return
    }

    if (preserveStateOnDisable) {
      const preservedCrumbs = crumbsRef.current
      const target = preservedCrumbs.at(-1)
      if (target) {
        void loadDirectory(
          target.id,
          preservedCrumbs,
          virtualTargetRef.current?.sort ?? defaultSort,
          virtualTargetRef.current?.grouping ?? XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
        )
        return
      }
    }
    void loadInitial()
  }, [
    defaultSort,
    enabled,
    loadDirectory,
    loadInitial,
    preserveStateOnDisable,
    virtualCollection.reset,
  ])

  useEffect(() => {
    if (
      !enabled ||
      !virtualTarget ||
      !changeHandshakeRefreshRef.current ||
      directoryInFlightRequestRef.current !== null
    ) return

    void scheduleChangedDirectoryRefresh()
  }, [
    enabled,
    scheduleChangedDirectoryRefresh,
    virtualTarget,
  ])

  useEffect(() => {
    if (
      !enabled ||
      !port.getChanges ||
      changePollIntervalMs <= 0
    ) return

    let stopped = false
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null
    const poll = async () => {
      await refreshChanges()
      if (stopped) return
      timer = globalThis.setTimeout(() => {
        void poll()
      }, changePollIntervalMs)
    }
    void poll()
    return () => {
      stopped = true
      if (timer !== null) globalThis.clearTimeout(timer)
      changeRequestRef.current += 1
      changePollRunningRef.current = false
    }
  }, [changePollIntervalMs, enabled, port, refreshChanges])

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
    grouping: virtualTarget?.grouping ?? XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
    loading,
    virtualDirectory,
    applyQuota,
    refreshQuota,
    refreshChanges,
    refreshCurrentDirectoryIfIdle: refreshChangedDirectory,
    loadInitial,
    loadDirectory,
  }
}
