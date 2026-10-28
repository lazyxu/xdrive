import { xDriveViewerForegroundActive, xDriveObserveViewerForeground } from './ViewerForegroundPriority'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Skeleton } from '@mui/material'
import type { XDriveMediaThumbnailSourceLoader } from './MediaGalleryThumbnailScheduler'
import { XDriveMediaGalleryCoverThumbnailPool } from './MediaGalleryCoverThumbnailPool'
import { XDriveBackgroundMediaThumbnailSuspended, XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

// undefined: standalone renderer, null: current Gallery transport not yet
// installed. Neither case may use a previous account's cached private Blob.
const CoverContext = createContext<XDriveMediaGalleryCoverThumbnailPool | null | undefined>(undefined)

// The cover pool lives in the page's ancestor Provider, whereas the inline
// Desktop Gallery Viewer lives inside XDriveMediaGallery. Only the current
// mounted Gallery may ask its ancestor pool to pause. Routed Web/PWA already
// pass the explicit suspended prop and don't depend on this bridge.
const InlineViewerCoverPauseContext = createContext<(paused: boolean) => void>(() => undefined)

/** Pause ancestor album/Places/People cover reads behind an inline Viewer. */
export function useXDriveGalleryCoverPauseForInlineViewer(paused: boolean) {
  const setPaused = useContext(InlineViewerCoverPauseContext)
  useLayoutEffect(() => {
    setPaused(paused)
    return () => setPaused(false)
  }, [paused, setPaused])
}

export function XDriveMediaGalleryCoverProvider({
  loadThumbnail,
  suspended = false,
  children,
}: {
  loadThumbnail: XDriveMediaThumbnailSourceLoader
  suspended?: boolean
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
  const [inlineViewerPaused, setInlineViewerPaused] = useState(false)
  const [viewerPriorityActive, setViewerPriorityActive] = useState(xDriveViewerForegroundActive)
  useLayoutEffect(() => xDriveObserveViewerForeground(setViewerPriorityActive), [])
  // The page's routed Viewer pause and its descendant inline Viewer pause
  // both stop the SAME bounded cover pool; cached Owner leases survive.
  const coverPaused = suspended || inlineViewerPaused || viewerPriorityActive
  useLayoutEffect(() => {
    pool?.setSuspended(coverPaused)
  }, [pool, coverPaused])
  return (
    <XDriveBackgroundMediaThumbnailSuspended.Provider value={coverPaused}>
      <InlineViewerCoverPauseContext.Provider value={setInlineViewerPaused}>
        <CoverContext.Provider value={pool}>{children}</CoverContext.Provider>
      </InlineViewerCoverPauseContext.Provider>
    </XDriveBackgroundMediaThumbnailSuspended.Provider>
  )
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
