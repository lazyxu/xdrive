import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Skeleton } from '@mui/material'
import type { XDriveMediaThumbnailSourceLoader } from './MediaGalleryThumbnailScheduler'
import { XDriveMediaGalleryCoverThumbnailPool } from './MediaGalleryCoverThumbnailPool'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

// undefined: standalone renderer, null: current Gallery transport not yet
// installed. Neither case may use a previous account's cached private Blob.
const CoverContext = createContext<XDriveMediaGalleryCoverThumbnailPool | null | undefined>(undefined)

export function XDriveMediaGalleryCoverProvider({
  loadThumbnail,
  children,
}: {
  loadThumbnail: XDriveMediaThumbnailSourceLoader
  children: ReactNode
}) {
  const [active, setActive] = useState<{
    loader: XDriveMediaThumbnailSourceLoader
    pool: XDriveMediaGalleryCoverThumbnailPool
  } | null>(null)
  useEffect(() => {
    // Every effect setup owns a fresh pool, including StrictMode's
    // mount/cleanup/remount rehearsal. Never reuse a disposed memoized pool.
    const pool = new XDriveMediaGalleryCoverThumbnailPool(loadThumbnail)
    setActive({ loader: loadThumbnail, pool })
    return () => pool.dispose()
  }, [loadThumbnail])
  const pool = active?.loader === loadThumbnail ? active.pool : null
  return <CoverContext.Provider value={pool}>{children}</CoverContext.Provider>
}

export function XDriveMediaGalleryCoverThumbnail({
  nodeID,
  revision,
  alt,
  loadThumbnail,
  fallback,
}: {
  nodeID?: number
  revision?: number
  alt: string
  loadThumbnail: XDriveMediaThumbnailSourceLoader
  fallback: ReactNode
}) {
  const owner = useContext(CoverContext)
  const pool = owner ?? null
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visibility, setVisibility] = useState<{ id?: number; near: boolean }>({
    id: nodeID, near: typeof IntersectionObserver === 'undefined',
  })
  const near = typeof IntersectionObserver === 'undefined' ||
    (visibility.id === nodeID && visibility.near)

  useEffect(() => {
    if (!nodeID) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisibility({ id: nodeID, near: true })
      return
    }
    const host = hostRef.current
    if (!host) return
    setVisibility({ id: nodeID, near: false })
    const observer = new IntersectionObserver((records) => {
      const isNear = records.some((record) => record.isIntersecting)
      setVisibility((current) => current.id === nodeID && current.near === isNear
        ? current : { id: nodeID, near: isNear })
    }, { rootMargin: '180px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [nodeID])

  useEffect(() => {
    if (!nodeID || !near || !pool) return
    return pool.retain(nodeID)
  }, [nodeID, near, pool])

  const boundedLoader = useCallback<XDriveMediaThumbnailSourceLoader>(
    (id, signal, actualRevision, onProgress) => pool
      ? pool.load(id, signal, actualRevision, onProgress)
      : loadThumbnail(id, signal, actualRevision, onProgress),
    [pool, loadThumbnail],
  )
  const onDecodeError = useCallback((url: string) => {
    if (nodeID && pool) pool.invalidateDecodedURL(nodeID, revision, url)
  }, [nodeID, pool, revision])

  return (
    <Box ref={hostRef} sx={{ height: '100%', width: '100%' }}>
      {!nodeID ? fallback : !near || owner === null ? (
        <Skeleton variant="rectangular" animation={false} width="100%" height="100%" />
      ) : (
        <XDriveMediaAsyncThumbnail
          nodeID={nodeID}
          revision={revision}
          alt={alt}
          loadThumbnail={boundedLoader}
          fallback={fallback}
          revokeOnDispose={!pool}
          onImageDecodeError={pool ? onDecodeError : undefined}
        />
      )}
    </Box>
  )
}
