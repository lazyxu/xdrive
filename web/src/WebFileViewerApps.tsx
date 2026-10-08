import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import WrapTextRoundedIcon from '@mui/icons-material/WrapTextRounded'
import {
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  XDriveFilePreviewSurface,
  XDriveFileTagDialog,
  XDriveMediaDetailsInspector,
  XDriveMediaViewerContent,
  XDriveShareDialog,
  XDriveStatePanel,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import type {
  MediaGalleryDataSource,
  XDriveShareDialogAdapter,
} from '@xdrive/ui/mui'
import {
  xDriveClassifyFilePreview,
  xDriveWebAppHash,
} from '../../ui/shared/src'
import type {
  MediaAlbum,
  MediaItem,
  Node,
  XDriveFilePreviewTarget,
  XDriveFileTextPreview,
  XDriveWebAppBrowseContext,
  XDriveWebAppRoute,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'
import {
  xDriveReadWebAppBrowseSession,
  xDriveWriteWebAppBrowseSession,
} from './webAppRuntime'
import {
  xDriveFindWebViewerNeighbor,
  xDriveWebViewerAnyFile,
  xDriveWebViewerMediaFile,
} from './webViewerContext'
import type {
  XDriveWebViewerCandidate,
  XDriveWebViewerPredicate,
} from './webViewerContext'

function WebViewerFrame({
  title,
  positionLabel,
  immersive = false,
  quickLook = false,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  actions,
  slideshow = false,
  onClose,
  children,
}: {
  title: ReactNode
  positionLabel?: ReactNode
  immersive?: boolean
  quickLook?: boolean
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  actions?: ReactNode
  slideshow?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const compactImmersive = compactTouch && immersive
  const rootRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)
  const touchTapTimerRef = useRef<number | null>(null)
  const touchPointersRef = useRef(new Set<number>())
  const touchTapRef = useRef<{
    pointerID: number
    startX: number
    startY: number
    moved: boolean
    multi: boolean
    interactive: boolean
  } | null>(null)
  const lastTouchTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [slideshowPlaying, setSlideshowPlaying] = useState(false)

  const showChrome = useCallback(() => {
    setChromeVisible(true)
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
    if (immersive) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        setChromeVisible(false)
      }, 2200)
    }
  }, [immersive])

  const clearTouchTapTimer = useCallback(() => {
    if (touchTapTimerRef.current !== null) {
      window.clearTimeout(touchTapTimerRef.current)
      touchTapTimerRef.current = null
    }
  }, [])

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!compactImmersive || event.pointerType !== 'touch') return
    touchPointersRef.current.add(event.pointerId)
    if (touchPointersRef.current.size > 1) {
      if (touchTapRef.current) touchTapRef.current.multi = true
      clearTouchTapTimer()
      return
    }
    const target = event.target instanceof HTMLElement ? event.target : null
    touchTapRef.current = {
      pointerID: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      multi: false,
      interactive: Boolean(target?.closest(
        'button, input, textarea, select, video, audio, iframe, [role="button"], [role="slider"], [contenteditable="true"]',
      )),
    }
  }

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    if (Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > 10) tap.moved = true
  }

  const handleTouchPointerRelease = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return
    touchPointersRef.current.delete(event.pointerId)
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    touchTapRef.current = null
    if (tap.moved || tap.multi || tap.interactive) return

    const now = Date.now()
    const previous = lastTouchTapRef.current
    if (
      previous &&
      now - previous.at <= 320 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32
    ) {
      lastTouchTapRef.current = null
      clearTouchTapTimer()
      return
    }

    lastTouchTapRef.current = { at: now, x: event.clientX, y: event.clientY }
    const hideChrome = chromeVisible
    clearTouchTapTimer()
    touchTapTimerRef.current = window.setTimeout(() => {
      touchTapTimerRef.current = null
      if (hideChrome) {
        if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
        setChromeVisible(false)
      } else {
        showChrome()
      }
    }, 260)
  }

  const handleTouchPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    touchPointersRef.current.delete(event.pointerId)
    if (touchTapRef.current?.pointerID === event.pointerId) touchTapRef.current = null
  }

  useEffect(() => {
    rootRef.current?.focus()
    showChrome()
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      clearTouchTapTimer()
      touchPointersRef.current.clear()
      touchTapRef.current = null
    }
  }, [clearTouchTapTimer, showChrome])

  useEffect(() => {
    if (!slideshow || !slideshowPlaying) return
    if (!canNext || !onNext) {
      setSlideshowPlaying(false)
      return
    }
    const timer = window.setTimeout(onNext, 5000)
    return () => window.clearTimeout(timer)
  }, [canNext, onNext, slideshow, slideshowPlaying, title])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    showChrome()
    const target = event.target instanceof HTMLElement ? event.target : null
    const interactive = Boolean(target?.closest(
      'button, input, textarea, select, video, audio, iframe, [role="button"], [role="slider"], [contenteditable="true"]',
    ))
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (quickLook && event.key === ' ' && !interactive) {
      event.preventDefault()
      onClose()
      return
    }
    if (interactive) return
    if (event.key === 'ArrowLeft' && canPrevious && onPrevious) {
      event.preventDefault()
      onPrevious()
    } else if (event.key === 'ArrowRight' && canNext && onNext) {
      event.preventDefault()
      onNext()
    }
  }

  return (
    <Box
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseMove={compactTouch ? undefined : showChrome}
      onPointerDownCapture={handleTouchPointerDown}
      onPointerMoveCapture={handleTouchPointerMove}
      onPointerUpCapture={handleTouchPointerRelease}
      onPointerCancelCapture={handleTouchPointerCancel}
      data-xdrive-web-viewer
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1250,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: compactImmersive ? '100vh' : 0,
        height: compactImmersive ? '100dvh' : undefined,
        outline: 0,
        bgcolor: immersive ? 'black' : 'background.default',
        color: immersive ? 'common.white' : 'text.primary',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          minHeight: compactImmersive ? 56 : 52,
          px: compactImmersive ? 1 : 1.5,
          pt: compactImmersive ? 'env(safe-area-inset-top)' : 0,
          '& .MuiIconButton-root': compactImmersive ? { width: 44, height: 44 } : undefined,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: immersive ? 'rgba(255,255,255,.18)' : 'divider',
          bgcolor: immersive ? 'rgba(0,0,0,.72)' : 'background.paper',
          opacity: immersive && !chromeVisible ? 0 : 1,
          pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
          transition: 'opacity 160ms ease',
        }}
      >
        <Tooltip title="返回">
          <IconButton
            size="small"
            aria-label="返回"
            onClick={onClose}
            sx={immersive ? { color: 'inherit' } : undefined}
          >
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {positionLabel ? (
          <Typography variant="caption" sx={{ opacity: 0.72 }}>
            {positionLabel}
          </Typography>
        ) : null}
        {!compactImmersive ? actions : null}
        {!compactImmersive && slideshow && (canPrevious || canNext) ? (
          <Tooltip title={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}>
            <IconButton
              size="small"
              aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
              onClick={() => setSlideshowPlaying((value) => !value)}
              sx={immersive ? { color: 'inherit' } : undefined}
            >
              {slideshowPlaying
                ? <PauseRoundedIcon fontSize="small" />
                : <PlayArrowRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
        {children}
        {!compactImmersive ? (
          <>
          <IconButton
            aria-label="上一个项目"
            disabled={!canPrevious}
            onClick={onPrevious}
            sx={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              bgcolor: 'background.paper',
              boxShadow: 2,
              opacity: immersive && !chromeVisible ? 0 : 1,
              pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
              transition: 'opacity 160ms ease',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <KeyboardArrowLeftRoundedIcon />
          </IconButton>
          <IconButton
            aria-label="下一个项目"
            disabled={!canNext}
            onClick={onNext}
            sx={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              bgcolor: 'background.paper',
              boxShadow: 2,
              opacity: immersive && !chromeVisible ? 0 : 1,
              pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
              transition: 'opacity 160ms ease',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <KeyboardArrowRightRoundedIcon />
          </IconButton>
  
          </>
        ) : null}
      </Box>

      {compactImmersive && (actions || canPrevious || canNext || slideshow) ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="center"
          spacing={0.5}
          data-xdrive-web-viewer-mobile-actions
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            minHeight: 56,
            px: 1,
            pb: 'env(safe-area-inset-bottom)',
            bgcolor: 'rgba(0,0,0,.72)',
            color: 'common.white',
            opacity: chromeVisible ? 1 : 0,
            pointerEvents: chromeVisible ? 'auto' : 'none',
            transition: 'opacity 160ms ease',
            '& .MuiIconButton-root': { width: 44, height: 44, color: 'inherit' },
            '& .MuiIconButton-colorError': { color: 'error.main' },
          }}
        >
          <IconButton aria-label="上一个项目" disabled={!canPrevious} onClick={onPrevious}>
            <KeyboardArrowLeftRoundedIcon />
          </IconButton>
          <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center' }}>{actions}</Box>
          {slideshow && (canPrevious || canNext) ? (
            <IconButton
              aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
              onClick={() => setSlideshowPlaying((value) => !value)}
            >
              {slideshowPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
          ) : null}
          <IconButton aria-label="下一个项目" disabled={!canNext} onClick={onNext}>
            <KeyboardArrowRightRoundedIcon />
          </IconButton>
        </Stack>
      ) : null}

      {quickLook && !compactImmersive ? (
        <Typography
          variant="caption"
          textAlign="center"
          sx={{
            py: 0.75,
            flexShrink: 0,
            opacity: immersive && !chromeVisible ? 0 : 0.72,
            transition: 'opacity 160ms ease',
          }}
        >
          Space / Esc 返回 · ← / → 切换
        </Typography>
      ) : null}
    </Box>
  )
}

function useViewerNode({
  api,
  gallerySource,
  nodeID,
  contextID,
  predicate,
  onNavigate,
}: {
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  nodeID: number
  contextID?: string
  predicate: XDriveWebViewerPredicate
  onNavigate: (nodeID: number) => void
}) {
  const context = useMemo(
    () => xDriveReadWebAppBrowseSession(contextID),
    [contextID],
  )
  const [node, setNode] = useState<Node | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(context?.activeIndex ?? 0)
  const [previous, setPrevious] = useState<XDriveWebViewerCandidate | null>(null)
  const [next, setNext] = useState<XDriveWebViewerCandidate | null>(null)
  const [totalCount, setTotalCount] = useState(
    context?.kind === 'selection'
      ? context.nodeIDs.length
      : context?.kind === 'gallery'
        ? context.totalCount
        : 0,
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void api.node(nodeID).then((value) => {
      if (active) setNode(value)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [api, nodeID])

  useEffect(() => {
    if (!context) {
      setPrevious(null)
      setNext(null)
      return
    }
    let active = true
    void Promise.all([
      xDriveFindWebViewerNeighbor(api, gallerySource, context, activeIndex, -1, predicate),
      xDriveFindWebViewerNeighbor(api, gallerySource, context, activeIndex, 1, predicate),
    ]).then(([prev, nextValue]) => {
      if (!active) return
      setPrevious(prev)
      setNext(nextValue)
      setTotalCount(
        prev?.totalCount ??
        nextValue?.totalCount ??
        (context.kind === 'selection'
          ? context.nodeIDs.length
          : context.kind === 'gallery'
            ? context.totalCount
            : 0),
      )
    }).catch(() => {
      if (active) {
        setPrevious(null)
        setNext(null)
      }
    })
    return () => {
      active = false
    }
  }, [activeIndex, api, context, gallerySource, predicate])

  const navigate = (candidate: XDriveWebViewerCandidate | null) => {
    if (!candidate) return
    setActiveIndex(candidate.index)
    setNode(candidate.node)
    setTotalCount(candidate.totalCount)
    if (context && contextID) {
      xDriveWriteWebAppBrowseSession(contextID, {
        ...context,
        activeIndex: candidate.index,
      } as XDriveWebAppBrowseContext)
    }
    onNavigate(candidate.node.id)
  }

  return {
    node,
    loading,
    error,
    activeIndex,
    totalCount,
    previous,
    next,
    goPrevious: () => navigate(previous),
    goNext: () => navigate(next),
  }
}

function FileViewerActions({
  node,
  api,
  onShare,
  onTags,
}: {
  node: Node
  api: XDriveApi
  onShare: () => void
  onTags: () => void
}) {
  return (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title="标签">
        <IconButton size="small" aria-label="标签" onClick={onTags}>
          <LocalOfferOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="分享">
        <IconButton size="small" aria-label="分享" onClick={onShare}>
          <ShareRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="下载">
        <IconButton
          size="small"
          aria-label="下载"
          onClick={() => { void api.download(node) }}
        >
          <DownloadRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

function FileDialogs({
  node,
  api,
  shareDialogAdapter,
  shareOpen,
  tagsOpen,
  onShareClose,
  onTagsClose,
  onError,
}: {
  node: Node
  api: XDriveApi
  shareDialogAdapter: XDriveShareDialogAdapter
  shareOpen: boolean
  tagsOpen: boolean
  onShareClose: () => void
  onTagsClose: () => void
  onError: (error: unknown) => void
}) {
  const [tags, setTags] = useState<Awaited<ReturnType<XDriveApi['fileTags']>>>([])

  useEffect(() => {
    if (!tagsOpen) return
    void api.fileTags().then(setTags).catch(onError)
  }, [api, onError, tagsOpen])

  return (
    <>
      <XDriveShareDialog
        adapter={shareDialogAdapter}
        node={shareOpen ? node : null}
        onClose={onShareClose}
        onError={onError}
        expiryMode="datetime"
        listVariant="table"
      />
      <XDriveFileTagDialog
        open={tagsOpen}
        nodeIDs={[node.id]}
        tags={tags}
        queryNodeTags={(nodeIDs) => api.fileNodeTags(nodeIDs)}
        onSetTag={(tagID, nodeIDs, assigned) =>
          api.setFileTagNodes(tagID, nodeIDs, assigned).then(() => undefined)}
        onCreateTag={(name, color) => api.createFileTag(name, color).then((tag) => {
          setTags((current) => [...current, tag])
          return tag
        })}
        onUpdateTag={(id, input) => api.updateFileTag(id, input).then((tag) => {
          setTags((current) => current.map((item) => item.id === id ? tag : item))
          return tag
        })}
        onDeleteTag={(id) => api.deleteFileTag(id).then(() => {
          setTags((current) => current.filter((item) => item.id !== id))
        })}
        onClose={onTagsClose}
      />
    </>
  )
}

function WebPreviewApp({
  route,
  api,
  gallerySource,
  shareDialogAdapter,
  onNavigate,
  onClose,
  onError,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'preview' }>
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  shareDialogAdapter: XDriveShareDialogAdapter
  onNavigate: (nodeID: number) => void
  onClose: (node: Node | null) => void
  onError: (error: unknown) => void
}) {
  const viewer = useViewerNode({
    api,
    gallerySource,
    nodeID: route.params.node,
    contextID: route.params.context,
    predicate: xDriveWebViewerAnyFile,
    onNavigate,
  })
  const [shareOpen, setShareOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const target = viewer.node ? {
    id: viewer.node.id,
    name: viewer.node.name,
    kind: viewer.node.type,
    size: viewer.node.size,
    revision: viewer.node.revision,
  } satisfies XDriveFilePreviewTarget : null

  const loadThumbnail = useCallback(async () => {
    if (!viewer.node) return null
    try {
      return URL.createObjectURL(await api.mediaThumbnail(viewer.node.id))
    } catch {
      return null
    }
  }, [api, viewer.node?.id])

  if (viewer.loading) return <XDriveStatePanel variant="plain" loading message="正在打开预览…" />
  if (viewer.error || !viewer.node) {
    return <XDriveStatusAlert tone="bad">{viewer.error || '文件不存在或已无法访问。'}</XDriveStatusAlert>
  }

  return (
    <>
      <WebViewerFrame
        title={viewer.node.name}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        quickLook
        slideshow
        canPrevious={Boolean(viewer.previous)}
        canNext={Boolean(viewer.next)}
        onPrevious={viewer.goPrevious}
        onNext={viewer.goNext}
        actions={(
          <FileViewerActions
            node={viewer.node}
            api={api}
            onShare={() => setShareOpen(true)}
            onTags={() => setTagsOpen(true)}
          />
        )}
        onClose={() => onClose(viewer.node)}
      >
        <XDriveFilePreviewSurface
          target={target}
          loadTextPreview={() => api.fileTextPreview(viewer.node!.id)}
          loadImagePreview={loadThumbnail}
          loadPreviewURL={async (_target, kind) => (
            kind === 'live_photo'
              ? api.mediaLivePhotoStillURL(viewer.node!.id)
              : api.filePreviewURL(viewer.node!.id)
          )}
          loadLivePhotoMotion={() => api.mediaLivePhotoMotionURL(viewer.node!.id)}
          interactiveImage
          onSwipePrevious={viewer.previous ? viewer.goPrevious : undefined}
          onSwipeNext={viewer.next ? viewer.goNext : undefined}
          fallback={(
            <Box sx={{ width: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
              此文件暂无可用预览
            </Box>
          )}
          minHeight={0}
          maxHeight="none"
        />
      </WebViewerFrame>
      <FileDialogs
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareOpen}
        tagsOpen={tagsOpen}
        onShareClose={() => setShareOpen(false)}
        onTagsClose={() => setTagsOpen(false)}
        onError={onError}
      />
    </>
  )
}

function WebMediaViewerApp({
  route,
  api,
  gallerySource,
  shareDialogAdapter,
  onNavigate,
  onClose,
  onError,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'media-viewer' }>
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  shareDialogAdapter: XDriveShareDialogAdapter
  onNavigate: (nodeID: number) => void
  onClose: (node: Node | null) => void
  onError: (error: unknown) => void
}) {
  const viewer = useViewerNode({
    api,
    gallerySource,
    nodeID: route.params.node,
    contextID: route.params.context,
    predicate: xDriveWebViewerMediaFile,
    onNavigate,
  })
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null)
  const [mediaItemLoading, setMediaItemLoading] = useState(true)
  const [mediaItemError, setMediaItemError] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [albums, setAlbums] = useState<MediaAlbum[]>([])

  useEffect(() => {
    let active = true
    setMediaItem(null)
    setMediaItemLoading(true)
    setMediaItemError('')
    void api.mediaItem(route.params.node)
      .then((item) => {
        if (active) setMediaItem(item)
      })
      .catch((reason) => {
        if (!active) return
        setMediaItem(null)
        setMediaItemError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setMediaItemLoading(false)
      })
    return () => { active = false }
  }, [api, route.params.node])

  const openInfo = () => {
    setInfoOpen(true)
    void gallerySource.listAlbums().then(setAlbums).catch(onError)
  }

  if (viewer.loading) return <XDriveStatePanel variant="plain" loading message="正在打开媒体…" />
  if (viewer.error || !viewer.node) {
    return <XDriveStatusAlert tone="bad">{viewer.error || '媒体不存在或已无法访问。'}</XDriveStatusAlert>
  }

  const previewKind = xDriveClassifyFilePreview({
    name: viewer.node.name,
    kind: viewer.node.type,
  })
  if (!['image', 'video', 'live_photo'].includes(previewKind)) {
    return <XDriveStatusAlert tone="warning">此文件不是图片、视频或实况照片。</XDriveStatusAlert>
  }
  if (mediaItemError) {
    return <XDriveStatusAlert tone="bad">{mediaItemError}</XDriveStatusAlert>
  }
  if (mediaItemLoading || !mediaItem || mediaItem.node.id !== viewer.node.id) {
    return <XDriveStatePanel variant="plain" loading message="正在加载媒体信息…" />
  }

  const actions = (
    <Stack direction="row" spacing={0.25}>
      {mediaItem && gallerySource.setFavorite ? (
        <Tooltip title={mediaItem.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            size="small"
            aria-label={mediaItem.favorite ? '取消收藏' : '收藏'}
            onClick={() => {
              const favorite = !mediaItem.favorite
              void gallerySource.setFavorite?.(mediaItem.node.id, favorite).then(() => {
                setMediaItem((current) => current ? { ...current, favorite } : current)
              }).catch(onError)
            }}
          >
            {mediaItem.favorite
              ? <StarRoundedIcon fontSize="small" />
              : <StarBorderRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {mediaItem ? (
        <Tooltip title="信息">
          <IconButton size="small" aria-label="媒体信息" onClick={openInfo}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      <FileViewerActions
        node={viewer.node}
        api={api}
        onShare={() => setShareOpen(true)}
        onTags={() => setTagsOpen(true)}
      />
    </Stack>
  )

  return (
    <>
      <WebViewerFrame
        title={viewer.node.name}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        canPrevious={Boolean(viewer.previous)}
        canNext={Boolean(viewer.next)}
        onPrevious={viewer.goPrevious}
        onNext={viewer.goNext}
        actions={actions}
        onClose={() => onClose(viewer.node)}
      >
        <XDriveMediaViewerContent
          item={mediaItem}
          loadThumbnail={gallerySource.loadThumbnail}
          loadLivePhotoMotion={gallerySource.loadLivePhotoMotion}
          loadPreviewURL={gallerySource.loadPreviewURL}
          interactiveImage
          onSwipePrevious={viewer.previous ? viewer.goPrevious : undefined}
          onSwipeNext={viewer.next ? viewer.goNext : undefined}
          minHeight={0}
          maxHeight="none"
        />
      </WebViewerFrame>
      <FileDialogs
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareOpen}
        tagsOpen={tagsOpen}
        onShareClose={() => setShareOpen(false)}
        onTagsClose={() => setTagsOpen(false)}
        onError={onError}
      />
      <XDriveMediaDetailsInspector
        item={infoOpen ? mediaItem : null}
        overlayZIndex={1251}
        loadThumbnail={gallerySource.loadThumbnail}
        loadLivePhotoMotion={gallerySource.loadLivePhotoMotion}
        loadPreviewURL={gallerySource.loadPreviewURL}
        albums={albums}
        onSetFavorite={gallerySource.setFavorite ? async (item, favorite) => {
          await gallerySource.setFavorite!(item.node.id, favorite)
          setMediaItem((current) => current ? { ...current, favorite } : current)
        } : undefined}
        onSetTags={gallerySource.setTags ? async (item, tags) => {
          const normalized = await gallerySource.setTags!(item.node.id, tags)
          setMediaItem((current) => current ? { ...current, tags: normalized } : current)
          return normalized
        } : undefined}
        onSetPeople={gallerySource.setPeople ? (item, people) => gallerySource.setPeople!(item.node.id, people) : undefined}
        onSetDescription={gallerySource.setDescription ? (item, description) => gallerySource.setDescription!(item.node.id, description) : undefined}
        onAddToAlbum={gallerySource.addToAlbum ? (album, item) =>
          gallerySource.addToAlbum!(album.id, album.revision ?? 0, [item.node.id]) : undefined}
        onRemoveFromAlbum={gallerySource.removeFromAlbum ? (album, item) =>
          gallerySource.removeFromAlbum!(album.id, album.revision ?? 0, item.node.id) : undefined}
        onClose={() => setInfoOpen(false)}
      />
    </>
  )
}

function WebTextViewerApp({
  route,
  api,
  onClose,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'text-viewer' }>
  api: XDriveApi
  onClose: (node: Node | null) => void
}) {
  const [node, setNode] = useState<Node | null>(null)
  const [preview, setPreview] = useState<XDriveFileTextPreview | null>(null)
  const [error, setError] = useState('')
  const [wrap, setWrap] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    setError('')
    void Promise.all([api.node(route.params.node), api.fileTextPreview(route.params.node)])
      .then(([nextNode, nextPreview]) => {
        if (!active) return
        setNode(nextNode)
        setPreview(nextPreview)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { active = false }
  }, [api, route.params.node])

  useEffect(() => {
    if (!preview || !route.params.line || !textRef.current) return
    const lines = preview.text.split('\n')
    const lineIndex = Math.max(0, Math.min(lines.length - 1, route.params.line - 1))
    let start = 0
    for (let index = 0; index < lineIndex; index += 1) start += lines[index].length + 1
    start += Math.max(0, (route.params.column ?? 1) - 1)
    const end = Math.min(preview.text.length, start + Math.max(1, lines[lineIndex]?.length ?? 1))
    const element = textRef.current
    element.focus()
    element.setSelectionRange(start, end)
  }, [preview, route.params.column, route.params.line])

  if (error) return <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
  if (!node || !preview) return <XDriveStatePanel variant="plain" loading message="正在加载文本…" />

  return (
    <WebViewerFrame
      title={node.name}
      actions={(
        <Stack direction="row" spacing={0.25}>
          <Tooltip title={wrap ? '关闭自动换行' : '自动换行'}>
            <IconButton size="small" aria-label="切换自动换行" onClick={() => setWrap((value) => !value)}>
              <WrapTextRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="下载完整文件">
            <IconButton size="small" aria-label="下载完整文件" onClick={() => { void api.download(node) }}>
              <DownloadRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
      onClose={() => onClose(node)}
    >
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 1.5 }}>
        {preview.truncated ? (
          <XDriveStatusAlert tone="neutral">
            文件较大，仅显示前 1 MiB。可使用下载按钮获取完整文件。
          </XDriveStatusAlert>
        ) : null}
        <Box
          component="textarea"
          ref={textRef}
          readOnly
          value={preview.text}
          spellCheck={false}
          aria-label="文本内容"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            width: '100%',
            resize: 'none',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.5,
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: wrap ? 'pre-wrap' : 'pre',
            overflow: 'auto',
            outline: 0,
          }}
        />
      </Stack>
    </WebViewerFrame>
  )
}

function WebSinglePreviewApp({
  route,
  api,
  onClose,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'pdf-viewer' | 'audio-player' }>
  api: XDriveApi
  onClose: (node: Node | null) => void
}) {
  const [node, setNode] = useState<Node | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api.node(route.params.node).then((value) => {
      if (active) setNode(value)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [api, route.params.node])

  if (error) return <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
  if (!node) return <XDriveStatePanel variant="plain" loading message="正在打开文件…" />

  return (
    <WebViewerFrame
      title={node.name}
      actions={(
        <Tooltip title="下载">
          <IconButton size="small" aria-label="下载" onClick={() => { void api.download(node) }}>
            <DownloadRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      onClose={() => onClose(node)}
    >
      <XDriveFilePreviewSurface
        target={{
          id: node.id,
          name: node.name,
          kind: node.type,
          size: node.size,
          revision: node.revision,
        }}
        loadPreviewURL={async (_target, kind) => {
          if (route.app === 'pdf-viewer' && kind !== 'pdf') return null
          if (route.app === 'audio-player' && kind !== 'audio') return null
          const url = await api.filePreviewURL(node.id)
          return route.app === 'pdf-viewer' && route.params.page
            ? `${url}#page=${route.params.page}`
            : url
        }}
        minHeight={0}
        maxHeight="none"
      />
    </WebViewerFrame>
  )
}

export function WebFileViewerApps({
  route,
  api,
  gallerySource,
  shareDialogAdapter,
  onReplaceRoute,
  onClose,
  onError,
}: {
  route: XDriveWebAppRoute
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  shareDialogAdapter: XDriveShareDialogAdapter
  onReplaceRoute: (route: XDriveWebAppRoute) => void
  onClose: (node: Node | null) => void
  onError: (error: unknown) => void
}) {
  if (route.app === 'preview') {
    return (
      <WebPreviewApp
        route={route}
        api={api}
        gallerySource={gallerySource}
        shareDialogAdapter={shareDialogAdapter}
        onNavigate={(nodeID) => onReplaceRoute({
          app: 'preview',
          params: { ...route.params, node: nodeID },
        })}
        onClose={onClose}
        onError={onError}
      />
    )
  }
  if (route.app === 'media-viewer') {
    return (
      <WebMediaViewerApp
        route={route}
        api={api}
        gallerySource={gallerySource}
        shareDialogAdapter={shareDialogAdapter}
        onNavigate={(nodeID) => onReplaceRoute({
          app: 'media-viewer',
          params: { ...route.params, node: nodeID },
        })}
        onClose={onClose}
        onError={onError}
      />
    )
  }
  if (route.app === 'text-viewer') {
    return <WebTextViewerApp route={route} api={api} onClose={onClose} />
  }
  if (route.app === 'pdf-viewer' || route.app === 'audio-player') {
    return <WebSinglePreviewApp route={route} api={api} onClose={onClose} />
  }
  return null
}

export function xDriveWebOpenRouteForNode(node: Node, contextID?: string): XDriveWebAppRoute | null {
  const kind = xDriveClassifyFilePreview({
    name: node.name,
    kind: node.type,
  })
  if (node.type === 'dir') return { app: 'files', params: { dir: node.id } }
  if (kind === 'image' || kind === 'video' || kind === 'live_photo') {
    return { app: 'media-viewer', params: { node: node.id, context: contextID } }
  }
  if (kind === 'text') return { app: 'text-viewer', params: { node: node.id } }
  if (kind === 'pdf') return { app: 'pdf-viewer', params: { node: node.id } }
  if (kind === 'audio') return { app: 'audio-player', params: { node: node.id } }
  return null
}

export function xDriveWebRouteURL(route: XDriveWebAppRoute) {
  return xDriveWebAppHash(route)
}
