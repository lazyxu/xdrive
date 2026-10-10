import { useCallback, useEffect, useRef, useState } from 'react'
import {
  XDRIVE_VIRTUAL_COLLECTION_DEFAULT_OVERSCAN_PAGES,
  XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE,
  XDRIVE_VIRTUAL_COLLECTION_DEFAULT_RETENTION_OVERSCAN_PAGES,
  xDriveCreateVirtualCollectionSnapshot,
  xDriveVirtualCollectionApplyPage,
  xDriveVirtualCollectionRangeKey,
  xDriveVirtualCollectionRangesForViewport,
  xDriveVirtualCollectionRetainRanges,
} from '../virtual-collection'
import type {
  XDriveVirtualCollectionPage,
  XDriveVirtualCollectionRange,
  XDriveVirtualCollectionSnapshot,
} from '../virtual-collection'

export type XDriveVirtualCollectionLoader<TItem> = (
  range: XDriveVirtualCollectionRange,
  signal: AbortSignal,
) => Promise<XDriveVirtualCollectionPage<TItem>>

type InFlightRange = {
  generation: number
  controller: AbortController
  promise: Promise<void>
}

export function useXDriveVirtualCollection<TItem>({
  queryKey,
  loadRange,
  onError,
  pageSize = XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE,
  overscanPages = XDRIVE_VIRTUAL_COLLECTION_DEFAULT_OVERSCAN_PAGES,
  retentionOverscanPages = XDRIVE_VIRTUAL_COLLECTION_DEFAULT_RETENTION_OVERSCAN_PAGES,
}: {
  queryKey: string
  loadRange: XDriveVirtualCollectionLoader<TItem>
  onError: (error: unknown) => void
  pageSize?: number
  overscanPages?: number
  retentionOverscanPages?: number
}) {
  const generationRef = useRef(1)
  const queryKeyRef = useRef(queryKey)
  const inFlightRef = useRef(new Map<string, InFlightRange>())
  const loadedRangeRef = useRef(new Set<string>())
  const [snapshot, setSnapshot] = useState(
    () => xDriveCreateVirtualCollectionSnapshot<TItem>(queryKey, 1),
  )
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const commitSnapshot = useCallback((
    updater: (
      current: XDriveVirtualCollectionSnapshot<TItem>,
    ) => XDriveVirtualCollectionSnapshot<TItem>,
  ) => {
    const current = snapshotRef.current
    const next = updater(current)
    snapshotRef.current = next
    if (!Object.is(next, current)) setSnapshot(next)
  }, [])

  const abortInFlight = useCallback(() => {
    for (const entry of inFlightRef.current.values()) entry.controller.abort()
    inFlightRef.current.clear()
  }, [])

  const reset = useCallback((nextQueryKey?: string) => {
    const resolvedQueryKey = nextQueryKey ?? queryKeyRef.current
    abortInFlight()
    loadedRangeRef.current.clear()
    generationRef.current += 1
    queryKeyRef.current = resolvedQueryKey
    const next = xDriveCreateVirtualCollectionSnapshot<TItem>(
      resolvedQueryKey,
      generationRef.current,
    )
    snapshotRef.current = next
    setSnapshot(next)
  }, [abortInFlight])

  const primePage = useCallback((page: XDriveVirtualCollectionPage<TItem>) => {
    if (page.totalCount === null) {
      throw new Error('Cannot prime VirtualCollection without an authoritative total count.')
    }
    const generation = generationRef.current
    const range = { offset: page.offset, limit: page.limit }
    loadedRangeRef.current.add(xDriveVirtualCollectionRangeKey(range))
    commitSnapshot((current) => (
      current.generation === generation
        ? xDriveVirtualCollectionApplyPage(current, generation, page)
        : current
    ))
  }, [commitSnapshot])

  useEffect(() => {
    if (queryKeyRef.current === queryKey) return
    reset(queryKey)
  }, [queryKey, reset])

  useEffect(() => () => {
    abortInFlight()
  }, [abortInFlight])

  const ensureViewport = useCallback(async (
    startIndex: number,
    endIndex: number,
  ) => {
    if (queryKeyRef.current !== queryKey) return

    const generation = generationRef.current
    const totalCount = snapshotRef.current.totalCount
    const ranges = xDriveVirtualCollectionRangesForViewport({
      startIndex,
      endIndex,
      totalCount,
      pageSize,
      overscanPages,
    })
    const retentionRanges = xDriveVirtualCollectionRangesForViewport({
      startIndex,
      endIndex,
      totalCount,
      pageSize,
      overscanPages: Math.max(overscanPages, retentionOverscanPages),
    })
    const retainedKeys = new Set(
      retentionRanges.map((range) => xDriveVirtualCollectionRangeKey(range)),
    )

    for (const [key, entry] of inFlightRef.current) {
      if (entry.generation !== generation || retainedKeys.has(key)) continue
      entry.controller.abort()
      if (inFlightRef.current.get(key) === entry) {
        inFlightRef.current.delete(key)
      }
    }

    let evicted = false
    for (const key of [...loadedRangeRef.current]) {
      if (retainedKeys.has(key)) continue
      loadedRangeRef.current.delete(key)
      evicted = true
    }
    if (evicted) {
      commitSnapshot((current) => (
        current.generation === generation
          ? xDriveVirtualCollectionRetainRanges(current, retentionRanges)
          : current
      ))
    }

    const tasks: Promise<void>[] = []

    for (const range of ranges) {
      const key = xDriveVirtualCollectionRangeKey(range)
      if (loadedRangeRef.current.has(key)) continue

      const existing = inFlightRef.current.get(key)
      if (existing && existing.generation === generation) {
        tasks.push(existing.promise)
        continue
      }

      const controller = new AbortController()
      let entry!: InFlightRange
      const promise = (async () => {
        try {
          const page = await loadRange(range, controller.signal)
          if (
            controller.signal.aborted ||
            generation !== generationRef.current ||
            queryKeyRef.current !== queryKey
          ) return
          if (
            page.totalCount === null &&
            snapshotRef.current.totalCount === null
          ) {
            throw new Error(
              'Count-free VirtualCollection range requires an authoritative total count for the current generation.',
            )
          }

          loadedRangeRef.current.add(key)
          commitSnapshot((current) => (
            current.generation === generation
              ? xDriveVirtualCollectionApplyPage(current, generation, page)
              : current
          ))
        } catch (error) {
          if (
            !controller.signal.aborted &&
            generation === generationRef.current &&
            queryKeyRef.current === queryKey
          ) onError(error)
        } finally {
          if (inFlightRef.current.get(key) === entry) {
            inFlightRef.current.delete(key)
          }
        }
      })()

      entry = { generation, controller, promise }
      inFlightRef.current.set(key, entry)
      tasks.push(promise)
    }

    await Promise.all(tasks)
  }, [
    commitSnapshot,
    loadRange,
    onError,
    overscanPages,
    pageSize,
    queryKey,
    retentionOverscanPages,
  ])

  const collectRange = useCallback(async (
    startIndex: number,
    endIndex: number,
    signal?: AbortSignal,
  ): Promise<TItem[] | null> => {
    if (signal?.aborted) return null
    const generation = generationRef.current
    const activeQueryKey = queryKeyRef.current
    const totalCount = snapshotRef.current.totalCount

    if (totalCount === 0) return []

    const start = Math.max(0, Math.trunc(startIndex))
    const requestedEnd = Math.max(start, Math.trunc(endIndex))
    const end = totalCount === null
      ? requestedEnd
      : Math.min(requestedEnd, Math.max(0, totalCount - 1))

    const result: TItem[] = []
    const chunkSize = Math.max(pageSize, pageSize * 4)

    for (let chunkStart = start; chunkStart <= end; chunkStart += chunkSize) {
      if (
        signal?.aborted ||
        generation !== generationRef.current ||
        activeQueryKey !== queryKeyRef.current
      ) return null

      const chunkEnd = Math.min(end, chunkStart + chunkSize - 1)
      if (signal) {
        // Explicit user selection owns its requests. Reuse cached page values
        // when complete, but never attach its cancel signal to a viewport
        // request: scrolling must survive the user's Select All cancellation.
        for (let offset = chunkStart; offset <= chunkEnd; offset += pageSize) {
          if (
            signal.aborted ||
            generation !== generationRef.current ||
            activeQueryKey !== queryKeyRef.current
          ) return null
          const range = { offset, limit: Math.min(pageSize, chunkEnd - offset + 1) }
          const cached: TItem[] = []
          for (let index = range.offset; index < range.offset + range.limit; index += 1) {
            const item = snapshotRef.current.items.get(index)
            if (item === undefined) break
            cached.push(item)
          }
          if (cached.length === range.limit) {
            result.push(...cached)
            continue
          }
          let page: XDriveVirtualCollectionPage<TItem>
          try {
            page = await loadRange(range, signal)
          } catch (error) {
            if (signal.aborted) return null
            throw error
          }
          if (
            signal.aborted ||
            generation !== generationRef.current ||
            activeQueryKey !== queryKeyRef.current
          ) return null
          if (
            page.offset !== range.offset ||
            page.items.length !== range.limit ||
            (totalCount !== null && page.totalCount !== null && page.totalCount !== totalCount)
          ) return null
          result.push(...page.items)
        }
        continue
      }
      await ensureViewport(chunkStart, chunkEnd)

      if (
        generation !== generationRef.current ||
        activeQueryKey !== queryKeyRef.current
      ) return null

      for (let index = chunkStart; index <= chunkEnd; index += 1) {
        const item = snapshotRef.current.items.get(index)
        if (!item) return null
        result.push(item)
      }
    }

    return result
  }, [ensureViewport, loadRange, pageSize])

  const updateLoadedItems = useCallback((
    updater: (item: TItem, index: number) => TItem,
  ) => {
    commitSnapshot((current) => {
      let changed = false
      const items = new Map(current.items)
      for (const [index, item] of current.items) {
        const next = updater(item, index)
        if (Object.is(next, item)) continue
        items.set(index, next)
        changed = true
      }
      return changed ? { ...current, items } : current
    })
  }, [commitSnapshot])

  const itemAt = useCallback(
    (index: number) => snapshotRef.current.items.get(index),
    [],
  )

  return {
    generation: snapshot.generation,
    totalCount: snapshot.totalCount,
    loadedCount: snapshot.items.size,
    loadedItems: snapshot.items,
    itemAt,
    ensureViewport,
    collectRange,
    reset,
    primePage,
    updateLoadedItems,
  }
}
