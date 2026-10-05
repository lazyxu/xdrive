import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image as ImageIcon,
  Movie as MovieIcon,
} from '@mui/icons-material'
import { Box, CircularProgress } from '@mui/material'
import type { MediaMetadata } from '../models'

type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>
type MediaPreviewURLLoader = (
  nodeID: number,
  kind: 'image' | 'video',
) => Promise<string | null>

function revokeIfBlob(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export function XDriveMediaAsyncThumbnail({
  nodeID,
  alt,
  loadThumbnail,
  fallback,
}: {
  nodeID?: number
  alt: string
  loadThumbnail: MediaThumbnailLoader
  fallback: ReactNode
}) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let resolved = ''
    setSrc('')
    setFailed(false)
    if (!nodeID) return () => undefined

    void loadThumbnail(nodeID)
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        resolved = value
        if (active) setSrc(value)
        else revokeIfBlob(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (resolved) revokeIfBlob(resolved)
    }
  }, [loadThumbnail, nodeID])

  if (!nodeID || failed) return <>{fallback}</>
  if (!src) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      loading="lazy"
      sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
    />
  )
}

const mediaPosterConcurrency = 3
let mediaPosterActive = 0
const mediaPosterQueue: Array<() => void> = []

function scheduleMediaPoster<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      mediaPosterActive += 1
      void task()
        .then(resolve, reject)
        .finally(() => {
          mediaPosterActive = Math.max(0, mediaPosterActive - 1)
          mediaPosterQueue.shift()?.()
        })
    }
    if (mediaPosterActive < mediaPosterConcurrency) run()
    else mediaPosterQueue.push(run)
  })
}

async function captureVideoPoster(
  nodeID: number,
  loadPreviewURL: MediaPreviewURLLoader,
): Promise<string | null> {
  const source = await loadPreviewURL(nodeID, 'video')
  if (!source) return null

  return new Promise<string | null>((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      revokeIfBlob(source)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 15_000)

    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadeddata', () => {
      try {
        if (video.videoWidth < 1 || video.videoHeight < 1) {
          finish(null)
          return
        }
        const maxEdge = 512
        const scale = Math.min(
          1,
          maxEdge / Math.max(video.videoWidth, video.videoHeight),
        )
        const width = Math.max(1, Math.round(video.videoWidth * scale))
        const height = Math.max(1, Math.round(video.videoHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          finish(null)
          return
        }
        context.drawImage(video, 0, 0, width, height)
        finish(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        finish(null)
      }
    }, { once: true })
    video.addEventListener('error', () => finish(null), { once: true })
    video.src = source
    video.load()
  })
}

export function XDriveMediaAsyncVideoPoster({
  nodeID,
  alt,
  loadPreviewURL,
  fallback,
}: {
  nodeID: number
  alt: string
  loadPreviewURL: MediaPreviewURLLoader
  fallback: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState('')

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
    let active = true
    setSrc('')
    if (!visible) return () => { active = false }

    void scheduleMediaPoster(() => captureVideoPoster(nodeID, loadPreviewURL))
      .then((value) => {
        if (active && value) setSrc(value)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [loadPreviewURL, nodeID, visible])

  return (
    <Box ref={rootRef} sx={{ width: '100%', height: '100%' }}>
      {src ? (
        <Box
          component="img"
          src={src}
          alt={alt}
          sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : (
        fallback
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

