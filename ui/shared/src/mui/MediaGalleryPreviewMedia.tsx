import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image as ImageIcon,
  Movie as MovieIcon,
} from '@mui/icons-material'
import { Box, Skeleton } from '@mui/material'
import type { XDriveByteProgressHandler } from '../file-preview'
import { XDriveMediaLoadingProgress } from './MediaLoadProgress'
import type { XDriveMediaLoadStage } from './MediaLoadProgress'
import type { MediaMetadata } from '../models'
import { xDriveCaptureVideoPosterBlob, xDriveResolveMediaVideoPoster } from './MediaGalleryVideoPoster'

type MediaThumbnailLoader = (nodeID: number, signal?: AbortSignal, revision?: number, onProgress?: XDriveByteProgressHandler, bypassHTTPCache?: boolean) => Promise<string | null>
type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video',
  signal?: AbortSignal,
) => Promise<string | null>
type MediaVideoPosterSaver = (nodeID: number, revision: number, poster: Blob, signal?: AbortSignal) => Promise<void>

/** Context belongs to the background Gallery, not to the active Viewer.
 * Switching to Viewer cancels old tile and poster reads, but never changes
 * signed Owner preview tickets or Task Center transfers. */
export const XDriveBackgroundMediaThumbnailSuspended = createContext(false)

function revokeIfBlob(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export function XDriveMediaAsyncThumbnail({
  nodeID,
  revision,
  alt,
  loadThumbnail,
  fallback,
  revokeOnDispose = true,
  onImageReadyChange,
  onImageDecodeError,
}: {
  nodeID?: number
  revision?: number
  alt: string
  loadThumbnail: MediaThumbnailLoader
  fallback: ReactNode
  revokeOnDispose?: boolean
  onImageReadyChange?: (ready: boolean) => void
  onImageDecodeError?: (failedURL: string) => void
}) {
  const suspended = useContext(XDriveBackgroundMediaThumbnailSuspended)
  const sourceIdentity = [nodeID ?? 0, revision ?? 0].join(':')
  // Node ID + revision alone do not identify the authorized Owner when a
  // shared Viewer tile is rebound to a different authenticated Host loader.
  // This gate takes effect during render, before passive cleanup can run.
  const sourceOwner = useMemo(() => ({}), [loadThumbnail])
  const [image, setImage] = useState<{ identity: string; owner: object; url: string } | null>(null)
  const [failedIdentity, setFailedIdentity] = useState<{ identity: string; owner: object } | null>(null)
  // Former Owner stills/failures must never paint under an identical Node ID
  // and revision while a new Owner's independent thumbnail is pending.
  const src = image?.identity === sourceIdentity && image.owner === sourceOwner ? image.url : ''
  const failed = failedIdentity?.identity === sourceIdentity && failedIdentity.owner === sourceOwner
  const presentedImageRef = useRef<{ identity: string; owner: object; url: string } | null>(null)
  presentedImageRef.current = !failed && src ? { identity: sourceIdentity, owner: sourceOwner, url: src } : null
  useEffect(() => () => { presentedImageRef.current = null }, [])
  const [progress, setProgress] = useState<{ loadedBytes: number; totalBytes?: number; alphaMask?: string | null }>({ loadedBytes: 0, alphaMask: null })

  useEffect(() => {
    // Existing decoded frame may remain underneath Viewer. Do not acquire a
    // new HTTP thumbnail or mark a cancellation as a permanent decode error.
    if (suspended) return
    let active = true
    let resolved = ''
    setImage(null)
    setFailedIdentity(null)
    setProgress({ loadedBytes: 0, alphaMask: null })
    onImageReadyChange?.(false)
    if (!nodeID) return () => undefined
    const controller = new AbortController()

    void loadThumbnail(nodeID, controller.signal, revision, (loadedBytes, totalBytes, alphaMask) => {
      if (active && !controller.signal.aborted) setProgress({ loadedBytes, totalBytes, alphaMask: alphaMask ?? null })
    })
      .then((value) => {
        if (!value) {
          if (active) setFailedIdentity({ identity: sourceIdentity, owner: sourceOwner })
          return
        }
        resolved = value
        if (active) setImage({ identity: sourceIdentity, owner: sourceOwner, url: value })
        else if (revokeOnDispose) revokeIfBlob(value)
      })
      .catch(() => {
        if (active) setFailedIdentity({ identity: sourceIdentity, owner: sourceOwner })
      })

    return () => {
      active = false
      controller.abort()
      if (resolved && revokeOnDispose) revokeIfBlob(resolved)
    }
  }, [loadThumbnail, nodeID, revision, revokeOnDispose, onImageReadyChange, sourceIdentity, sourceOwner, suspended])

  if (!nodeID || failed) return <>{fallback}</>
  if (!src) {
    return (
      <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
        <Skeleton variant="rectangular" animation={false} width="100%" height="100%" sx={{ borderRadius: 0 }} />
        <XDriveMediaLoadingProgress compact stage="transfer" {...progress} />
      </Box>
    )
  }
  return (
    <Box
      key={[sourceIdentity, src].join('|')}
      component="img"
      src={src}
      alt={alt}
      loading="lazy"
      // Fetch/Blob success does not prove that the browser can decode the image.
      // A broken source must leave the spinner/image and show the ordinary
      // Gallery fallback without retrying or fetching full original bytes.
      onLoad={(event) => {
        const displayed = presentedImageRef.current
        if (!displayed || displayed.identity !== sourceIdentity || displayed.owner !== sourceOwner || displayed.url !== src) return
        if (event.currentTarget.naturalWidth > 0) onImageReadyChange?.(true)
      }}
      onError={() => {
        const displayed = presentedImageRef.current
        if (!displayed || displayed.identity !== sourceIdentity || displayed.owner !== sourceOwner || displayed.url !== src) return
        // A late decode error from a recycled Node/revision/URL cannot
        // replace the new still or invalidate a newer cached derivative.
        presentedImageRef.current = null
        onImageReadyChange?.(false)
        // Never retry here or load original bytes. A later visible mount
        // may request the current derivative through the existing adapter.
        onImageDecodeError?.(src)
        setFailedIdentity({ identity: sourceIdentity, owner: sourceOwner })
      }}
      sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
    />
  )
}

const mediaPosterConcurrency = 3

type MediaPosterQueueEntry = {
  task: (signal: AbortSignal) => Promise<string | null>
  controller: AbortController
  resolve: (value: string | null) => void
  reject: (error: unknown) => void
  started: boolean
  cancelled: boolean
}

type ScheduledMediaPoster = {
  promise: Promise<string | null>
  cancel: () => void
}

let mediaPosterActive = 0
const mediaPosterQueue: MediaPosterQueueEntry[] = []

function pumpMediaPosterQueue() {
  while (mediaPosterActive < mediaPosterConcurrency && mediaPosterQueue.length > 0) {
    const entry = mediaPosterQueue.shift()!
    if (entry.cancelled) continue
    entry.started = true
    mediaPosterActive += 1
    void entry.task(entry.controller.signal)
      .then((value) => {
        if (entry.cancelled) {
          if (value) revokeIfBlob(value)
          return
        }
        entry.resolve(value)
      }, (error) => {
        if (!entry.cancelled) entry.reject(error)
      })
      .finally(() => {
        mediaPosterActive = Math.max(0, mediaPosterActive - 1)
        pumpMediaPosterQueue()
      })
  }
}

function scheduleMediaPoster(
  task: (signal: AbortSignal) => Promise<string | null>,
): ScheduledMediaPoster {
  let entry!: MediaPosterQueueEntry
  const promise = new Promise<string | null>((resolve, reject) => {
    entry = {
      task,
      controller: new AbortController(),
      resolve,
      reject,
      started: false,
      cancelled: false,
    }
    mediaPosterQueue.push(entry)
    pumpMediaPosterQueue()
  })
  return {
    promise,
    cancel: () => {
      if (entry.cancelled) return
      entry.cancelled = true
      entry.controller.abort()
      if (!entry.started) {
        const index = mediaPosterQueue.indexOf(entry)
        if (index >= 0) mediaPosterQueue.splice(index, 1)
      }
      entry.resolve(null)
    },
  }
}

async function captureVideoPoster(
  nodeID: number,
  loadPreviewURL: MediaPreviewURLLoader,
  rotationDegrees = 0,
  sourceWidth = 0,
  sourceHeight = 0,
  signal?: AbortSignal,
  onCapturing?: () => void,
): Promise<Blob | null> {
  if (signal?.aborted) return null
  const source = await loadPreviewURL(nodeID, 'video', signal)
  if (!source) return null
  try {
    if (signal?.aborted) return null
    onCapturing?.()
    return await xDriveCaptureVideoPosterBlob(
      source,
      rotationDegrees,
      sourceWidth,
      sourceHeight,
      512,
      signal,
    )
  } finally {
    revokeIfBlob(source)
  }
}

export function XDriveMediaAsyncVideoPoster({
  nodeID,
  alt,
  loadPreviewURL,
  loadThumbnail,
  saveVideoPoster,
  revision,
  fallback,
  rotationDegrees = 0,
  sourceWidth = 0,
  sourceHeight = 0,
}: {
  nodeID: number
  alt: string
  loadPreviewURL: MediaPreviewURLLoader
  loadThumbnail: MediaThumbnailLoader
  saveVideoPoster?: MediaVideoPosterSaver
  revision: number
  fallback: ReactNode
  rotationDegrees?: number
  sourceWidth?: number
  sourceHeight?: number
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const suspended = useContext(XDriveBackgroundMediaThumbnailSuspended)
  const [visible, setVisible] = useState(false)
  const posterIdentity = `${nodeID}:${revision}`
  const currentPosterIdentityRef = useRef(posterIdentity)
  currentPosterIdentityRef.current = posterIdentity
  const [poster, setPoster] = useState<{ identity: string; url: string } | null>(null)
  const [failedIdentity, setFailedIdentity] = useState('')
  const src = poster?.identity === posterIdentity ? poster.url : ''
  const failed = failedIdentity === posterIdentity
  const [posterStage, setPosterStage] = useState<XDriveMediaLoadStage>('poster_lookup')
  const [posterProgress, setPosterProgress] = useState<{ loadedBytes: number; totalBytes?: number; alphaMask?: string | null }>({ loadedBytes: 0, alphaMask: null })

  useEffect(() => {
    setVisible(false)
    const root = rootRef.current
    if (!root) return () => undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return () => undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(root)
    return () => observer.disconnect()
  }, [nodeID])

  useEffect(() => {
    // Poster lookup, original video read and local capture all share the
    // existing cancelable task; none should compete with the active Viewer.
    if (suspended) return
    let active = true
    let resolved = ''
    setPoster(null)
    setFailedIdentity('')
    setPosterStage('poster_lookup')
    setPosterProgress({ loadedBytes: 0, alphaMask: null })
    if (!visible) return () => { active = false }

    const scheduled = scheduleMediaPoster((signal) => xDriveResolveMediaVideoPoster({
      nodeID,
      revision,
      loadCached: loadThumbnail,
      save: saveVideoPoster,
      signal,
      onStage: (stage) => { if (active) setPosterStage(stage) },
      onProgress: (loadedBytes, totalBytes, alphaMask) => {
        if (active) setPosterProgress({ loadedBytes, totalBytes, alphaMask: alphaMask ?? null })
      },
      capture: (signal, onCapturing) => captureVideoPoster(
        nodeID, loadPreviewURL, rotationDegrees, sourceWidth, sourceHeight,
        signal, onCapturing,
      ),
    }))
    void scheduled.promise
      .then((value) => {
        if (!value) {
          if (active) setFailedIdentity(posterIdentity)
          return
        }
        resolved = value
        if (active) setPoster({ identity: posterIdentity, url: value })
        else revokeIfBlob(value)
      })
      .catch(() => {
        if (active) setFailedIdentity(posterIdentity)
      })

    return () => {
      active = false
      scheduled.cancel()
      if (resolved) revokeIfBlob(resolved)
    }
  }, [
    loadPreviewURL,
    loadThumbnail,
    saveVideoPoster,
    revision,
    posterIdentity,
    nodeID,
    rotationDegrees,
    sourceHeight,
    sourceWidth,
    visible,
    suspended,
  ])

  return (
    <Box ref={rootRef} sx={{ width: '100%', height: '100%' }}>
      {src && !failed ? (
        <Box
          component="img"
          src={src}
          alt={alt}
          onError={() => {
            // Late failure from a replaced video poster cannot hide the new one.
            if (currentPosterIdentityRef.current === posterIdentity) {
              setFailedIdentity(posterIdentity)
            }
          }}
          sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : (
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
          {fallback}
          {visible && !failed ? <XDriveMediaLoadingProgress compact stage={posterStage} {...posterProgress} /> : null}
        </Box>
      )}
    </Box>
  )
}

export function xDriveMediaFallback(kind: MediaMetadata['media_kind']) {
  const Icon = kind === 'video' ? MovieIcon : ImageIcon
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: 'text.secondary',
        bgcolor: 'action.hover',
      }}
    >
      <Icon sx={{ fontSize: 42 }} />
    </Box>
  )
}

