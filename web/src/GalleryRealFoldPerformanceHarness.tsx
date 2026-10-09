import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import { XDriveMediaGalleryPage } from '@xdrive/ui/mui'

type FoldConfig = {
  token: string
  logical_assets: number
  physical_nodes: number
  live_photo_groups: number
  fold_enabled: boolean
  fold_groups: number
  fold_visible_count: number
}

type RangeEntry = {
  fold: boolean
  offset: number
  returnedCount: number
  itemCount: number
  requestedAt: number
  receivedAt: number
  httpMs: number
}

type FoldStage = {
  step: string
  fold: boolean
  total: number
  clickToRangeMs: number
  clickToDecoded12TwoRAFMs: number
  rangeHTTPMs: number
  rangeItemCount: number
  imageDecodeCount: number
  mountedTiles: number
  heapBytesSnapshot: number | null
  longTaskMaxMs: number
  thumbnailRequestsCumulative: number
  thumbnailBytesCumulative: number
}

type FoldResults = {
  workload: 'real-web-100k-verified-fold-ui-toggle'
  logicalItems: number
  physicalNodes: number
  livePhotoGroups: number
  verifiedFoldGroups: number
  expectedFoldVisible: number
  stages: FoldStage[]
  nToggleOn: number
  nToggleOff: number
  label: string
}

declare global {
  interface Window {
    __xdriveGalleryRealFoldResult?: FoldResults
    __xdriveGalleryRealFoldError?: string
  }
}

const waitFrames = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
})
const sleep = (ms: number) => new Promise<void>(resolve => {
  window.setTimeout(resolve, ms)
})

async function awaitCondition<T>(
  predicate: () => T | undefined | null | false,
  reason: string,
  timeoutMs = 45000,
): Promise<T> {
  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    const value = predicate()
    if (value) return value
    await sleep(30)
  }
  throw new Error('real 100k fold mode timed out: ' + reason)
}

export function XDriveGalleryRealFoldPerformanceHarness() {
  const [config, setConfig] = useState<FoldConfig | null>(null)
  const routeStarted = useRef(performance.now())
  const ranges = useRef<RangeEntry[]>([])
  const thumbnail = useRef({ requests: 0, bytes: 0, failures: 0 })
  const finished = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/__perf/config', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('real fold config HTTP ' + response.status)
        return await response.json() as FoldConfig
      })
      .then(value => {
        if (value.logical_assets !== 100000 || value.physical_nodes !== 115000 ||
            value.live_photo_groups !== 15000 || value.fold_enabled !== true ||
            value.fold_groups !== 2000 || value.fold_visible_count !== 92000) {
          throw new Error('real verified fold fixture identity mismatch')
        }
        setConfig(value)
      }).catch(error => {
        if (!controller.signal.aborted) {
          window.__xdriveGalleryRealFoldError = String(error)
        }
      })
    return () => controller.abort()
  }, [])

  const source = useMemo<MediaGalleryDataSource | null>(() => {
    if (!config) return null
    const headers = { Authorization: 'Bearer ' + config.token }
    const getRange: MediaGalleryDataSource['listItemRange'] = async (
      limit, offset, query, signal,
    ) => {
      const folded = query?.fold_duplicates === true
      const params = new URLSearchParams({
        range: 'true',
        limit: String(limit),
        offset: String(offset),
        fold_duplicates: String(folded),
      })
      if (query?.sort_by) params.set('sort_by', query.sort_by)
      if (query?.sort_dir) params.set('sort_dir', query.sort_dir)
      if (query?.time_zone) params.set('time_zone', query.time_zone)
      const requestedAt = performance.now()
      const response = await fetch('/api/v1/media/items?' + params, {
        headers, signal, cache: 'no-store',
      })
      if (!response.ok) throw new Error('real fold range HTTP ' + response.status)
      const payload = await response.json()
      const receivedAt = performance.now()
      if (offset === 0) ranges.current.push({
        fold: folded,
        offset,
        returnedCount: payload.total_count,
        itemCount: payload.items?.length ?? 0,
        requestedAt,
        receivedAt,
        httpMs: receivedAt - requestedAt,
      })
      return payload
    }
    return {
      listItems: async (limit, offset, query) => (
        await getRange(limit, offset, query)
      ).items,
      listItemRange: getRange,
      listAlbums: async () => [],
      listAlbumItems: async (_album, limit, offset, query) => (
        await getRange(limit, offset, query)
      ).items,
      listAlbumItemRange: async (_album, limit, offset, query) =>
        getRange(limit, offset, query),
      loadThumbnail: async (nodeID, signal) => {
        thumbnail.current.requests++
        try {
          const response = await fetch('/api/v1/media/items/' + nodeID + '/thumbnail', {
            headers, signal, cache: 'no-store',
          })
          if (!response.ok) {
            thumbnail.current.failures++
            return null
          }
          const payload = await response.blob()
          thumbnail.current.bytes += payload.size
          return URL.createObjectURL(payload)
        } catch (error) {
          if (signal?.aborted) throw error
          thumbnail.current.failures++
          return null
        }
      },
    }
  }, [config])

  useEffect(() => {
    if (!source || !config || finished.current) return
    let cancelled = false
    const tasks: Array<{ started: number; duration: number }> = []
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        tasks.push({ started: entry.startTime, duration: entry.duration })
      }
    })
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer.observe({ type: 'longtask', buffered: false })
    }

    const decodedViewport = async () => {
      await awaitCondition(() => {
        const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
        const imgs = Array.from(grid?.querySelectorAll('img') ?? []) as HTMLImageElement[]
        const available = imgs.filter(img => img.complete && img.naturalWidth > 0 &&
          img.getBoundingClientRect().width > 0 && img.getBoundingClientRect().height > 0)
        return available.length >= 12 ? available : null
      }, '12 decoded visible real JPEG elements')
      const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
      const imgs = Array.from(grid?.querySelectorAll('img') ?? []) as HTMLImageElement[]
      const ready = imgs.filter(img => img.complete && img.naturalWidth > 0)
      await Promise.all(ready.slice(0, 12).map(img => img.decode()))
      await waitFrames()
      return {
        imageDecodeCount: ready.length,
        mountedTiles: grid?.querySelectorAll('[role="button"]').length ?? 0,
      }
    }

    const runStage = async (step: string, fold: boolean, click: boolean) => {
      const expected = fold ? config.fold_visible_count : config.logical_assets
      const before = click ? ranges.current.length : 0
      const startedAt = click ? performance.now() : routeStarted.current
      if (click) {
        const button = await awaitCondition(
          () => document.querySelector<HTMLButtonElement>(
            '[data-xdrive-gallery-fold-duplicates]',
          ),
          'real Gallery folding button',
        )
        if (button.getAttribute('aria-pressed') === String(fold)) {
          throw new Error('fold toggle expected opposite prior state')
        }
        button.click()
      }
      const entry = await awaitCondition(() => ranges.current.slice(before).find(
        value => value.fold === fold && value.returnedCount === expected &&
          value.itemCount === 100 && value.offset === 0,
      ), 'actual HTTP fold mode ' + step)
      if (cancelled) throw new Error('real fold benchmark stopped')
      await waitFrames()
      const rendered = await decodedViewport()
      if (rendered.mountedTiles >= 1000 || rendered.imageDecodeCount < 12) {
        throw new Error('invalid real folded Gallery virtual viewport: ' + step)
      }
      const end = performance.now()
      const maxTask = Math.max(0, ...tasks.filter(task =>
        task.started >= startedAt && task.started <= end,
      ).map(task => task.duration))
      return {
        step,
        fold,
        total: entry.returnedCount,
        clickToRangeMs: entry.receivedAt - startedAt,
        clickToDecoded12TwoRAFMs: end - startedAt,
        rangeHTTPMs: entry.httpMs,
        rangeItemCount: entry.itemCount,
        imageDecodeCount: rendered.imageDecodeCount,
        mountedTiles: rendered.mountedTiles,
        heapBytesSnapshot: (performance as Performance & {
          memory?: { usedJSHeapSize?: number }
        }).memory?.usedJSHeapSize ?? null,
        longTaskMaxMs: maxTask,
        thumbnailRequestsCumulative: thumbnail.current.requests,
        thumbnailBytesCumulative: thumbnail.current.bytes,
      }
    }

    void (async () => {
      const stages: FoldStage[] = []
      stages.push(await runStage('fresh-initial-off', false, false))
      for (const [step, fold] of [
        ['warm-toggle-on-1', true],
        ['warm-toggle-off-1', false],
        ['warm-toggle-on-2', true],
        ['warm-toggle-off-2', false],
      ] as const) {
        stages.push(await runStage(step, fold, true))
      }
      if (thumbnail.current.failures !== 0 ||
          stages.some(s => !Number.isFinite(s.clickToDecoded12TwoRAFMs))) {
        throw new Error('real folded browsing dropped thumbnails or metrics')
      }
      if (!cancelled) {
        finished.current = true
        window.__xdriveGalleryRealFoldResult = {
          workload: 'real-web-100k-verified-fold-ui-toggle',
          logicalItems: config.logical_assets,
          physicalNodes: config.physical_nodes,
          livePhotoGroups: config.live_photo_groups,
          verifiedFoldGroups: config.fold_groups,
          expectedFoldVisible: config.fold_visible_count,
          stages,
          nToggleOn: 2,
          nToggleOff: 2,
          label: 'Real UI toggle, production React/virtual Gallery, authenticated Gin/Postgres/CAS. Initial OFF cold, toggle ON/OFF warm-after-first-mount, not cold ON and not physical device.',
        }
      }
    })().catch(error => {
      if (!cancelled) window.__xdriveGalleryRealFoldError = String(error)
    })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [source, config])

  if (!source) return <div role="status">Loading real 100k fold fixture</div>
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <XDriveMediaGalleryPage source={source} pageSize={100} initialSection="library" />
    </div>
  )
}
