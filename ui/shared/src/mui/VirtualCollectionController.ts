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

  const abortInFlight = useCallback(() => {
    for (const entry of inFlightRef.current.values()) entry.controller.abort()
    inFlightRef.current.clear()
  }, [])

  const reset = useCallback((nextQueryKey = queryKey) => {
    abortInFlight()
    loadedRangeRef.current.clear()
    generationRef.current += 1
    queryKeyRef.current = nextQueryKey
    setSnapshot(
      xDriveCreateVirtualCollectionSnapshot<TItem>(
        nextQueryKey,
        generationRef.current,
      ),
    )
  }, [abortInFlight, queryKey])

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
    const ranges = xDriveVirtualCollectionRangesForViewport({
      startIndex,
      endIndex,
      totalCount: snapshot.totalCount,
      pageSize,
      overscanPages,
    })
    const retentionRanges = xDriveVirtualCollectionRangesForViewport({
      startIndex,
      endIndex,
      totalCount: snapshot.totalCount,
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
      setSnapshot((current) => (
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

          loadedRangeRef.current.add(key)
          setSnapshot((current) => (
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
    loadRange,
    onError,
    overscanPages,
    pageSize,
    queryKey,
    retentionOverscanPages,
    snapshot.totalCount,
  ])

  const itemAt = useCallback(
    (index: number) => snapshot.items.get(index),
    [snapshot.items],
  )

  return {
    generation: snapshot.generation,
    totalCount: snapshot.totalCount,
    loadedCount: snapshot.items.size,
    loadedItems: snapshot.items,
    itemAt,
    ensureViewport,
    reset,
  }
}
