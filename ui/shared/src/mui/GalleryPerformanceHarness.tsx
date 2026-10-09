import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Box } from '@mui/material'
import type { MediaItem, MediaItemRange } from '../models'
import {
  XDriveMediaGalleryPage,
  type MediaGalleryDataSource,
} from './MediaGallery'
import { xDriveCaptureVideoPosterBlob } from './MediaGalleryVideoPoster'
import {
  xDriveGalleryPerformanceLongTaskAttribution,
  type XDriveGalleryPerformanceLongTask,
  type XDriveGalleryPerformanceLongTaskMetrics,
} from './GalleryPerformanceMetrics'

export type XDriveGalleryRendererTraceScenario =
  | 'image-cold'
  | 'image-warm'
  | 'video-cold'
  | 'video-warm'
  | 'live-cold'
  | 'live-warm'

export type XDriveGalleryRendererTraceResult = XDriveGalleryPerformanceLongTaskMetrics & {
  synthetic: true
  scenario: XDriveGalleryRendererTraceScenario
  logicalItems: number
  viewportWidth: number
  viewportHeight: number
  replayedRangeDelayMs: number
  replayedThumbnailDelayMs: number
  replayedPreviewDelayMs: number
  mediaFirstRequestMs: number
  mediaFirstResolvedMs: number
  rangeRequestMs: number
  rangeResolvedMs: number
  gridCommittedMs: number
  thumbnailFirstRequestMs: number
  thumbnailFirstResolvedMs: number
  firstImageMountedMs: number
  firstImageDecodedMs: number
  firstImagePaintedMs: number
  rangeToGridCommitMs: number
  gridCommitToThumbnailRequestMs: number
  gridCommitToMediaRequestMs: number
  gridCommitToFirstImageMountMs: number
  thumbnailResolvedToImageMountMs: number
  thumbnailResolvedToDecodeMs: number
  mediaResolvedToImageMountMs: number
  mediaResolvedToDecodeMs: number
  decodedToPaintMs: number
  rangeToFirstPaintMs: number
  routeToFirstPaintMs: number
  presentationProxy: 'two-rAF'
  longTaskObservationSupported: boolean
  rangeToFirstImageDecodeMs: number
  routeToFirstImageDecodeMs: number
  fixturePreparationMs: number
  jpegFixtureMs: number
  videoFixtureMs: number
  warmMediaPreparationMs: number
  preparationToActivationMs: number
  mountedImages: number
  placeholders: number
  usedJSHeapSize: number | null
}

type GalleryTracePreparation = {
  startedAt: number
  readyAt: number
  jpegFixtureMs: number
  videoFixtureMs: number
  warmMediaPreparationMs: number
}

declare global {
  interface Window {
    __xdriveGalleryPerfResult?: XDriveGalleryRendererTraceResult
    __xdriveGalleryPerfError?: string
    __xdriveGalleryPerfBoot?: string | null
    __xdriveGalleryPerfBootError?: string
  }
}

const logicalItems = 100_000
const pageSize = 100
const rangeDelayMs = 350
const coldThumbnailDelayMs = 112
const warmThumbnailDelayMs = 6
const coldPreviewDelayMs = 5
const warmPreviewDelayMs = 3
const facetDelayMs = 700
const capturedBase = Date.parse('2026-10-08T00:00:00.000Z')

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function waitFrames(count: number) {
  return new Promise<void>((resolve) => {
    const next = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      window.requestAnimationFrame(() => next(remaining - 1))
    }
    next(count)
  })
}

function mediaItemForIndex(
  index: number,
  scenario: XDriveGalleryRendererTraceScenario,
): MediaItem {
  const slot = index % 20
  const forcedVideo = scenario.startsWith('video-')
  const kind = forcedVideo
    ? 'video'
    : scenario.startsWith('live-')
      ? 'live_photo'
      : slot < 14 ? 'image' : slot < 17 ? 'video' : 'live_photo'
  const sequence = String(index + 1).padStart(6, '0')
  const video = kind === 'video'
  const live = kind === 'live_photo'
  return {
    node: {
      id: index + 1,
      name: video
        ? `clip-${sequence}.${forcedVideo ? 'webm' : 'mp4'}`
        : live
          ? `live-${sequence}.jpg`
          : `photo-${sequence}.jpg`,
      type: 'file',
      size: video ? 20 * 1024 * 1024 : 5 * 1024 * 1024,
      revision: 1,
      created_at: new Date(capturedBase - index * 60_000).toISOString(),
      updated_at: new Date(capturedBase - index * 60_000).toISOString(),
    },
    metadata: {
      media_kind: video ? 'video' : 'image',
      mime_type: video ? (forcedVideo ? 'video/webm' : 'video/mp4') : 'image/jpeg',
      width: video ? 1920 : 4032,
      height: video ? 1080 : 3024,
      duration_ms: video ? 120_000 : 0,
      captured_at: new Date(capturedBase - index * 60_000).toISOString(),
      index_state: 'ready',
      has_thumbnail: !video,
      thumbnail_mime_type: !video ? 'image/jpeg' : undefined,
      thumbnail_width: !video ? 512 : undefined,
      thumbnail_height: !video ? 384 : undefined,
    },
    asset_kind: kind,
    live_photo: live,
    favorite: false,
    tags: [],
    people: [],
  }
}

function rangeFor(
  limit: number,
  offset: number,
  scenario: XDriveGalleryRendererTraceScenario,
): MediaItemRange {
  const boundedOffset = Math.max(0, Math.min(logicalItems, Math.trunc(offset)))
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
  const end = Math.min(logicalItems, boundedOffset + boundedLimit)
  const items = Array.from(
    { length: Math.max(0, end - boundedOffset) },
    (_, index) => mediaItemForIndex(boundedOffset + index, scenario),
  )
  return {
    items,
    total_count: logicalItems,
    offset: boundedOffset,
    limit: boundedLimit,
  }
}

async function createFixtureJPEG() {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1200
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Gallery performance canvas is unavailable.')
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#263238')
  gradient.addColorStop(0.45, '#607d8b')
  gradient.addColorStop(1, '#cfd8dc')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 16; column += 1) {
      const hue = (row * 31 + column * 17) % 360
      context.fillStyle = `hsla(${hue}, 68%, 56%, 0.55)`
      context.fillRect(column * 100 + 8, row * 100 + 8, 84, 84)
    }
  }
  context.fillStyle = 'rgba(255,255,255,.9)'
  context.font = '700 88px sans-serif'
  context.fillText('xDrive Gallery 100k', 140, 1080)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.88)
  })
  if (!blob) throw new Error('Gallery performance JPEG generation failed.')
  return blob
}

async function createFixtureVideo() {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Gallery performance MediaRecorder is unavailable.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Gallery performance video canvas is unavailable.')
  const stream = canvas.captureStream(24)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm'
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, { mimeType })
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('error', () => reject(new Error('Gallery performance video recording failed.')), { once: true })
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
      if (blob.size < 1) reject(new Error('Gallery performance video fixture is empty.'))
      else resolve(blob)
    }, { once: true })
  })
  recorder.start()
  for (let frame = 0; frame < 6; frame += 1) {
    context.fillStyle = `hsl(${frame * 55} 65% 48%)`
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fff'
    context.font = '700 18px sans-serif'
    context.fillText(`xD ${frame + 1}`, 18, 38)
    await wait(35)
  }
  recorder.stop()
  try {
    return await stopped
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

async function decodeURL(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
}

function GalleryRendererTrace({
  scenario,
  imageFixture,
  videoFixture,
  warmURL,
  preparation,
}: {
  scenario: XDriveGalleryRendererTraceScenario
  imageFixture: Blob
  videoFixture: Blob
  warmURL: string | null
  preparation: GalleryTracePreparation
}) {
  const startedAtRef = useRef(performance.now())
  const markersRef = useRef({
    rangeRequest: Number.NaN,
    rangeResolved: Number.NaN,
    gridCommitted: Number.NaN,
    thumbnailRequest: Number.NaN,
    thumbnailResolved: Number.NaN,
    mediaRequest: Number.NaN,
    mediaResolved: Number.NaN,
    imageMounted: Number.NaN,
    imageDecoded: Number.NaN,
    imagePainted: Number.NaN,
  })
  const completedRef = useRef(false)
  const firstRangeRef = useRef(true)
  const longTaskEntriesRef = useRef<XDriveGalleryPerformanceLongTask[]>([])
  const cold = scenario.endsWith('-cold')
  const videoScenario = scenario.startsWith('video-')
  const thumbnailDelay = cold ? coldThumbnailDelayMs : warmThumbnailDelayMs
  const previewDelay = cold ? coldPreviewDelayMs : warmPreviewDelayMs

  const elapsed = useMemo(
    () => () => performance.now() - startedAtRef.current,
    [],
  )

  const source = useMemo<MediaGalleryDataSource>(() => ({
    listItems: async (limit, offset) => rangeFor(limit, offset, scenario).items,
    listItemRange: async (limit, offset) => {
      if (firstRangeRef.current) {
        firstRangeRef.current = false
        markersRef.current.rangeRequest = elapsed()
        await wait(rangeDelayMs)
        markersRef.current.rangeResolved = elapsed()
      }
      return rangeFor(limit, offset, scenario)
    },
    listAlbums: async () => {
      await wait(facetDelayMs)
      return []
    },
    listAlbumItems: async (_albumID, limit, offset) => rangeFor(limit, offset, scenario).items,
    listAlbumItemRange: async (_albumID, limit, offset) => rangeFor(limit, offset, scenario),
    loadThumbnail: async () => {
      if (!Number.isFinite(markersRef.current.thumbnailRequest)) {
        markersRef.current.thumbnailRequest = elapsed()
      }
      if (!Number.isFinite(markersRef.current.mediaRequest)) {
        markersRef.current.mediaRequest = elapsed()
      }
      await wait(thumbnailDelay)
      if (!Number.isFinite(markersRef.current.thumbnailResolved)) {
        markersRef.current.thumbnailResolved = elapsed()
      }
      if (!Number.isFinite(markersRef.current.mediaResolved)) {
        markersRef.current.mediaResolved = elapsed()
      }
      if (warmURL) return warmURL
      return URL.createObjectURL(imageFixture)
    },
    ...(videoScenario ? {
      loadPreviewURL: async () => {
        if (!Number.isFinite(markersRef.current.mediaRequest)) {
          markersRef.current.mediaRequest = elapsed()
        }
        await wait(previewDelay)
        if (!Number.isFinite(markersRef.current.mediaResolved)) {
          markersRef.current.mediaResolved = elapsed()
        }
        return URL.createObjectURL(videoFixture)
      },
    } : {}),
  }), [
    elapsed,
    imageFixture,
    previewDelay,
    scenario,
    thumbnailDelay,
    videoFixture,
    videoScenario,
    warmURL,
  ])

  useEffect(() => {
    let disposed = false
    let checking = false
    let observer: MutationObserver | null = null
    let longTaskObserver: PerformanceObserver | null = null

    const recordLongTasks = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        longTaskEntriesRef.current.push({ startTime: entry.startTime, duration: entry.duration })
      }
    }

    try {
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        longTaskObserver = new PerformanceObserver((entries) => {
          recordLongTasks(entries.getEntries())
        })
        longTaskObserver.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
      }
    } catch {
      longTaskObserver = null
    }

    const sample = async () => {
      if (disposed || completedRef.current || checking) return
      const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
      if (
        grid &&
        Number.isFinite(markersRef.current.rangeResolved) &&
        grid.querySelector('[role="button"]') &&
        !Number.isFinite(markersRef.current.gridCommitted)
      ) {
        markersRef.current.gridCommitted = elapsed()
      }
      const image = grid?.querySelector('img') as HTMLImageElement | null
      if (!image) return
      checking = true
      try {
        if (!Number.isFinite(markersRef.current.imageMounted)) {
          markersRef.current.imageMounted = elapsed()
        }
        await image.decode()
        if (disposed || completedRef.current) return
        markersRef.current.imageDecoded = elapsed()
        await waitFrames(2)
        if (disposed || completedRef.current) return
        const bounds = image.getBoundingClientRect()
        if (bounds.width < 1 || bounds.height < 1) {
          throw new Error('First Gallery performance image is decoded but not visible.')
        }
        markersRef.current.imagePainted = elapsed()
        completedRef.current = true
        recordLongTasks(longTaskObserver?.takeRecords() ?? [])

        const markers = markersRef.current
        const memory = (performance as Performance & {
          memory?: { usedJSHeapSize?: number }
        }).memory
        const result: XDriveGalleryRendererTraceResult = {
          synthetic: true,
          scenario,
          logicalItems,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          replayedRangeDelayMs: rangeDelayMs,
          replayedThumbnailDelayMs: videoScenario ? 0 : thumbnailDelay,
          replayedPreviewDelayMs: videoScenario ? previewDelay : 0,
          mediaFirstRequestMs: markers.mediaRequest,
          mediaFirstResolvedMs: markers.mediaResolved,
          rangeRequestMs: markers.rangeRequest,
          rangeResolvedMs: markers.rangeResolved,
          gridCommittedMs: markers.gridCommitted,
          thumbnailFirstRequestMs: markers.thumbnailRequest,
          thumbnailFirstResolvedMs: markers.thumbnailResolved,
          firstImageMountedMs: markers.imageMounted,
          firstImageDecodedMs: markers.imageDecoded,
          firstImagePaintedMs: markers.imagePainted,
          rangeToGridCommitMs: markers.gridCommitted - markers.rangeResolved,
          gridCommitToThumbnailRequestMs: markers.thumbnailRequest - markers.gridCommitted,
          gridCommitToMediaRequestMs: markers.mediaRequest - markers.gridCommitted,
          gridCommitToFirstImageMountMs: markers.imageMounted - markers.gridCommitted,
          thumbnailResolvedToImageMountMs: markers.imageMounted - markers.thumbnailResolved,
          thumbnailResolvedToDecodeMs: markers.imageDecoded - markers.thumbnailResolved,
          mediaResolvedToImageMountMs: markers.imageMounted - markers.mediaResolved,
          mediaResolvedToDecodeMs: markers.imageDecoded - markers.mediaResolved,
          decodedToPaintMs: markers.imagePainted - markers.imageDecoded,
          rangeToFirstPaintMs: markers.imagePainted - markers.rangeResolved,
          routeToFirstPaintMs: markers.imagePainted,
          presentationProxy: 'two-rAF',
          longTaskObservationSupported: Boolean(longTaskObserver),
          rangeToFirstImageDecodeMs: markers.imageDecoded - markers.rangeResolved,
          routeToFirstImageDecodeMs: markers.imageDecoded,
          fixturePreparationMs: preparation.readyAt - preparation.startedAt,
          jpegFixtureMs: preparation.jpegFixtureMs,
          videoFixtureMs: preparation.videoFixtureMs,
          warmMediaPreparationMs: preparation.warmMediaPreparationMs,
          preparationToActivationMs: startedAtRef.current - preparation.readyAt,
          mountedImages: grid?.querySelectorAll('img').length ?? 0,
          placeholders: grid?.querySelectorAll('[data-xdrive-media-gallery-placeholder]').length ?? 0,
          ...xDriveGalleryPerformanceLongTaskAttribution(
            longTaskEntriesRef.current,
            startedAtRef.current,
            startedAtRef.current + markers.imagePainted,
          ),
          usedJSHeapSize: memory?.usedJSHeapSize ?? null,
        }
        window.__xdriveGalleryPerfResult = result
        console.info('__XDRIVE_GALLERY_PERF_RESULT__' + JSON.stringify(result))
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.stack || error.message : String(error)
          window.__xdriveGalleryPerfError = message
          console.error('__XDRIVE_GALLERY_PERF_ERROR__' + message)
        }
      } finally {
        checking = false
      }
    }

    observer = new MutationObserver(() => { void sample() })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    void sample()
    return () => {
      disposed = true
      observer?.disconnect()
      longTaskObserver?.disconnect()
    }
  }, [elapsed, previewDelay, scenario, thumbnailDelay, videoScenario])

  return (
    <Box sx={{ width: '100vw', height: '100vh', overflow: 'auto', bgcolor: 'background.default' }}>
      <XDriveMediaGalleryPage source={source} pageSize={pageSize} initialSection="library" />
    </Box>
  )
}

export function XDriveGalleryPerformanceHarness({
  scenario,
}: {
  scenario: XDriveGalleryRendererTraceScenario
}): ReactElement {
  const [fixture, setFixture] = useState<{
    image: Blob
    video: Blob
    warmURL: string | null
    preparation: GalleryTracePreparation
  } | null>(null)

  useEffect(() => {
    let active = true
    let warmURL: string | null = null
    const preparation: GalleryTracePreparation = {
      startedAt: performance.now(),
      readyAt: Number.NaN,
      jpegFixtureMs: Number.NaN,
      videoFixtureMs: Number.NaN,
      warmMediaPreparationMs: 0,
    }
    const jpegStartedAt = performance.now()
    const imagePromise = createFixtureJPEG().then((image) => {
      preparation.jpegFixtureMs = performance.now() - jpegStartedAt
      return image
    })
    const videoStartedAt = performance.now()
    const videoPromise = createFixtureVideo().then((video) => {
      preparation.videoFixtureMs = performance.now() - videoStartedAt
      return video
    })
    void Promise.all([imagePromise, videoPromise])
      .then(async ([image, video]) => {
        const warmStartedAt = performance.now()
        if (scenario === 'image-warm' || scenario === 'live-warm') {
          warmURL = URL.createObjectURL(image)
          await decodeURL(warmURL)
        }
        if (scenario === 'video-warm') {
          const source = URL.createObjectURL(video)
          try {
            await xDriveCaptureVideoPosterBlob(source, 0, 96, 64, 512)
          } finally {
            URL.revokeObjectURL(source)
          }
        }
        preparation.warmMediaPreparationMs = scenario.endsWith('-warm')
          ? performance.now() - warmStartedAt
          : 0
        preparation.readyAt = performance.now()
        if (active) setFixture({ image, video, warmURL, preparation })
        else if (warmURL) URL.revokeObjectURL(warmURL)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error)
        window.__xdriveGalleryPerfError = message
      })
    return () => {
      active = false
      if (warmURL) URL.revokeObjectURL(warmURL)
    }
  }, [scenario])

  if (!fixture) return <Box sx={{ width: '100vw', height: '100vh' }} />
  return (
    <GalleryRendererTrace
      scenario={scenario}
      imageFixture={fixture.image}
      videoFixture={fixture.video}
      warmURL={fixture.warmURL}
      preparation={fixture.preparation}
    />
  )
}
