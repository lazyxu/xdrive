import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { XDriveFilePreviewMediaTransform, XDriveFilePreviewPresentationState, XDriveFilePreviewTarget } from '../file-preview'
import { XDriveMediaLoadingProgress } from './MediaLoadProgress'
import type { XDrivePreviewImageDimensions } from '../file-preview-viewport'
import type { XDriveFilePreviewImageLoader, XDriveFilePreviewURLLoader } from './FilePreviewSurface'
import { XDriveTransformedImagePreview } from './FilePreviewTransformedMedia'

type ImageRole = 'original' | 'thumbnail'
type ImageSource = {
  url: string
  status: 'loading' | 'ready' | 'failed'
  // Role-specific attempt: generation alone cannot distinguish successive
  // original-only retries returning an identical signed URL.
  attempt: number
  image?: HTMLImageElement
}

const pendingImage = (attempt = 0): ImageSource => ({ url: '', status: 'loading', attempt })

// FilePreviewSurface keys its image children by Node/Owner revision. A
// cancelled loader from the detached child may finish after a *different*
// child's thumbnail has acquired the same Blob URL. Track active leases
// across these short-lived children, not just within one React component.
// Only active URL references are stored; no media bytes or long-lived cache.
const liveBlobImageLeases = new Map<string, number>()
const acquireBlobLease = (url: string) => {
  if (url.startsWith('blob:')) {
    liveBlobImageLeases.set(url, (liveBlobImageLeases.get(url) || 0) + 1)
  }
}
const retireBlobLease = (url: string) => {
  const count = liveBlobImageLeases.get(url)
  if (!count) return
  if (count === 1) liveBlobImageLeases.delete(url)
  else liveBlobImageLeases.set(url, count - 1)
}

/** Two bounded image layers; the very element we decode becomes the visible frame. */
export function XDriveDecodedImagePreview<T extends XDriveFilePreviewTarget>({
  target,
  kind,
  loadPreviewURL,
  loadImagePreview,
  fallback,
  imageFit,
  minHeight,
  viewportTransform,
  viewportTransition,
  mediaTransform,
  onPresentationStateChange,
  onImageDimensionsChange,
  children,
}: {
  target: T
  kind: 'image' | 'live_photo'
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  fallback: ReactNode
  imageFit: 'contain' | 'cover'
  minHeight: number
  viewportTransform?: string
  viewportTransition?: string
  mediaTransform?: XDriveFilePreviewMediaTransform
  onPresentationStateChange?: (state: XDriveFilePreviewPresentationState) => void
  onImageDimensionsChange?: (dimensions: XDrivePreviewImageDimensions | null) => void
  children?: (still: ReactNode, ready: boolean) => ReactNode
}) {
  const [sources, setSources] = useState<Record<ImageRole, ImageSource>>({
    original: pendingImage(), thumbnail: pendingImage(),
  })
  const [progress, setProgress] = useState<{ loadedBytes: number; totalBytes?: number }>({ loadedBytes: 0 })
  const [retryNonce, setRetryNonce] = useState(0)
  const sourceIdentity = JSON.stringify([target.id, target.revision, kind])
  // Capture the source AND attempt in each retry handler. A retained callback
  // must never restart the previous Node's authorized image request.
  const retrySourceRef = useRef({ identity: sourceIdentity })
  if (retrySourceRef.current.identity !== sourceIdentity) {
    retrySourceRef.current = { identity: sourceIdentity }
  }
  const retrySource = retrySourceRef.current
  const retryNonceRef = useRef(retryNonce)
  retryNonceRef.current = retryNonce
  const retryQueuedRef = useRef(false)
  const generationRef = useRef(0)
  const attemptsRef = useRef<Record<ImageRole, number>>({ original: 0, thumbnail: 0 })
  const retriedOriginalAttemptRef = useRef(-1)
  const retryOriginalRef = useRef<(() => void) | null>(null)
  const releaseFailedRoleRef = useRef<((role: ImageRole, url: string, attempt: number) => void) | null>(null)
  const decodingRef = useRef(new Set<string>())
  const acquireSourcesRef = useRef<(() => void) | null>(null)
  const loadersRef = useRef({ target, loadPreviewURL, loadImagePreview })
  const presentationCallbackRef = useRef(onPresentationStateChange)
  const dimensionsCallbackRef = useRef(onImageDimensionsChange)
  presentationCallbackRef.current = onPresentationStateChange
  dimensionsCallbackRef.current = onImageDimensionsChange
  loadersRef.current = { target, loadPreviewURL, loadImagePreview }
  const hasPreviewURL = Boolean(loadPreviewURL)
  const hasImagePreview = Boolean(loadImagePreview)

  useEffect(() => {
    retryQueuedRef.current = false
    const generation = ++generationRef.current
    // Independent controllers prevent an original-only retry from restarting
    // or aborting an already-decoded thumbnail.
    const controllers = new Map<ImageRole, AbortController>()
    const activeURLs = new Map<ImageRole, string>()
    const ownedURLs = new Set<string>()
    const releasedURLs = new Set<string>()
    const startedRoles = new Set<ImageRole>()
    // A failed original and thumbnail can return the same Blob URL at
    // different times. Do not revoke it while the other role's request could
    // still adopt it; neither layer waits for the other to render.
    const pendingRoleAttempts = new Map<ImageRole, number>()
    const deferredFailedURLs = new Set<string>()
    const loaders = loadersRef.current
    decodingRef.current.clear()
    setProgress({ loadedBytes: 0 })
    setSources({
      original: { url: '', status: loaders.loadPreviewURL ? 'loading' : 'failed', attempt: attemptsRef.current.original },
      thumbnail: { url: '', status: loaders.loadImagePreview ? 'loading' : 'failed', attempt: attemptsRef.current.thumbnail },
    })

    const release = (url: string) => {
      if (!url.startsWith('blob:') || releasedURLs.has(url) ||
          liveBlobImageLeases.has(url)) return
      releasedURLs.add(url)
      URL.revokeObjectURL(url)
    }
    // A broken decoded original can be large. Release its owned Blob as soon
    // as decoding fails, not only on Retry/Close. Another role may use the
    // same URL, so never revoke while the live thumbnail/original owns it.
    const releaseDeferredFailedURLs = () => {
      if (pendingRoleAttempts.size > 0) return
      for (const url of deferredFailedURLs) {
        deferredFailedURLs.delete(url)
        release(url)
      }
    }
    const releaseFailedRole = (role: ImageRole, url: string, attempt: number) => {
      if (generationRef.current !== generation ||
          attemptsRef.current[role] !== attempt || activeURLs.get(role) !== url) return
      activeURLs.delete(role)
      retireBlobLease(url)
      if (![...activeURLs.values()].includes(url)) {
        if (pendingRoleAttempts.size > 0) deferredFailedURLs.add(url)
        else release(url)
      }
    }
    releaseFailedRoleRef.current = releaseFailedRole
    const load = async (
      role: ImageRole,
      loader: () => Promise<string | null | undefined>,
      attempt: number,
      signal: AbortSignal,
    ) => {
      let url = ''
      try {
        url = (await loader()) || ''
      } catch {
        // An unavailable original must not displace the decoded thumbnail.
      }
      if (pendingRoleAttempts.get(role) === attempt) pendingRoleAttempts.delete(role)
      if (generationRef.current !== generation ||
          attemptsRef.current[role] !== attempt || signal.aborted) {
        // Previous Viewer children may be fully unmounted by the time their
        // requests settle. Never revoke a Blob held by another current child.
        if (url) release(url)
        releaseDeferredFailedURLs()
        return
      }
      if (url) {
        ownedURLs.add(url)
        activeURLs.set(role, url)
        acquireBlobLease(url)
      }
      setSources((current) => ({
        ...current,
        [role]: { url, status: url ? 'loading' : 'failed', attempt },
      }))
      releaseDeferredFailedURLs()
    }

    const start = (
      role: ImageRole,
      loader?: (signal: AbortSignal, attempt: number) => Promise<string | null | undefined>,
      force = false,
    ) => {
      if (!loader || (startedRoles.has(role) && !force)) return
      if (force) {
        controllers.get(role)?.abort()
        const previousURL = activeURLs.get(role)
        activeURLs.delete(role)
        if (previousURL) retireBlobLease(previousURL)
        // Do not revoke a URL still owned by the visible thumbnail.
        if (previousURL && ![...activeURLs.values()].includes(previousURL)) release(previousURL)
        for (const key of decodingRef.current) {
          if (key.startsWith(`${role}:`)) decodingRef.current.delete(key)
        }
      }
      startedRoles.add(role)
      const attempt = ++attemptsRef.current[role]
      pendingRoleAttempts.set(role, attempt)
      const controller = new AbortController()
      controllers.set(role, controller)
      if (role === 'original') setProgress({ loadedBytes: 0 })
      setSources((current) => ({ ...current, [role]: pendingImage(attempt) }))
      void load(role, () => loader(controller.signal, attempt), attempt, controller.signal)
    }

    const startOriginal = (force = false) => {
      const current = loadersRef.current
      start('original', current.loadPreviewURL
        ? (signal, attempt) => current.loadPreviewURL!(current.target, kind, signal,
          (loadedBytes, totalBytes) => {
            if (generationRef.current === generation &&
                attemptsRef.current.original === attempt && !signal.aborted) {
              setProgress({ loadedBytes, totalBytes })
            }
          }) : undefined, force)
    }
    const acquireAvailableSources = () => {
      const current = loadersRef.current
      // The two acquisition roles are independent; the thumbnail can show
      // a first frame while the original is downloading or decoding.
      startOriginal()
      start('thumbnail', current.loadImagePreview
        ? (signal) => current.loadImagePreview!(current.target, signal) : undefined)
    }
    const requestOwner = retrySource
    retryOriginalRef.current = () => {
      // A target/Owner replacement can render before its effect cleanup.
      // Never let the prior effect fetch a retired source in that interval.
      if (generationRef.current === generation &&
          retrySourceRef.current === requestOwner) startOriginal(true)
    }
    acquireSourcesRef.current = acquireAvailableSources
    acquireAvailableSources()
    return () => {
      generationRef.current += 1
      for (const controller of controllers.values()) controller.abort()
      pendingRoleAttempts.clear()
      if (acquireSourcesRef.current === acquireAvailableSources) acquireSourcesRef.current = null
      if (releaseFailedRoleRef.current === releaseFailedRole) releaseFailedRoleRef.current = null
      retryOriginalRef.current = null
      for (const url of activeURLs.values()) retireBlobLease(url)
      activeURLs.clear()
      for (const url of deferredFailedURLs) release(url)
      deferredFailedURLs.clear()
      for (const url of ownedURLs) release(url)
    }
  }, [kind, target.id, target.revision, retryNonce])

  // Web metadata can supply a thumbnail loader after the Viewer has mounted.
  // Acquire that role once without restarting an already-pending original.
  useEffect(() => {
    acquireSourcesRef.current?.()
  }, [hasImagePreview, hasPreviewURL])

  const failImage = useCallback((role: ImageRole, url: string, generation: number, attempt: number) => {
    // Retired renderer events must not affect a new attempt, even if both
    // attempts happened to receive the same ticket URL.
    if (generationRef.current !== generation || attemptsRef.current[role] !== attempt) return
    releaseFailedRoleRef.current?.(role, url, attempt)
    setSources((current) => current[role].url === url && current[role].attempt === attempt ? {
      ...current, [role]: { url, status: 'failed', attempt },
    } : current)
  }, [])

  const decodeImage = (role: ImageRole, url: string, image: HTMLImageElement, generation: number, attempt: number) => {
    if (generationRef.current !== generation || attemptsRef.current[role] !== attempt) return
    const key = `${role}:${attempt}:${url}`
    if (decodingRef.current.has(key)) return
    decodingRef.current.add(key)
    void (async () => {
      if (typeof image.decode === 'function') await image.decode()
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Empty preview image')
      if (generationRef.current !== generation || attemptsRef.current[role] !== attempt) return
      setSources((current) => current[role].url === url && current[role].attempt === attempt &&
        current[role].status === 'loading' ? {
        ...current, [role]: { url, status: 'ready', attempt, image },
      } : current)
    })().catch(() => {
      failImage(role, url, generation, attempt)
    })
  }

  const renderGeneration = generationRef.current
  const readyRole = sources.original.status === 'ready' ? 'original'
    : sources.thumbnail.status === 'ready' ? 'thumbnail' : null
  const readySource = readyRole ? sources[readyRole] : null
  const readyURL = readySource?.url || ''
  const handleTransformError = useCallback(() => {
    if (readyRole && readySource) failImage(readyRole, readyURL, renderGeneration, readySource.attempt)
  }, [failImage, readyRole, readyURL, renderGeneration, readySource])
  const loading = sources.original.status === 'loading' ||
    (!readySource && sources.thumbnail.status === 'loading')
  const failed = !readySource && !loading
  const canRetry = hasPreviewURL || hasImagePreview
  const retryPreview = () => {
    if (retrySourceRef.current !== retrySource ||
        retryNonceRef.current !== retryNonce ||
        retryQueuedRef.current || !failed || !canRetry) return
    retryQueuedRef.current = true
    setRetryNonce((value) => value + 1)
  }
  // Claim the failed attempt synchronously. A second click on the same
  // callback cannot renew a ticket, but a new failed attempt can be retried.
  const retryOriginal = () => {
    const attempt = sources.original.attempt
    if (retrySourceRef.current !== retrySource ||
        retryNonceRef.current !== retryNonce ||
        !hasPreviewURL || sources.original.status !== 'failed' ||
        sources.thumbnail.status !== 'ready' ||
        attemptsRef.current.original !== attempt ||
        retriedOriginalAttemptRef.current === attempt ||
        !retryOriginalRef.current) return
    retriedOriginalAttemptRef.current = attempt
    retryOriginalRef.current()
  }
  const presentationState: XDriveFilePreviewPresentationState = readySource ? 'ready' : failed ? 'failed' : 'loading'
  useEffect(() => {
    presentationCallbackRef.current?.(presentationState)
  }, [presentationState])
  const decodedImage = readySource?.image
  useEffect(() => {
    if (!decodedImage) {
      dimensionsCallbackRef.current?.(null)
      return
    }
    let width = decodedImage.naturalWidth
    let height = decodedImage.naturalHeight
    if (mediaTransform) {
      const x = Math.min(0.95, Math.max(0, mediaTransform.cropX ?? 0))
      const y = Math.min(0.95, Math.max(0, mediaTransform.cropY ?? 0))
      width = Math.max(1, Math.min(width - Math.round(width * x), Math.round(width * Math.min(1 - x, Math.max(0.05, mediaTransform.cropWidth ?? 1)))))
      height = Math.max(1, Math.min(height - Math.round(height * y), Math.round(height * Math.min(1 - y, Math.max(0.05, mediaTransform.cropHeight ?? 1)))))
      const scale = Math.min(1, 4096 / Math.max(width, height))
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
      const rotation = ((mediaTransform.rotationDegrees || 0) % 360 + 360) % 360
      if (rotation === 90 || rotation === 270) [width, height] = [height, width]
    }
    dimensionsCallbackRef.current?.({ width, height, noUpscale: Boolean(mediaTransform) })
  }, [decodedImage, mediaTransform])
  const still = (
    <Box
      aria-busy={loading || undefined}
      data-xdrive-image-phase={failed ? 'failed' : readyRole || 'loading'}
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight }}
    >
      {(['thumbnail', 'original'] as const).map((role) => {
        const source = sources[role]
        if (!source.url || source.status === 'failed') return null
        const visible = readyRole === role && !mediaTransform
        return (
          <Box
            key={`${role}:${source.attempt}:${source.url}`}
            component="img"
            src={source.url}
            alt={visible ? target.name || '' : ''}
            aria-hidden={!visible || undefined}
            decoding="async"
            draggable={false}
            onLoad={(event) => decodeImage(role, source.url, event.currentTarget, renderGeneration, source.attempt)}
            onError={() => failImage(role, source.url, renderGeneration, source.attempt)}
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            sx={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: imageFit, display: 'block', userSelect: 'none',
              transform: viewportTransform || undefined, transformOrigin: 'center',
              transition: viewportTransition,
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
        )
      })}
      {readySource && mediaTransform ? (
        <XDriveTransformedImagePreview
          src={readySource.url}
          decodedImage={readySource.image}
          alt={target.name || ''}
          transform={mediaTransform}
          viewportTransform={viewportTransform}
          onError={handleTransformError}
        />
      ) : null}
      {loading ? (
        <Box sx={readySource
          ? { position: 'absolute', right: 12, top: 12, width: 165, height: 46 }
          : { position: 'absolute', inset: 0 }}>
          <XDriveMediaLoadingProgress
            compact={Boolean(readySource)}
            stage={sources.original.url ? 'decode' : 'transfer'}
            {...progress}
          />
        </Box>
      ) : null}
      {sources.original.status === 'failed' && sources.thumbnail.status === 'ready' && hasPreviewURL ? (
        <Box data-xdrive-original-preview-retry
          sx={{ position: 'absolute', zIndex: 2, top: 12, right: 12 }}>
          <Button size="small" variant="outlined" aria-label="重试原图"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onPointerCancel={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onClick={retryOriginal}>重试原图</Button>
        </Box>
      ) : null}
      {failed ? (
        <Stack data-xdrive-image-preview-retry spacing={1} alignItems="center"
          justifyContent="center" sx={{ position: 'absolute', inset: 0, p: 2, textAlign: 'center' }}>
          {fallback ?? <Typography role="alert" color="text.secondary">图片预览失败</Typography>}
          {canRetry ? (
            <Button size="small" variant="outlined" aria-label="重试预览"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={retryPreview}>重试预览</Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  )
  return <>{children ? children(still, Boolean(readySource)) : still}</>
}
