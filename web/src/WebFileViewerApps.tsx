import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
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
  useXDrivePreviewPresentation,
  useXDrivePreviewSlideshow,
} from '@xdrive/ui/mui'
import type {
  MediaGalleryDataSource,
  XDriveShareDialogAdapter,
} from '@xdrive/ui/mui'
import {
  xDriveClassifyFilePreview,
  xDriveFileUsesRawCompatibilityPreview,
  xDriveMediaCaptureTimeLabel,
  xDriveWebAppHash,
} from '../../ui/shared/src'
import type {
  MediaAlbum,
  Node,
  NodeLocation,
  XDriveFilePreviewTarget,
  XDriveFilePreviewPresentationState,
  XDriveFileTextPreview,
  XDriveWebAppRoute,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'
import {
  xDriveWebViewerAnyFile,
  xDriveWebViewerMediaFile,
} from './webViewerContext'
import { useViewerNode } from './useWebViewerNode'
import { xDriveWebTextSelection } from './webTextViewer'

function WebViewerFrame({
  title,
  subtitle,
  positionLabel,
  immersive = false,
  keepChromeVisible = false,
  quickLook = false,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  actions,
  slideshow = false,
  sourceKey = '',
  presentationState = 'loading',
  navigationLoading = false,
  onClose,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  positionLabel?: ReactNode
  immersive?: boolean
  keepChromeVisible?: boolean
  quickLook?: boolean
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  actions?: ReactNode
  slideshow?: boolean
  sourceKey?: string
  presentationState?: XDriveFilePreviewPresentationState
  navigationLoading?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const compactImmersive = compactTouch && immersive
  const hasNavigation = canPrevious || canNext
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
    if (immersive && !keepChromeVisible) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        setChromeVisible(false)
      }, 2200)
    }
  }, [immersive, keepChromeVisible])

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
    const hideChrome = chromeVisible && !keepChromeVisible
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
    return () => {
      clearTouchTapTimer()
      touchPointersRef.current.clear()
      touchTapRef.current = null
    }
  }, [clearTouchTapTimer])

  useEffect(() => {
    clearTouchTapTimer()
    showChrome()
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [clearTouchTapTimer, showChrome])

  useXDrivePreviewSlideshow({
    enabled: slideshow,
    playing: slideshowPlaying,
    sourceKey,
    presentationState,
    navigationLoading,
    canNext,
    onNext,
    onStop: () => setSlideshowPlaying(false),
  })

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
        minHeight: 0,
        height: compactTouch ? '100dvh' : undefined,
        overflow: 'hidden',
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
          position: compactImmersive ? 'absolute' : 'relative',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          minHeight: compactTouch ? 56 : 52,
          px: compactTouch ? 1 : 1.5,
          pl: compactTouch ? 'max(8px, env(safe-area-inset-left))' : undefined,
          pr: compactTouch ? 'max(8px, env(safe-area-inset-right))' : undefined,
          pt: compactTouch ? 'env(safe-area-inset-top)' : 0,
          '& .MuiIconButton-root': compactTouch ? { width: 44, height: 44, flexShrink: 0 } : undefined,
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>{title}</Typography>
          {subtitle ? <Typography variant="caption" noWrap sx={{ display: 'block', opacity: 0.72 }}>{subtitle}</Typography> : null}
        </Box>
        {positionLabel ? (
          <Typography variant="caption" sx={{ opacity: 0.72 }}>
            {positionLabel}
          </Typography>
        ) : null}
        {!compactTouch ? actions : null}
        {!compactTouch && slideshow && (canPrevious || canNext) ? (
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
        {!compactTouch && hasNavigation ? (
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

      {compactTouch && (actions || hasNavigation || slideshow) ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-start"
          spacing={0.5}
          data-xdrive-web-viewer-mobile-actions
          sx={{
            position: immersive ? 'absolute' : 'relative',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            minHeight: 56,
            flexShrink: 0,
            px: 1,
            pl: 'max(8px, env(safe-area-inset-left))',
            pr: 'max(8px, env(safe-area-inset-right))',
            pb: 'env(safe-area-inset-bottom)',
            overflowX: 'auto',
            bgcolor: immersive ? 'rgba(0,0,0,.72)' : 'background.paper',
            color: immersive ? 'common.white' : 'text.primary',
            opacity: immersive && !chromeVisible ? 0 : 1,
            pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
            transition: 'opacity 160ms ease',
            '& .MuiIconButton-root': { width: 44, height: 44, flexShrink: 0, color: 'inherit' },
            '& .MuiIconButton-colorError': { color: 'error.main' },
          }}
        >
          {hasNavigation ? <IconButton aria-label="上一个项目" disabled={!canPrevious} onClick={onPrevious}>
            <KeyboardArrowLeftRoundedIcon />
          </IconButton> : null}
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{actions}</Box>
          {slideshow && (canPrevious || canNext) ? (
            <IconButton
              aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
              onClick={() => setSlideshowPlaying((value) => !value)}
            >
              {slideshowPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
          ) : null}
          {hasNavigation ? <IconButton aria-label="下一个项目" disabled={!canNext} onClick={onNext}>
            <KeyboardArrowRightRoundedIcon />
          </IconButton> : null}
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
  const presentation = useXDrivePreviewPresentation(target)

  const loadThumbnail = useCallback(async () => {
    if (!viewer.node) return null
    try {
      return URL.createObjectURL(await api.mediaThumbnail(viewer.node.id))
    } catch {
      return null
    }
  }, [api, viewer.node?.id])

  return (
    <>
      <WebViewerFrame
        title={viewer.node?.name ?? '文件预览'}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        quickLook
        slideshow
        sourceKey={presentation.sourceKey}
        presentationState={viewer.error ? 'failed' : presentation.presentationState}
        navigationLoading={viewer.navigationLoading}
        canPrevious={Boolean(viewer.previous)}
        canNext={Boolean(viewer.next)}
        onPrevious={viewer.goPrevious}
        onNext={viewer.goNext}
        actions={viewer.node ? (
          <FileViewerActions
            node={viewer.node}
            api={api}
            onShare={() => setShareOpen(true)}
            onTags={() => setTagsOpen(true)}
          />
        ) : null}
        onClose={() => onClose(viewer.node)}
      >
        {viewer.loading ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 2 }}>
            <XDriveStatePanel variant="plain" loading message="正在打开预览…" />
          </Box>
        ) : viewer.error || !viewer.node ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 2 }}>
            <XDriveStatusAlert tone="bad">{viewer.error || '文件不存在或已无法访问。'}</XDriveStatusAlert>
          </Box>
        ) : <XDriveFilePreviewSurface
          target={target}
          loadTextPreview={() => api.fileTextPreview(viewer.node!.id)}
          loadImagePreview={loadThumbnail}
          loadPreviewURL={async (_target, kind, signal) => (
            kind === 'live_photo'
              ? api.mediaLivePhotoStillURL(viewer.node!.id)
              : kind === 'image' && xDriveFileUsesRawCompatibilityPreview(_target.name)
                ? api.mediaAnalysisPreviewURL(viewer.node!.id, signal, viewer.node!.revision)
                : api.filePreviewURL(viewer.node!.id, signal)
          )}
          loadLivePhotoMotion={() => api.mediaLivePhotoMotionURL(viewer.node!.id)}
          onPresentationStateChange={presentation.onPresentationStateChange}
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
        />}
      </WebViewerFrame>
      {viewer.node ? <FileDialogs
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareOpen}
        tagsOpen={tagsOpen}
        onShareClose={() => setShareOpen(false)}
        onTagsClose={() => setTagsOpen(false)}
        onError={onError}
      /> : null}
    </>
  )
}

function WebMediaViewerApp({
  route,
  api,
  gallerySource,
  shareDialogAdapter,
  onNavigate,
  onShowInFolder,
  onClose,
  onError,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'media-viewer' }>
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  shareDialogAdapter: XDriveShareDialogAdapter
  onNavigate: (nodeID: number) => void
  onShowInFolder?: (location: NodeLocation) => void
  onClose: (node: Node | null) => void
  onError: (error: unknown) => void
}) {
  const viewer = useViewerNode({
    api,
    gallerySource,
    nodeID: route.params.node,
    contextID: route.params.context,
    predicate: xDriveWebViewerMediaFile,
    wantsMedia: true,
    onNavigate,
  })
  const mediaItem = viewer.mediaItem
  const [shareOpen, setShareOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [albums, setAlbums] = useState<MediaAlbum[]>([])

  const openInfo = () => {
    setInfoOpen((current) => !current)
    if (!infoOpen) void gallerySource.listAlbums().then(setAlbums).catch(onError)
  }

  const previewKind = viewer.node ? xDriveClassifyFilePreview({
    name: viewer.node.name,
    kind: viewer.node.type,
  }) : ''
  const supported = ['image', 'video', 'live_photo'].includes(previewKind)

  const actions = !viewer.loading && !viewer.error && supported && viewer.node && mediaItem && mediaItem.node.id === viewer.node.id ? (
    <Stack direction="row" spacing={0.25}>
      {mediaItem && gallerySource.setFavorite ? (
        <Tooltip title={mediaItem.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            size="small"
            aria-label={mediaItem.favorite ? '取消收藏' : '收藏'}
            onClick={() => {
              const favorite = !mediaItem.favorite
              void gallerySource.setFavorite?.(mediaItem.node.id, favorite).then(() => {
                viewer.updateMediaItem(mediaItem, { favorite })
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
        <Tooltip title="属性">
          <IconButton size="small" aria-label="查看属性" onClick={openInfo}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {gallerySource.exportLivePhoto &&
      (mediaItem.live_photo || mediaItem.asset_kind === 'live_photo') ? (
        <Tooltip title="导出完整实况（照片与动态原件）">
          <IconButton
            size="small"
            aria-label="导出完整实况"
            onClick={() => {
              void gallerySource.exportLivePhoto!(mediaItem).catch(onError)
            }}
          >
            <ArchiveRoundedIcon fontSize="small" />
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
  ) : null

  return (
    <>
      <WebViewerFrame
        title={viewer.node?.name ?? '媒体查看器'}
        subtitle={mediaItem && mediaItem.node.id === viewer.node?.id ? xDriveMediaCaptureTimeLabel(mediaItem.metadata.captured_at) : undefined}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        keepChromeVisible={infoOpen}
        canPrevious={Boolean(viewer.previous)}
        canNext={Boolean(viewer.next)}
        onPrevious={viewer.goPrevious}
        onNext={viewer.goNext}
        actions={actions}
        onClose={() => onClose(viewer.node)}
      >
        {viewer.loading ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <XDriveStatePanel variant="plain" loading message="正在打开媒体…" />
          </Box>
        ) : viewer.error || !viewer.node ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2 }}>
            <XDriveStatusAlert tone="bad">{viewer.error || '媒体不存在或已无法访问。'}</XDriveStatusAlert>
          </Box>
        ) : !supported ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2 }}>
            <XDriveStatusAlert tone="warning">此文件不是图片、视频或实况照片。</XDriveStatusAlert>
          </Box>
        ) : !mediaItem || mediaItem.node.id !== viewer.node.id ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <XDriveStatePanel variant="plain" loading message="正在加载媒体信息…" />
          </Box>
        ) : <XDriveMediaViewerContent
          item={mediaItem}
          loadThumbnail={gallerySource.loadThumbnail}
          loadLivePhotoMotion={gallerySource.loadLivePhotoMotion}
          loadPreviewURL={gallerySource.loadPreviewURL}
          interactiveImage
          onSwipePrevious={viewer.previous ? viewer.goPrevious : undefined}
          onSwipeNext={viewer.next ? viewer.goNext : undefined}
          minHeight={0}
          maxHeight="none"
        />}
      </WebViewerFrame>
      {viewer.node ? <FileDialogs
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareOpen}
        tagsOpen={tagsOpen}
        onShareClose={() => setShareOpen(false)}
        onTagsClose={() => setTagsOpen(false)}
        onError={onError}
      /> : null}
      <XDriveMediaDetailsInspector
        item={infoOpen ? mediaItem : null}
        overlayZIndex={1251}
        showPreview={false}
        loadNodeLocation={gallerySource.getNodeLocation}
        onShowInFolder={onShowInFolder}
        loadThumbnail={gallerySource.loadThumbnail}
        loadLivePhotoMotion={gallerySource.loadLivePhotoMotion}
        loadPreviewURL={gallerySource.loadPreviewURL}
        albums={albums}
        onSetFavorite={gallerySource.setFavorite ? async (item, favorite) => {
          await gallerySource.setFavorite!(item.node.id, favorite)
          viewer.updateMediaItem(item, { favorite })
        } : undefined}
        onSetTags={gallerySource.setTags ? async (item, tags) => {
          const normalized = await gallerySource.setTags!(item.node.id, tags)
          viewer.updateMediaItem(item, { tags: normalized })
          return normalized
        } : undefined}
        onSetPeople={gallerySource.setPeople ? async (item, people) => {
          const normalized = await gallerySource.setPeople!(item.node.id, people)
          viewer.updateMediaItem(item, { people: normalized })
          return normalized
        } : undefined}
        onSetDescription={gallerySource.setDescription ? async (item, description) => {
          const normalized = await gallerySource.setDescription!(item.node.id, description)
          viewer.updateMediaItem(item, { description: normalized })
          return normalized
        } : undefined}
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
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
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
    const { start, end } = xDriveWebTextSelection(
      preview.text,
      route.params.line,
      route.params.column,
    )
    const element = textRef.current
    element.focus()
    element.setSelectionRange(start, end)
  }, [preview, route.params.column, route.params.line])

  return (
    <WebViewerFrame
      title={node?.name ?? '文本/代码查看器'}
      actions={node && preview && !error ? (
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
      ) : null}
      onClose={() => onClose(node)}
    >
      {error ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2 }}>
          <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
        </Box>
      ) : !node || !preview ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <XDriveStatePanel variant="plain" loading message="正在加载文本…" />
        </Box>
      ) : <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0, p: compactTouch ? 0 : 1.5 }}>
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
            border: compactTouch ? 0 : 1,
            borderColor: 'divider',
            borderRadius: compactTouch ? 0 : 1,
            p: 1.5,
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: compactTouch ? 16 : 13,
            lineHeight: 1.55,
            whiteSpace: wrap ? 'pre-wrap' : 'pre',
            overflow: 'auto',
            overscrollBehavior: 'contain',
            outline: 0,
          }}
        />
      </Stack>}
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

  return (
    <WebViewerFrame
      title={node?.name ?? (route.app === 'pdf-viewer' ? 'PDF 查看器' : '音频播放器')}
      actions={node && !error ? (
        <Tooltip title="下载">
          <IconButton size="small" aria-label="下载" onClick={() => { void api.download(node) }}>
            <DownloadRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      onClose={() => onClose(node)}
    >
      {error ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2 }}>
          <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
        </Box>
      ) : !node ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <XDriveStatePanel variant="plain" loading message="正在打开文件…" />
        </Box>
      ) : <XDriveFilePreviewSurface
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
      />}
    </WebViewerFrame>
  )
}

export function WebFileViewerApps({
  route,
  api,
  gallerySource,
  shareDialogAdapter,
  onReplaceRoute,
  onShowInFolder,
  onClose,
  onError,
}: {
  route: XDriveWebAppRoute
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  shareDialogAdapter: XDriveShareDialogAdapter
  onReplaceRoute: (route: XDriveWebAppRoute) => void
  onShowInFolder?: (location: NodeLocation) => void
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
        onShowInFolder={onShowInFolder}
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
