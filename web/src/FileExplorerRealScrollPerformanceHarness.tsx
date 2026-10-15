import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import {
  XDriveFileExplorer,
  type XDriveFileExplorerItem,
  type XDriveFileExplorerVirtualCollection,
  type XDriveFileExplorerViewMode,
} from '@xdrive/ui/mui'

type RealFileExplorerConfig = {
  token: string
  folder_id: number
  logical_count?: number
  physical_images?: number
  logical_assets?: number
  physical_nodes?: number
  physical_sources?: number
  live_photo_groups?: number
  physical_verified?: number
  physical_bytes?: number
  seed_ms: number
}

type NodeDTO = {
  id: number
  name: string
  type: 'file' | 'dir'
  size: number
  revision: number
  updated_at: string
}

type ChildrenPage = {
  items: NodeDTO[]
  total_count: number
  offset: number
  limit: number
}

declare global {
  interface Window {
    __xdriveFileExplorerRealScrollError?: string
    __xdriveFileExplorerMixedPosterStats?: MixedPosterStats
  }
}

const pageSize = 200
const sort = { key: 'name' as const, direction: 'asc' as const }
const viewMode: XDriveFileExplorerViewMode = new URLSearchParams(window.location.search)
  .get('xdriveFileExplorerViewMode') === 'details' ? 'details' : 'grid'
const physical100k = new URLSearchParams(window.location.search)
  .get('xdriveFileExplorerPhysical100k') === '1'
const mixed100k = new URLSearchParams(window.location.search)
  .get('xdriveFileExplorerMixed100k') === '1'

type MixedPosterStats = {
  coldVideoPoster404: number
  previewTickets: number
  signedVideoBytes: number
  realDecodedFrames: number
  posterPuts: number
  posterPutBytes: number
  posterReadbacks: number
  errors: number
}
const mixedPosterStats: MixedPosterStats = {
  coldVideoPoster404: 0, previewTickets: 0, signedVideoBytes: 0,
  realDecodedFrames: 0, posterPuts: 0, posterPutBytes: 0,
  posterReadbacks: 0, errors: 0,
}
if (mixed100k) window.__xdriveFileExplorerMixedPosterStats = mixedPosterStats

// Branch-only P049: a cold video thumbnail legitimately returns HTTP404
// until a real Chromium decoded H264 source frame has been saved through
// the production signed preview-ticket -> video-poster CAS PUT endpoints.
// Do not synthesize JPEG pixels or bypass the Server's revision/owner check.
async function captureMixedPosterFromRealVideo(
  item: XDriveFileExplorerItem, token: string, signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted()
  const headers = { Authorization: 'Bearer ' + token }
  const ticketResponse = await fetch('/api/v1/files/' + item.id + '/preview-ticket', {
    method: 'POST', headers, signal, cache: 'no-store',
  })
  if (!ticketResponse.ok) throw new Error('real video preview ticket HTTP ' + ticketResponse.status)
  const ticket = await ticketResponse.json() as { kind?: string; url?: string }
  if (ticket.kind !== 'video' || typeof ticket.url !== 'string') {
    throw new Error('invalid signed video preview ticket')
  }
  const ticketURL = new URL(ticket.url, window.location.origin)
  if (ticketURL.origin !== window.location.origin ||
      ticketURL.pathname !== '/api/v1/file-preview/' + item.id ||
      !ticketURL.searchParams.has('ticket')) {
    throw new Error('untrusted video preview URL')
  }
  mixedPosterStats.previewTickets++
  const originalResponse = await fetch(ticketURL.href, { signal, cache: 'no-store' })
  if (!originalResponse.ok) throw new Error('real signed H264 source HTTP ' + originalResponse.status)
  const original = await originalResponse.arrayBuffer()
  if (original.byteLength < 1_000) throw new Error('real physical MP4 original was empty')
  mixedPosterStats.signedVideoBytes += original.byteLength
  signal?.throwIfAborted()

  // The fixture has genuine MP4/H264 bytes, including for a .mov-named
  // Live motion resource. Normalize only the browser Blob MIME, not bytes.
  const url = URL.createObjectURL(new Blob([original], { type: 'video/mp4' }))
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.muted = true
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        signal?.removeEventListener('abort', aborted)
        video.removeEventListener('loadeddata', ready)
        video.removeEventListener('error', failed)
        if (error) reject(error)
        else resolve()
      }
      const aborted = () => finish(new DOMException('video poster was canceled', 'AbortError'))
      const ready = () => finish()
      const failed = () => finish(new Error('real Chromium H264 decoder could not decode source'))
      const timeout = window.setTimeout(
        () => finish(new Error('real Chromium H264 frame decode exceeded 8 seconds')), 8_000,
      )
      signal?.addEventListener('abort', aborted, { once: true })
      video.addEventListener('loadeddata', ready, { once: true })
      video.addEventListener('error', failed, { once: true })
      if (signal?.aborted) { aborted(); return }
      video.src = url
      video.load()
    })
    signal?.throwIfAborted()
    if (video.videoWidth < 1 || video.videoHeight < 1) {
      throw new Error('real H264 decoder returned no frame pixels')
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(256, video.videoWidth)
    canvas.height = Math.min(256, video.videoHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no real H264 frame canvas')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const poster = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) :
        reject(new Error('Chromium could not encode decoded H264 frame')), 'image/jpeg', 0.88)
    })
    if (poster.size < 100 || poster.type !== 'image/jpeg') {
      throw new Error('real captured H264 JPEG poster envelope invalid')
    }
    signal?.throwIfAborted()
    mixedPosterStats.realDecodedFrames++
    return poster
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

// Opt-in benchmark only. Uses the actual shared FileExplorer and thumbnail
// scheduler with real signed Gin/PG17/CAS HTTP; no production data adapter.
export function XDriveFileExplorerRealScrollPerformanceHarness() {
  const [config, setConfig] = useState<RealFileExplorerConfig | null>(null)
  const [loadedItems, setLoadedItems] = useState<ReadonlyMap<number, XDriveFileExplorerItem>>(
    () => new Map(),
  )
  const rangeKeyRef = useRef('')
  const rangeAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/__perf/config', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('real FileExplorer config HTTP ' + response.status)
        return response.json() as Promise<RealFileExplorerConfig>
      })
      .then((next) => {
        if (mixed100k) {
          if (next.logical_assets !== 100_000 || next.physical_nodes !== 115_000 ||
              next.physical_sources !== 115_000 || next.live_photo_groups !== 15_000 ||
              next.physical_verified !== 12 || !Number.isSafeInteger(next.folder_id) ||
              next.folder_id <= 0 || (next.physical_bytes ?? 0) <= 100_000_000) {
            throw new Error('invalid real 115k physical JPEG H264 Live fixture')
          }
        } else if (next.logical_count !== 100_000 || next.physical_images !== (physical100k ? 100_000 : 16)) {
          throw new Error('invalid real 100k FileExplorer fixture shape')
        }
        setConfig(next)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          window.__xdriveFileExplorerRealScrollError = String(error)
        }
      })
    return () => {
      controller.abort()
      rangeAbortRef.current?.abort()
    }
  }, [])

  const onRangeChange = useCallback((start: number, end: number) => {
    if (!config || end <= start) return
    const firstPage = Math.floor(start / pageSize)
    const lastPage = Math.floor((end - 1) / pageSize)
    const key = firstPage + ':' + lastPage
    if (rangeKeyRef.current === key) return
    rangeKeyRef.current = key
    rangeAbortRef.current?.abort()
    const controller = new AbortController()
    rangeAbortRef.current = controller
    const headers = { Authorization: 'Bearer ' + config.token }
    const offsets = Array.from(
      { length: Math.min(6, lastPage - firstPage + 1) },
      (_unused, index) => (firstPage + index) * pageSize,
    )
    void Promise.all(offsets.map(async (offset) => {
      const response = await fetch(
        '/api/v1/nodes/' + config.folder_id +
          '/children?offset=' + offset + '&limit=' + pageSize + '&sort=name&order=asc',
        { headers, signal: controller.signal, cache: 'no-store' },
      )
      if (!response.ok) throw new Error('real FileExplorer 100k range HTTP ' + response.status)
      const page = await response.json() as ChildrenPage
      if (page.total_count !== (mixed100k ? config.physical_nodes : config.logical_count) || page.offset !== offset) {
        throw new Error('invalid real FileExplorer 100k range at ' + offset)
      }
      return page
    })).then((pages) => {
      if (controller.signal.aborted) return
      const next = new Map<number, XDriveFileExplorerItem>()
      for (const page of pages) {
        page.items.forEach((node, index) => {
          next.set(page.offset + index, {
            id: node.id,
            name: node.name,
            kind: node.type,
            fileKind: mixed100k && (node.name.startsWith('video-') || node.name.startsWith('live-motion-')) ? 'video' : 'image',
            thumbnailEligible: true,
            size: node.size,
            revision: node.revision,
            updatedAt: node.updated_at,
            path: (mixed100k ? '100k Browser Cold Gallery/' : '100k Images/') + node.name,
          })
        })
      }
      setLoadedItems(next)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        window.__xdriveFileExplorerRealScrollError = String(error)
      }
    })
  }, [config])

  const virtualCollection = useMemo<XDriveFileExplorerVirtualCollection>(() => ({
    interactionKey: mixed100k ? 'real-115k-mixed-physical-namespace' : 'real-100k-image-namespace',
    itemCount: (mixed100k ? config?.physical_nodes : config?.logical_count) ?? 0,
    loadedItems,
    itemAt: (index) => loadedItems.get(index),
    onRangeChange,
  }), [config, loadedItems, onRangeChange])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (!config || signal?.aborted) return null
    const headers = { Authorization: 'Bearer ' + config.token }
    const isVideo = mixed100k && (item.name.startsWith('video-') ||
      item.name.startsWith('live-motion-'))
    const thumbnailURL = '/api/v1/media/items/' + item.id + '/thumbnail' +
      (mixed100k ? '?revision=' + item.revision : '')
    let response = await fetch(thumbnailURL, { headers, signal, cache: 'no-store' })
    if (isVideo && response.status === 404) {
      mixedPosterStats.coldVideoPoster404++
      try {
        const realPoster = await captureMixedPosterFromRealVideo(item, config.token, signal)
        const stored = await fetch('/api/v1/media/items/' + item.id + '/video-poster', {
          method: 'PUT', headers: {
            ...headers, 'Content-Type': 'image/jpeg',
            'If-Match': '"' + item.revision + '"',
          },
          body: realPoster, signal, cache: 'no-store',
        })
        if (stored.status !== 204) throw new Error('real video poster CAS PUT HTTP ' + stored.status)
        mixedPosterStats.posterPuts++
        mixedPosterStats.posterPutBytes += realPoster.size
        response = await fetch(thumbnailURL, { headers, signal, cache: 'no-store' })
        if (response.ok) mixedPosterStats.posterReadbacks++
      } catch (error) {
        if (!signal?.aborted) mixedPosterStats.errors++
        throw error
      }
    }
    if (!response.ok) {
      if (isVideo && !signal?.aborted) mixedPosterStats.errors++
      throw new Error('real FileExplorer media thumbnail ' + item.id + ' HTTP ' + response.status)
    }
    const blob = await response.blob()
    if (signal?.aborted) return null
    if (blob.type !== 'image/jpeg' || blob.size < 100) {
      throw new Error('genuine media thumbnail was not a JPEG')
    }
    return URL.createObjectURL(blob)
  }, [config])

  return (
    <Box sx={{ width: '100vw', height: '100vh', boxSizing: 'border-box', p: 1, bgcolor: 'background.default' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">FileExplorer 100k real HTTP viewport</Typography>
        <Chip size="small" label={viewMode} />
        <Chip size="small" label="PostgreSQL + signed JPEG" variant="outlined" />
      </Stack>
      <Box sx={{ height: 'calc(100vh - 48px)', minHeight: 0 }}>
        <XDriveFileExplorer
          presentation="workspace"
          items={[]}
          crumbs={[{ id: config?.folder_id ?? 0, name: mixed100k ? '100k Browser Cold Gallery' : '100k Images' }]}
          pathValue={mixed100k ? '100k Browser Cold Gallery' : '100k Images'}
          viewMode={viewMode}
          onViewModeChange={() => {}}
          sort={sort}
          onSortChange={() => {}}
          externallySorted
          virtualCollection={virtualCollection}
          loadThumbnail={loadThumbnail}
          statusText={mixed100k ? '115,000 项' : '100,000 项'}
        />
      </Box>
    </Box>
  )
}
