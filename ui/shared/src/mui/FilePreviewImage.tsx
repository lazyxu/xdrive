import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import type { XDriveFilePreviewMediaTransform, XDriveFilePreviewTarget } from '../file-preview'
import type { XDriveFilePreviewImageLoader, XDriveFilePreviewURLLoader } from './FilePreviewSurface'
import { XDriveTransformedImagePreview } from './FilePreviewTransformedMedia'

type ImageRole = 'original' | 'thumbnail'
type ImageSource = {
  url: string
  status: 'loading' | 'ready' | 'failed'
  image?: HTMLImageElement
}

const pendingImage = (): ImageSource => ({ url: '', status: 'loading' })

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
  children?: (still: ReactNode, ready: boolean) => ReactNode
}) {
  const [sources, setSources] = useState<Record<ImageRole, ImageSource>>({
    original: pendingImage(), thumbnail: pendingImage(),
  })
  const generationRef = useRef(0)
  const decodingRef = useRef(new Set<string>())
  const acquireSourcesRef = useRef<(() => void) | null>(null)
  const loadersRef = useRef({ target, loadPreviewURL, loadImagePreview })
  loadersRef.current = { target, loadPreviewURL, loadImagePreview }
  const hasPreviewURL = Boolean(loadPreviewURL)
  const hasImagePreview = Boolean(loadImagePreview)

  useEffect(() => {
    const generation = ++generationRef.current
    const ownedURLs = new Set<string>()
    const releasedURLs = new Set<string>()
    const startedRoles = new Set<ImageRole>()
    const loaders = loadersRef.current
    decodingRef.current.clear()
    setSources({
      original: { url: '', status: loaders.loadPreviewURL ? 'loading' : 'failed' },
      thumbnail: { url: '', status: loaders.loadImagePreview ? 'loading' : 'failed' },
    })

    const release = (url: string) => {
      if (!url.startsWith('blob:') || releasedURLs.has(url)) return
      releasedURLs.add(url)
      URL.revokeObjectURL(url)
    }
    const load = async (role: ImageRole, loader: () => Promise<string | null | undefined> | undefined) => {
      let url = ''
      try {
        url = (await loader()) || ''
      } catch {
        // Original failure may still use the independently loaded thumbnail.
      }
      if (generationRef.current !== generation) {
        if (url) release(url)
        return
      }
      if (url) ownedURLs.add(url)
      setSources((current) => ({
        ...current,
        [role]: { url, status: url ? 'loading' : 'failed' },
      }))
    }

    const acquireAvailableSources = () => {
      const currentLoaders = loadersRef.current
      const start = (role: ImageRole, loader?: () => Promise<string | null | undefined>) => {
        if (!loader || startedRoles.has(role)) return
        startedRoles.add(role)
        setSources((current) => ({ ...current, [role]: pendingImage() }))
        void load(role, loader)
      }
      // A slow ticket/original must not delay the low-resolution first frame.
      start('original', currentLoaders.loadPreviewURL
        ? () => currentLoaders.loadPreviewURL!(currentLoaders.target, kind) : undefined)
      start('thumbnail', currentLoaders.loadImagePreview
        ? () => currentLoaders.loadImagePreview!(currentLoaders.target) : undefined)
    }
    acquireSourcesRef.current = acquireAvailableSources
    acquireAvailableSources()
    return () => {
      generationRef.current += 1
      if (acquireSourcesRef.current === acquireAvailableSources) acquireSourcesRef.current = null
      for (const url of ownedURLs) release(url)
    }
  }, [kind, target.id, target.revision])

  // Web metadata can supply a thumbnail loader after the Viewer has mounted.
  // Acquire that role once without restarting an already-pending original.
  useEffect(() => {
    acquireSourcesRef.current?.()
  }, [hasImagePreview, hasPreviewURL])

  const failImage = useCallback((role: ImageRole, url: string) => {
    setSources((current) => current[role].url === url ? {
      ...current, [role]: { url, status: 'failed' },
    } : current)
  }, [])

  const decodeImage = (role: ImageRole, url: string, image: HTMLImageElement) => {
    const key = `${role}:${url}`
    if (decodingRef.current.has(key)) return
    decodingRef.current.add(key)
    const generation = generationRef.current
    void (async () => {
      if (typeof image.decode === 'function') await image.decode()
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Empty preview image')
      if (generationRef.current !== generation) return
      setSources((current) => current[role].url === url && current[role].status === 'loading' ? {
        ...current, [role]: { url, status: 'ready', image },
      } : current)
    })().catch(() => {
      if (generationRef.current === generation) failImage(role, url)
    })
  }

  const readyRole = sources.original.status === 'ready' ? 'original'
    : sources.thumbnail.status === 'ready' ? 'thumbnail' : null
  const readySource = readyRole ? sources[readyRole] : null
  const readyURL = readySource?.url || ''
  const handleTransformError = useCallback(() => {
    if (readyRole) failImage(readyRole, readyURL)
  }, [failImage, readyRole, readyURL])
  const loading = sources.original.status === 'loading' ||
    (!readySource && sources.thumbnail.status === 'loading')
  const failed = !readySource && !loading
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
            key={`${role}:${source.url}`}
            component="img"
            src={source.url}
            alt={visible ? target.name || '' : ''}
            aria-hidden={!visible || undefined}
            decoding="async"
            draggable={false}
            onLoad={(event) => decodeImage(role, source.url, event.currentTarget)}
            onError={() => failImage(role, source.url)}
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            sx={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: imageFit, display: 'block', userSelect: 'none',
              transform: viewportTransform || undefined, transformOrigin: 'center',
              transition: viewportTransition,
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
          ? { position: 'absolute', right: 12, top: 12, display: 'grid', placeItems: 'center' }
          : { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={readySource ? 18 : 26} aria-label="正在加载图片" />
        </Box>
      ) : null}
      {failed ? (fallback ?? <Typography role="alert" color="text.secondary">图片预览失败</Typography>) : null}
    </Box>
  )
  return <>{children ? children(still, Boolean(readySource)) : still}</>
}
