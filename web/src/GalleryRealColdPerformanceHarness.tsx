import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import { XDriveMediaGalleryPage } from '@xdrive/ui/mui'

type RealColdConfig = {
  token: string
  logical_assets: number
  physical_nodes: number
  live_photo_groups: number
  seed_ms: number
}
type RealColdMetrics = {
  kind: 'actual-Gin-PostgreSQL-CAS-Web-renderer'
  logicalItems: number
  physicalNodes: number
  livePhotoGroups: number
  navigationToFirstContentMs: number
  navigationToFirstThumbnailRequestMs: number
  navigationToFirstThumbnailResponseMs: number
  navigationToFirstImageDecodedMs: number
  navigationToFirstImagePaintMs: number
  navigationToFirst12DecodedMs: number
  routeToFirstImagePaintMs: number
  firstRangeHttpMs: number
  mountedTiles: number
  mountedImages: number
  imagesDecodedAtCompletion: number
  thumbnailRequests: number
  thumbnailSuccess: number
  thumbnailErrors: number
  thumbnailResponseBytes: number
  usedJSHeapSize: number | null
  longTaskCount: number
  longestLongTaskMs: number
  provisionalFirstPaintUnder2s: boolean
  first12IsFullViewport: false
  note: string
}
declare global {
  interface Window {
    __xdriveGalleryRealColdResult?: RealColdMetrics
    __xdriveGalleryRealColdError?: string
  }
}

function twoFrames(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

export function XDriveGalleryRealColdPerformanceHarness() {
  const routeStarted = useRef(performance.now())
  const [config, setConfig] = useState<RealColdConfig | null>(null)
  const markers = useRef({
    rangeRequest: Number.NaN,
    rangeResolved: Number.NaN,
    content: Number.NaN,
    thumbRequest: Number.NaN,
    thumbResponse: Number.NaN,
    firstDecoded: Number.NaN,
    firstPaint: Number.NaN,
    first12Decoded: Number.NaN,
    requests: 0,
    success: 0,
    errors: 0,
    bytes: 0,
  })
  const finished = useRef(false)
  const longTasks = useRef<number[]>([])
  const elapsed = () => performance.now() - routeStarted.current

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/__perf/config', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Gallery cold fixture config HTTP ' + response.status)
        return await response.json() as RealColdConfig
      })
      .then(setConfig)
      .catch(error => {
        if (controller.signal.aborted) return
        window.__xdriveGalleryRealColdError = String(error)
      })
    return () => controller.abort()
  }, [])

  const source = useMemo<MediaGalleryDataSource | null>(() => {
    if (!config) return null
    const headers = { Authorization: 'Bearer ' + config.token }
    const getRange: MediaGalleryDataSource['listItemRange'] = async (limit, offset, _query, signal) => {
      const first = offset === 0 && !Number.isFinite(markers.current.rangeRequest)
      if (first) markers.current.rangeRequest = elapsed()
      const url = '/api/v1/media/items?range=true&limit=' + limit + '&offset=' + offset
      const response = await fetch(url, { headers, signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Real 100k Gallery range HTTP ' + response.status)
      const payload = await response.json()
      if (first) markers.current.rangeResolved = elapsed()
      return payload
    }
    return {
      listItems: async (limit, offset, query) => (await getRange(limit, offset, query)).items,
      listItemRange: getRange,
      listAlbums: async () => [],
      listAlbumItems: async (_album, limit, offset, query) => (await getRange(limit, offset, query)).items,
      listAlbumItemRange: async (_album, limit, offset, query) => getRange(limit, offset, query),
      loadThumbnail: async (nodeID, signal) => {
        if (!Number.isFinite(markers.current.thumbRequest)) markers.current.thumbRequest = elapsed()
        markers.current.requests++
        try {
          const response = await fetch('/api/v1/media/items/' + nodeID + '/thumbnail', {
            headers, signal, cache: 'no-store',
          })
          if (!response.ok) {
            markers.current.errors++
            return null
          }
          const blob = await response.blob()
          markers.current.success++
          markers.current.bytes += blob.size
          if (!Number.isFinite(markers.current.thumbResponse)) markers.current.thumbResponse = elapsed()
          return URL.createObjectURL(blob)
        } catch (error) {
          if (signal?.aborted) throw error
          markers.current.errors++
          return null
        }
      },
    }
  }, [config])

  useEffect(() => {
    if (!source || !config) return
    let checking = false
    let didDecode = false
    const observer = new PerformanceObserver(list => {
      for (const event of list.getEntries()) longTasks.current.push(event.duration)
    })
    try {
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
      }
    } catch {
      // Long Task sampling can be unsupported without compromising first paint.
    }
    const interval = window.setInterval(() => {
      if (checking || finished.current) return
      void (async () => {
        checking = true
        try {
          const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
          if (!grid) return
          const tile = grid.querySelector('[role="button"]')
          if (tile && !Number.isFinite(markers.current.content)) markers.current.content = elapsed()
          const visible = Array.from(grid.querySelectorAll('img')) as HTMLImageElement[]
          const ready = visible.filter(img => img.complete && img.naturalWidth > 0)
          if (ready.length === 0) return
          if (!didDecode) {
            didDecode = true
            await ready[0].decode()
            markers.current.firstDecoded = elapsed()
            await twoFrames()
            if (finished.current) return
            const rect = ready[0].getBoundingClientRect()
            if (rect.width < 1 || rect.height < 1) {
              throw new Error('first decoded Gallery thumbnail is not visible')
            }
            markers.current.firstPaint = elapsed()
          }
          if (ready.length < 12) return
          await Promise.all(ready.slice(0, 12).map(img => img.decode()))
          markers.current.first12Decoded = elapsed()
          await twoFrames()
          const firstPaint = markers.current.firstPaint
          const metrics: RealColdMetrics = {
            kind: 'actual-Gin-PostgreSQL-CAS-Web-renderer',
            logicalItems: config.logical_assets,
            physicalNodes: config.physical_nodes,
            livePhotoGroups: config.live_photo_groups,
            navigationToFirstContentMs: performance.now() - elapsed() + markers.current.content,
            navigationToFirstThumbnailRequestMs: performance.now() - elapsed() + markers.current.thumbRequest,
            navigationToFirstThumbnailResponseMs: performance.now() - elapsed() + markers.current.thumbResponse,
            navigationToFirstImageDecodedMs: performance.now() - elapsed() + markers.current.firstDecoded,
            navigationToFirstImagePaintMs: performance.now() - elapsed() + firstPaint,
            navigationToFirst12DecodedMs: performance.now() - elapsed() + markers.current.first12Decoded,
            routeToFirstImagePaintMs: firstPaint,
            firstRangeHttpMs: markers.current.rangeResolved - markers.current.rangeRequest,
            mountedTiles: grid.querySelectorAll('[role="button"]').length,
            mountedImages: visible.length,
            imagesDecodedAtCompletion: ready.length,
            thumbnailRequests: markers.current.requests,
            thumbnailSuccess: markers.current.success,
            thumbnailErrors: markers.current.errors,
            thumbnailResponseBytes: markers.current.bytes,
            usedJSHeapSize: (performance as Performance & {
              memory?: { usedJSHeapSize?: number }
            }).memory?.usedJSHeapSize ?? null,
            longTaskCount: longTasks.current.length,
            longestLongTaskMs: Math.max(0, ...longTasks.current),
            provisionalFirstPaintUnder2s: performance.now() - elapsed() + firstPaint < 2000,
            first12IsFullViewport: false,
            note: 'Real authenticated Gin/PostgreSQL media range and Local CAS JPEG decode. Fresh browser context; excludes Electron Agent IPC. First12 means first 12 successfully decoded visible image elements, not every tile.',
          }
          if (metrics.logicalItems !== 100000 || metrics.mountedTiles >= 1000) {
            throw new Error('100k sparse viewport contract failed: ' + JSON.stringify(metrics))
          }
          finished.current = true
          window.__xdriveGalleryRealColdResult = metrics
          console.info('GALLERY_REAL_WEB_COLD_RESULT ' + JSON.stringify(metrics))
        } catch (error) {
          finished.current = true
          window.__xdriveGalleryRealColdError = String(error)
        } finally {
          checking = false
        }
      })()
    }, 25)
    const deadline = window.setTimeout(() => {
      if (!finished.current) {
        finished.current = true
        window.__xdriveGalleryRealColdError = 'first 12 decoded Gallery images not available within 25s'
      }
    }, 25000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(deadline)
      observer.disconnect()
    }
  }, [source, config])

  if (!source) return <div role="status">Loading real 100k Gallery fixture</div>
  return <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
    <XDriveMediaGalleryPage source={source} pageSize={100} initialSection="library" />
  </div>
}
