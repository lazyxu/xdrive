import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import {
  XDriveFileExplorer,
  type XDriveFileExplorerID,
  type XDriveFileExplorerViewMode,
  type XDriveFileExplorerItem,
  type XDriveFileExplorerSort,
  type XDriveFileExplorerVirtualCollection,
} from './FileExplorer'

export type XDriveFileExplorerMediaTraceScenario =
  | 'image-cold'
  | 'image-warm'
  | 'video-poster-cold'
  | 'video-poster-warm'
  | 'live-cold'
  | 'live-warm'

export type XDriveFileExplorerMediaTraceResult = {
  synthetic: true
  scenario: XDriveFileExplorerMediaTraceScenario
  viewMode: XDriveFileExplorerViewMode
  itemCount: number
  timeToFirstGridMs: number
  scriptDurationMs: number
  rangeChangeCount: number
  peakRetainedItems: number
  initialMountedItems: number
  maxMountedItems: number
  thumbnailRequests: number
  peakThumbnailInFlight: number
  longTaskCount: number
  longTaskDurationMs: number
  usedJSHeapSize: number | null
  scrollHeight: number
  viewportHeight: number
  marqueeDurationMs: number
  marqueeSelectionChangeCount: number
  marqueeSelectedItems: number
  marqueePeakSelectedItems: number
  liveGlyphCount: number
}

declare global {
  interface Window {
    __xdriveFileExplorerPerfResult?: XDriveFileExplorerMediaTraceResult
    __xdriveFileExplorerPerfError?: string
    __xdriveFileExplorerPerfMarqueeRequest?: {
      startX: number
      startY: number
      endX: number
      endY: number
      steps: number
    }
    __xdriveFileExplorerPerfMarqueeDone?: boolean
  }
}

const itemCount = 100_000
const pageSize = 200
const retentionPages = 2
const defaultSort: XDriveFileExplorerSort = { key: 'name', direction: 'asc' }

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

async function waitFrames(count = 1) {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }
}

function itemForIndex(
  index: number,
  scenario: XDriveFileExplorerMediaTraceScenario,
): XDriveFileExplorerItem {
  const video = scenario.startsWith('video-poster-')
  const live = scenario.startsWith('live-')
  const sequence = String(index + 1).padStart(6, '0')
  const name = video ? `clip-${sequence}.mp4` : live ? `live-${sequence}.livp` : `image-${sequence}.jpg`
  return {
    id: index + 1,
    name,
    kind: 'file',
    fileKind: video ? 'video' : 'image',
    size: 512_000 + (index % 97) * 4096,
    updatedAt: '2026-10-06T00:00:00.000Z',
    revision: 1,
    path: `Performance/${name}`,
  }
}

function findScrollHost() {
  return document.querySelector('[data-xdrive-file-explorer-scroll-host]') as HTMLElement | null
}

export function XDriveFileExplorerPerformanceHarness({
  scenario,
}: {
  scenario: XDriveFileExplorerMediaTraceScenario
}) {
  const viewMode: XDriveFileExplorerViewMode = new URLSearchParams(window.location.search)
    .get('xdriveFileExplorerViewMode') === 'details' ? 'details' : 'grid'
  const [loadedItems, setLoadedItems] = useState<ReadonlyMap<number, XDriveFileExplorerItem>>(
    () => new Map(),
  )
  const rangeRef = useRef('')
  const runStartedAtRef = useRef(performance.now())
  const rangeChangeCountRef = useRef(0)
  const peakRetainedItemsRef = useRef(0)
  const thumbnailRequestsRef = useRef(0)
  const thumbnailInFlightRef = useRef(0)
  const peakThumbnailInFlightRef = useRef(0)
  const longTaskCountRef = useRef(0)
  const longTaskDurationRef = useRef(0)
  const marqueeSelectionChangeCountRef = useRef(0)
  const marqueeSelectedItemsRef = useRef(0)
  const marqueePeakSelectedItemsRef = useRef(0)

  const onRangeChange = useCallback((startIndex: number, endIndex: number) => {
    const firstPage = Math.max(0, Math.floor(startIndex / pageSize) - retentionPages)
    const lastPage = Math.min(
      Math.ceil(itemCount / pageSize) - 1,
      Math.floor(endIndex / pageSize) + retentionPages,
    )
    const key = `${firstPage}:${lastPage}`
    if (rangeRef.current === key) return
    rangeRef.current = key
    rangeChangeCountRef.current += 1
    const next = new Map<number, XDriveFileExplorerItem>()
    const firstIndex = firstPage * pageSize
    const lastIndex = Math.min(itemCount, (lastPage + 1) * pageSize)
    for (let index = firstIndex; index < lastIndex; index += 1) {
      next.set(index, itemForIndex(index, scenario))
    }
    peakRetainedItemsRef.current = Math.max(peakRetainedItemsRef.current, next.size)
    setLoadedItems(next)
  }, [scenario])

  const virtualCollection = useMemo<XDriveFileExplorerVirtualCollection>(() => ({
    itemCount,
    loadedItems,
    itemAt: (index) => loadedItems.get(index),
    onRangeChange,
  }), [loadedItems, onRangeChange])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    thumbnailRequestsRef.current += 1
    thumbnailInFlightRef.current += 1
    peakThumbnailInFlightRef.current = Math.max(
      peakThumbnailInFlightRef.current,
      thumbnailInFlightRef.current,
    )
    try {
      if (scenario.endsWith('-cold')) await wait(12)
      const id = Number(item.id) || 0
      const hue = id % 360
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="96"><rect width="108" height="96" fill="hsl(${hue} 55% 58%)"/><circle cx="54" cy="48" r="20" fill="rgba(255,255,255,.45)"/></svg>`
      return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    } finally {
      thumbnailInFlightRef.current = Math.max(0, thumbnailInFlightRef.current - 1)
    }
  }, [scenario])

  const onSelectionChange = useCallback((ids: XDriveFileExplorerID[]) => {
    marqueeSelectionChangeCountRef.current += 1
    marqueeSelectedItemsRef.current = ids.length
    marqueePeakSelectedItemsRef.current = Math.max(
      marqueePeakSelectedItemsRef.current,
      ids.length,
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    let longTaskObserver: PerformanceObserver | null = null
    try {
      longTaskObserver = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          longTaskCountRef.current += 1
          longTaskDurationRef.current += entry.duration
        }
      })
      longTaskObserver.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
    } catch {
      longTaskObserver = null
    }

    const run = async () => {
      let host: HTMLElement | null = null
      for (let attempt = 0; attempt < 200 && !host; attempt += 1) {
        await wait(25)
        host = findScrollHost()
      }
      if (!host || cancelled) throw new Error('FileExplorer performance scroll host was not found.')

      await waitFrames(6)
      const timeToFirstGridMs = performance.now() - runStartedAtRef.current
      let maxMountedItems = 0
      const sampleMounted = () => {
        maxMountedItems = Math.max(
          maxMountedItems,
          document.querySelectorAll('[data-xdrive-file-explorer-item]').length,
        )
      }

      sampleMounted()
      const initialMountedItems = maxMountedItems
      const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight)
      let marqueeDurationMs = 0

      for (let step = 1; step <= 36; step += 1) {
        host.scrollTop = Math.min(maxScroll, step * Math.max(1, host.clientHeight * 0.8))
        host.dispatchEvent(new Event('scroll'))
        await waitFrames(2)
        sampleMounted()
      }

      for (const ratio of [0.5, 1, 0]) {
        host.scrollTop = maxScroll * ratio
        host.dispatchEvent(new Event('scroll'))
        await waitFrames(8)
        sampleMounted()
      }

      // Native marquee is a Grid interaction; Details has a sticky header and
      // is benchmarked for scrolling, thumbnails, sparse metadata and layout.
      if (viewMode === 'grid') {
        const hostBounds = host.getBoundingClientRect()
        const marqueeStartX = Math.round(hostBounds.left + 6)
        const marqueeStartY = Math.round(hostBounds.top + 6)
        const marqueeStartedAt = performance.now()
        window.__xdriveFileExplorerPerfMarqueeDone = false
        window.__xdriveFileExplorerPerfMarqueeRequest = {
          startX: marqueeStartX,
          startY: marqueeStartY,
          endX: Math.round(Math.min(
            hostBounds.right - 24,
            marqueeStartX + Math.max(240, host.clientWidth * 0.55),
          )),
          endY: Math.round(Math.min(
            hostBounds.bottom - 24,
            marqueeStartY + Math.max(180, host.clientHeight * 0.55),
          )),
          steps: 12,
        }
        for (
          let attempt = 0;
          attempt < 200 && !window.__xdriveFileExplorerPerfMarqueeDone;
          attempt += 1
        ) {
          await wait(25)
        }
        if (!window.__xdriveFileExplorerPerfMarqueeDone) {
          throw new Error('FileExplorer marquee trace input was not completed.')
        }
        await waitFrames(4)
        marqueeDurationMs = performance.now() - marqueeStartedAt
        delete window.__xdriveFileExplorerPerfMarqueeRequest
      }

      let stableRequests = thumbnailRequestsRef.current
      let stableRounds = 0
      for (let attempt = 0; attempt < 60 && stableRounds < 5; attempt += 1) {
        await wait(50)
        sampleMounted()
        if (thumbnailRequestsRef.current === stableRequests && thumbnailInFlightRef.current === 0) {
          stableRounds += 1
        } else {
          stableRequests = thumbnailRequestsRef.current
          stableRounds = 0
        }
      }

      const memory = (performance as Performance & {
        memory?: { usedJSHeapSize?: number }
      }).memory
      const result: XDriveFileExplorerMediaTraceResult = {
        synthetic: true,
        scenario,
        viewMode,
        itemCount,
        timeToFirstGridMs,
        scriptDurationMs: performance.now() - runStartedAtRef.current,
        rangeChangeCount: rangeChangeCountRef.current,
        peakRetainedItems: peakRetainedItemsRef.current,
        initialMountedItems,
        maxMountedItems,
        thumbnailRequests: thumbnailRequestsRef.current,
        peakThumbnailInFlight: peakThumbnailInFlightRef.current,
        longTaskCount: longTaskCountRef.current,
        longTaskDurationMs: longTaskDurationRef.current,
        usedJSHeapSize: memory?.usedJSHeapSize ?? null,
        scrollHeight: host.scrollHeight,
        viewportHeight: host.clientHeight,
        marqueeDurationMs,
        marqueeSelectionChangeCount: marqueeSelectionChangeCountRef.current,
        marqueeSelectedItems: marqueeSelectedItemsRef.current,
        marqueePeakSelectedItems: marqueePeakSelectedItemsRef.current,
        liveGlyphCount: document.querySelectorAll('[data-xdrive-file-explorer-item-visual] [aria-label="实况照片"]').length,
      }
      window.__xdriveFileExplorerPerfResult = result
      console.info('__XDRIVE_FILE_EXPLORER_PERF_RESULT__' + JSON.stringify(result))
    }

    void run().catch((error) => {
      const message = error instanceof Error ? error.stack || error.message : String(error)
      window.__xdriveFileExplorerPerfError = message
      console.error('__XDRIVE_FILE_EXPLORER_PERF_ERROR__' + message)
    })

    return () => {
      cancelled = true
      longTaskObserver?.disconnect()
    }
  }, [scenario])

  return (
    <Box sx={{ width: '100vw', height: '100vh', boxSizing: 'border-box', p: 1, bgcolor: 'background.default' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">FileExplorer 100k renderer trace</Typography>
        <Chip size="small" label={scenario} />
        <Chip size="small" label={viewMode} />
        <Chip size="small" label="synthetic namespace" variant="outlined" />
      </Stack>
      <Box sx={{ height: 'calc(100vh - 48px)', minHeight: 0 }}>
        <XDriveFileExplorer
          presentation="workspace"
          items={[]}
          crumbs={[{ id: 1, name: 'Performance' }]}
          pathValue="Performance"
          viewMode={viewMode}
          onViewModeChange={() => {}}
          sort={defaultSort}
          onSortChange={() => {}}
          externallySorted
          virtualCollection={virtualCollection}
          loadThumbnail={loadThumbnail}
          onSelectionChange={onSelectionChange}
          statusText="100,000 项"
        />
      </Box>
    </Box>
  )
}
