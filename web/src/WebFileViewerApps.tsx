import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { XDriveRoutedGalleryThumbnailBorrower } from './routedGalleryThumbnailBridge'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import WrapTextRoundedIcon from '@mui/icons-material/WrapTextRounded'
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  XDriveConfirmDialog,
  XDriveFilePreviewSurface,
  XDriveFileTagDialog,
  XDriveMediaDetailsInspector,
  XDriveMediaGalleryFilmstrip,
  XDriveMediaGalleryViewerLocationDialog,
  XDriveMediaGalleryEditDialog,
  XDriveMediaGalleryCreativeDialog,
  xDriveMediaItemSupportsCreative,
  XDriveMediaViewerContent,
  XDriveShareDialog,
  XDriveStatusAlert,
  xDriveViewerDownloadTransferLabel,
  useXDrivePreviewPresentation,
  useXDrivePreviewSlideshow,
} from '@xdrive/ui/mui'
import type {
  MediaGalleryDataSource,
  XDriveShareDialogAdapter,
} from '@xdrive/ui/mui'
import {
  xDriveClassifyFilePreview,
  xDriveFileNeedsBrowserCompatibleImagePreview,
  xDriveMediaCaptureTimeLabel,
  xDriveWebAppHash,
} from '../../ui/shared/src'
import type {
  MediaAlbum,
  Node,
  NodeLocation,
  XDriveFilePreviewTarget,
  XDriveFilePreviewPresentationState,
  XDriveByteProgressHandler,
  XDriveWebAppRoute,
  XDriveTransferTask,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'
import {
  xDriveWebViewerAnyFile,
  xDriveWebViewerMediaFile,
} from './webViewerContext'
import { useViewerNode } from './useWebViewerNode'
import { xDriveContainViewerTabFocus } from './viewerFocusScope'
import { xDriveWebTextSelection } from './webTextViewer'
import { xDriveMediaItemSupportsBasicEditing } from '../../ui/shared/src/media-edit'

// Navigation metadata is not media byte progress. Hold a full-height, silent
// first-read canvas; the verified preview renderer still owns real thumbnails,
// decoded media, Live Photo, PDF/audio and file-transfer progress.
function WebViewerQuietFirstRead() {
  return (
    <Box data-xdrive-web-viewer-quiet-first-read role="region"
      aria-label="查看器内容尚未确认" aria-busy={true}
      sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }} />
  )
}

const SAFE_WEB_VIEWER_READ_MESSAGES = new Set([
  '地图照片范围已变化，请返回地图重新选择。',
  '地图照片范围已失效，请返回地图重新选择。',
  '浏览范围已失效，请返回重新打开。',
  '文件版本已更改，请重新打开。',
  '媒体信息与当前文件版本不一致，请重试。',
  '当前媒体信息不可用，请重试。',
  '当前文件信息不可用，请重试。',
  '当前文件无法生成文本预览，请重试。',
])

// Web/iOS PWA Viewer modes all display the same Owner-scoped Task Center
// receipt. The preview host is a horizontal flex layout: progress must overlay,
// never shrink the decoded still, native media controls, text or PDF viewport.
// Screen readers announce only terminal/handoff updates, not every byte sample.
function WebViewerDownloadFeedback({ download }: {
  download: Pick<ReturnType<typeof useWebViewerDownload>,
    'status' | 'error' | 'announceStatus'>
}) {
  // Keep the existing failure alert structure; external consumers and
  // accessibility tests rely on the discoverable, sanitized retry feedback.
  if (download.error) return (
    <Box data-xdrive-standalone-download-error
      sx={{
        position: 'absolute', top: 12, left: 12, zIndex: 5,
        maxWidth: 'calc(100% - 24px)', pointerEvents: 'none',
      }}>
      <XDriveStatusAlert tone="bad">{download.error}</XDriveStatusAlert>
    </Box>
  )
  if (!download.status) return null
  return (
    <Box
      data-xdrive-viewer-download-progress=""
      role="status"
      aria-live={download.announceStatus ? 'polite' : 'off'}
      sx={{
        position: 'absolute', top: 12, left: 12, zIndex: 5,
        maxWidth: 'calc(100% - 24px)', px: 1.5, py: 0.75,
        color: 'common.white', bgcolor: 'rgba(0, 0, 0, 0.68)',
        borderRadius: 1.5, pointerEvents: 'none',
        '& .MuiTypography-root': { color: 'inherit', overflowWrap: 'anywhere' },
      }}
    >
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {download.status}
      </Typography>
    </Box>
  )
}
// One full-height terminal error state for Quick Look, media, text and audio.
// A real click invokes the original authorized reader, never a shadow API.
function WebViewerReadError({ message, onRetry }: {
  message: string
  onRetry?: () => void
}) {
  return (
    <Box data-xdrive-web-viewer-read-error
      sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 2 }}>
      <Stack spacing={1.5} alignItems="center" sx={{ width: '100%', maxWidth: 460, minWidth: 0 }}>
        <XDriveStatusAlert tone="bad">{SAFE_WEB_VIEWER_READ_MESSAGES.has(message)
          ? message : '读取失败，请重试。'}</XDriveStatusAlert>
        {onRetry ? (
          <Button variant="outlined" aria-label="重试加载"
            onClick={onRetry} sx={{ minHeight: 44, minWidth: 120 }}>
            重试加载
          </Button>
        ) : null}
      </Stack>
    </Box>
  )
}

function WebViewerFrame({
  title,
  subtitle,
  positionLabel,
  immersive = false,
  photosViewer = false,
  keepChromeVisible = false,
  chromeSessionKey = '',
  quickLook = false,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  actions,
  filmstrip,
  slideshow = false,
  slideshowOwnerKey = '',
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
  // Media Viewer launched from Gallery/Files is presentation-only; it keeps
  // the same Web browse-context, REST source and shared preview engine.
  photosViewer?: boolean
  keepChromeVisible?: boolean
  chromeSessionKey?: string | number
  quickLook?: boolean
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  actions?: ReactNode
  filmstrip?: ReactNode
  slideshow?: boolean
  slideshowOwnerKey?: string | number
  sourceKey?: string
  presentationState?: XDriveFilePreviewPresentationState
  navigationLoading?: boolean
  onClose: () => void
  children: ReactNode
}) {
  // The routed Web Media Viewer must not downgrade to desktop chrome when a
  // mobile-width device has a paired fine pointer. Keep Files Quick Look and
  // the standalone Text/PDF/Audio apps on their existing pointer contract.
  const narrowViewport = useMediaQuery('(max-width:899.95px)')
  const ultraNarrowViewport = useMediaQuery('(max-width:367.95px)')
  const coarseMobilePointer = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const compactTouch = coarseMobilePointer || (photosViewer && immersive && narrowViewport)
  const compactImmersive = compactTouch && immersive
  const hasNavigation = canPrevious || canNext
  const showMobileNavigation = hasNavigation && !(compactImmersive && photosViewer && ultraNarrowViewport)
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
  // A→B→A must mint a new token; a previous A's delayed tap is not the new A.
  const chromeSession = useMemo(() => ({}), [chromeSessionKey])
  const activeChromeSessionRef = useRef<object | null>(chromeSession)
  const isCurrentChromeSession = () => activeChromeSessionRef.current === chromeSession
  const chromeFocusRef = useRef(false)
  const hasChromeFocus = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.(
    '[data-xdrive-web-viewer-chrome]',
  ))
  const [slideshowState, setSlideshowState] = useState({ ownerKey: slideshowOwnerKey, playing: false })
  const slideshowPlaying = slideshow && slideshowState.ownerKey === slideshowOwnerKey && slideshowState.playing
  const toggleSlideshow = () => setSlideshowState((current) => ({
    ownerKey: slideshowOwnerKey,
    playing: !(current.ownerKey === slideshowOwnerKey && current.playing),
  }))
  useEffect(() => {
    if (!slideshow) setSlideshowState((current) =>
      current.playing ? { ownerKey: slideshowOwnerKey, playing: false } : current)
  }, [slideshow, slideshowOwnerKey])

  const showChrome = useCallback(() => {
    if (!isCurrentChromeSession()) return
    setChromeVisible(true)
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
    if (immersive && !keepChromeVisible && !chromeFocusRef.current) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        if (activeChromeSessionRef.current === chromeSession && !chromeFocusRef.current) setChromeVisible(false)
      }, 2200)
    }
  }, [immersive, keepChromeVisible, chromeSession])

  const handleChromeFocusCapture = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!isCurrentChromeSession() || !hasChromeFocus(event.target)) return
    chromeFocusRef.current = true
    showChrome()
  }
  const handleChromeBlurCapture = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!isCurrentChromeSession() || !chromeFocusRef.current) return
    chromeFocusRef.current = hasChromeFocus(event.relatedTarget)
    if (!chromeFocusRef.current) showChrome()
  }

  const clearTouchTapTimer = useCallback(() => {
    if (touchTapTimerRef.current !== null) {
      window.clearTimeout(touchTapTimerRef.current)
      touchTapTimerRef.current = null
    }
  }, [])

  // Run before paint when a mounted Viewer receives another Node/Owner.
  // Clearing the browser timer is insufficient if its callback was queued;
  // the immutable per-session token also fences those callbacks.
  useLayoutEffect(() => {
    activeChromeSessionRef.current = chromeSession
    clearTouchTapTimer()
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
    touchPointersRef.current.clear()
    touchTapRef.current = null
    lastTouchTapRef.current = null
    chromeFocusRef.current = typeof document !== 'undefined' &&
      hasChromeFocus(document.activeElement)
    setChromeVisible(true)
    return () => {
      if (activeChromeSessionRef.current === chromeSession) {
        clearTouchTapTimer()
        if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
        activeChromeSessionRef.current = null
      }
    }
  }, [chromeSession, clearTouchTapTimer])

  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isCurrentChromeSession() || !compactImmersive || event.pointerType !== 'touch') return
    touchPointersRef.current.add(event.pointerId)
    if (touchPointersRef.current.size > 1) {
      if (touchTapRef.current) touchTapRef.current.multi = true
      lastTouchTapRef.current = null
      clearTouchTapTimer()
      return
    }
    // SVG child icons inherit the surrounding button's interactive intent.
    const target = event.target as Element | null
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
    if (!isCurrentChromeSession()) return
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    if (Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > 10) tap.moved = true
  }

  const handleTouchPointerRelease = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isCurrentChromeSession()) return
    if (event.pointerType !== 'touch') return
    touchPointersRef.current.delete(event.pointerId)
    const tap = touchTapRef.current
    if (!tap || tap.pointerID !== event.pointerId) return
    touchTapRef.current = null
    if (tap.moved || tap.multi || tap.interactive ||
        Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > 10) return

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
    const hideChrome = chromeVisible && !keepChromeVisible && !chromeFocusRef.current
    clearTouchTapTimer()
    touchTapTimerRef.current = window.setTimeout(() => {
      if (!isCurrentChromeSession()) return
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
    if (!isCurrentChromeSession()) return
    touchPointersRef.current.delete(event.pointerId)
    if (touchTapRef.current?.pointerID === event.pointerId) touchTapRef.current = null
    lastTouchTapRef.current = null
    clearTouchTapTimer()
  }

  useEffect(() => {
    rootRef.current?.focus()
    return () => {
      clearTouchTapTimer()
      touchPointersRef.current.clear()
      touchTapRef.current = null
      chromeFocusRef.current = false
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
    interactionPaused: keepChromeVisible,
    canNext,
    onNext,
    onStop: () => setSlideshowState((current) =>
      current.ownerKey === slideshowOwnerKey && current.playing
        ? { ownerKey: slideshowOwnerKey, playing: false } : current),
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isCurrentChromeSession()) return
    showChrome()
    // Inline Desktop uses MUI Dialog; this routed fullscreen overlay must
    // also contain Tab while the underlying Gallery remains mounted.
    if (event.key === 'Tab' && xDriveContainViewerTabFocus(rootRef.current, document.activeElement, event.shiftKey)) {
      event.preventDefault()
      return
    }
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
      onFocusCapture={handleChromeFocusCapture}
      onBlurCapture={handleChromeBlurCapture}
      onMouseMove={coarseMobilePointer ? undefined : showChrome}
      onPointerDownCapture={handleTouchPointerDown}
      onPointerMoveCapture={handleTouchPointerMove}
      onPointerUpCapture={handleTouchPointerRelease}
      onPointerCancelCapture={handleTouchPointerCancel}
      data-xdrive-web-viewer
      role="dialog"
      aria-modal="true"
      aria-label={photosViewer ? '照片查看器' : quickLook ? '文件快速预览' : '文件查看器'}
      sx={{
        position: 'fixed',
        // Use the same video-safe-area contract as the inline/Desktop Viewer.
        // No permanent black band when the immersive controls fade away.
        '--xdrive-viewer-video-actions-clearance': compactImmersive && chromeVisible
          ? 'calc(56px + env(safe-area-inset-bottom))' : '0px',
        '--xdrive-viewer-video-actions-filmstrip-clearance': compactImmersive && chromeVisible
          ? 'calc(128px + env(safe-area-inset-bottom))' : '0px',
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
        data-xdrive-web-viewer-chrome="header"
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
          // Keyboard Tab must not enter faded-out Viewer controls.
          visibility: immersive && !chromeVisible ? 'hidden' : 'visible',
          transition: 'opacity 160ms ease, visibility 160ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
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
              onClick={toggleSlideshow}
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
            data-xdrive-web-viewer-chrome="navigation"
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
              // Keyboard Tab must not enter faded-out Viewer controls.
              visibility: immersive && !chromeVisible ? 'hidden' : 'visible',
              transition: 'opacity 160ms ease, visibility 160ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <KeyboardArrowLeftRoundedIcon />
          </IconButton>
          <IconButton
            aria-label="下一个项目"
            data-xdrive-web-viewer-chrome="navigation"
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
              // Keyboard Tab must not enter faded-out Viewer controls.
              visibility: immersive && !chromeVisible ? 'hidden' : 'visible',
              transition: 'opacity 160ms ease, visibility 160ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <KeyboardArrowRightRoundedIcon />
          </IconButton>
  
          </>
        ) : null}
      </Box>

      {filmstrip && photosViewer ? (
        <Box
          data-xdrive-web-viewer-filmstrip
          data-xdrive-web-viewer-chrome="filmstrip"
          sx={{
            position: immersive ? 'absolute' : 'relative',
            left: 0,
            right: 0,
            bottom: compactTouch ? 'calc(56px + env(safe-area-inset-bottom))' : 0,
            zIndex: 2,
            width: '100%',
            minWidth: 0,
            py: 0.5,
            pl: 'max(8px, env(safe-area-inset-left))',
            pr: 'max(8px, env(safe-area-inset-right))',
            bgcolor: immersive ? 'rgba(0,0,0,.60)' : 'background.paper',
            backdropFilter: immersive ? 'blur(14px) saturate(1.25)' : undefined,
            color: immersive ? 'common.white' : 'text.primary',
            opacity: immersive && !chromeVisible ? 0 : 1,
            pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
            // Keyboard Tab must not enter faded-out Viewer controls.
            visibility: immersive && !chromeVisible ? 'hidden' : 'visible',
            transition: 'opacity 160ms ease, visibility 160ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {filmstrip}
        </Box>
      ) : null}

      {compactTouch && (actions || hasNavigation || slideshow) ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-start"
          // Eight 44px controls can fit within 375px only with no horizontal
          // gaps (352px buttons + 16px safe horizontal padding = 368px).
          // Keep the original Quick Look spacing; never shrink hit targets.
          spacing={photosViewer ? 0 : 0.5}
          data-xdrive-web-viewer-mobile-actions
          data-xdrive-web-viewer-chrome="actions"
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
            overflowX: photosViewer ? 'hidden' : 'auto',
            bgcolor: immersive ? 'rgba(0,0,0,.72)' : 'background.paper',
            color: immersive ? 'common.white' : 'text.primary',
            opacity: immersive && !chromeVisible ? 0 : 1,
            pointerEvents: immersive && !chromeVisible ? 'none' : 'auto',
            // Keyboard Tab must not enter faded-out Viewer controls.
            visibility: immersive && !chromeVisible ? 'hidden' : 'visible',
            transition: 'opacity 160ms ease, visibility 160ms',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            '& .MuiIconButton-root': { width: 44, height: 44, flexShrink: 0, color: 'inherit' },
            '& .MuiIconButton-colorError': { color: 'error.main' },
          }}
        >
          {showMobileNavigation ? <IconButton aria-label="上一个项目" disabled={!canPrevious} onClick={onPrevious}>
            <KeyboardArrowLeftRoundedIcon />
          </IconButton> : null}
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{actions}</Box>
          {slideshow && (canPrevious || canNext) ? (
            <IconButton
              aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
              onClick={toggleSlideshow}
            >
              {slideshowPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
          ) : null}
          {showMobileNavigation ? <IconButton aria-label="下一个项目" disabled={!canNext} onClick={onNext}>
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
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
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
  onDownload,
  downloadDisabled = false,
  onError,
}: {
  node: Node
  api: XDriveApi
  onShare: () => void
  onTags: () => void
  onDownload?: () => Promise<void>
  downloadDisabled?: boolean
  onError: (error: unknown) => void
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
          disabled={downloadDisabled}
          onClick={() => {
            // Media Gallery Viewer overrides only the action callback. File
            // Quick Look keeps the existing authenticated file download.
            void (onDownload ? onDownload() : api.download(node)).catch(onError)
          }}
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
    let active = true
    void api.fileTags().then((value) => {
      if (active) setTags(value)
    }).catch((error) => {
      if (active) onError(error)
    })
    return () => { active = false }
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
  // Quick Look shares the same Owner boundary as the Gallery Viewer.
  // A share/tag dialog may not attach to a different file, revision or API.
  const dialogOwnerRef = useRef({
    nodeID: route.params.node, revision: viewer.node?.revision,
    context: route.params.context, api, gallerySource, session: 0, inFlight: false,
  })
  if (dialogOwnerRef.current.nodeID !== route.params.node ||
      dialogOwnerRef.current.revision !== viewer.node?.revision ||
      dialogOwnerRef.current.context !== route.params.context ||
      dialogOwnerRef.current.api !== api ||
      dialogOwnerRef.current.gallerySource !== gallerySource) {
    dialogOwnerRef.current = {
      nodeID: route.params.node, revision: viewer.node?.revision,
      context: route.params.context, api, gallerySource,
      session: dialogOwnerRef.current.session + 1, inFlight: false,
    }
  }
  const dialogOwner = dialogOwnerRef.current
  // Continue Quick Look playback across authorized neighbors, but a new
  // authenticated API, Gallery source or collection revokes the old intent.
  const quickLookSlideshowScopeRef = useRef({
    api, gallerySource, context: route.params.context, session: 0,
  })
  if (quickLookSlideshowScopeRef.current.api !== api ||
      quickLookSlideshowScopeRef.current.gallerySource !== gallerySource ||
      quickLookSlideshowScopeRef.current.context !== route.params.context) {
    quickLookSlideshowScopeRef.current = {
      api, gallerySource, context: route.params.context,
      session: quickLookSlideshowScopeRef.current.session + 1,
    }
  }
  const [visibleDialog, setVisibleDialog] = useState<{
    owner: typeof dialogOwner
    kind: 'share' | 'tags'
  } | null>(null)
  const shareOpen = visibleDialog?.owner === dialogOwner && visibleDialog.kind === 'share'
  const tagsOpen = visibleDialog?.owner === dialogOwner && visibleDialog.kind === 'tags'
  const openDialog = (kind: 'share' | 'tags') => {
    if (dialogOwnerRef.current !== dialogOwner || !viewer.node) return
    setVisibleDialog({ owner: dialogOwner, kind })
  }
  const closeDialog = (kind: 'share' | 'tags') => {
    setVisibleDialog((current) => current?.owner === dialogOwner && current.kind === kind ? null : current)
  }
  // Quick Look shares the same exact Task Center download receipt as the
  // standalone Text/Audio and Gallery viewers. Never tie its lifetime to
  // temporary thumbnail or native media requests.
  const download = useWebViewerDownload(api, dialogOwner, viewer.node)
  const startDownload = async () => {
    if (!viewer.node || dialogOwnerRef.current !== dialogOwner ||
        dialogOwner.inFlight) return
    download.start()
  }
  const target = viewer.node ? {
    id: viewer.node.id,
    name: viewer.node.name,
    kind: viewer.node.type,
    size: viewer.node.size,
    revision: viewer.node.revision,
  } satisfies XDriveFilePreviewTarget : null
  const presentation = useXDrivePreviewPresentation(target, dialogOwner.session)
  // Files Quick Look is not a media player slideshow: video/audio/text must
  // never be timed away after a ready event from their native renderers.
  const quickLookKind = target ? xDriveClassifyFilePreview(target) : 'none'
  const quickLookSlideshowEligible = quickLookKind === 'image' || quickLookKind === 'live_photo'

  const loadThumbnail = useCallback(async (
    _target: XDriveFilePreviewTarget,
    signal?: AbortSignal,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (!viewer.node) return null
    try {
      return URL.createObjectURL(await api.mediaThumbnail(
        viewer.node.id, signal, viewer.node.revision, onProgress,
      ))
    } catch {
      return null
    }
  }, [api, viewer.node?.id, viewer.node?.revision])

  return (
    <>
      <WebViewerFrame
        chromeSessionKey={dialogOwner.session}
        title={viewer.node?.name ?? '文件预览'}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        quickLook
        slideshow={quickLookSlideshowEligible}
        keepChromeVisible={shareOpen || tagsOpen}
        slideshowOwnerKey={quickLookSlideshowScopeRef.current.session}
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
            onShare={() => openDialog('share')}
            onTags={() => openDialog('tags')}
            onDownload={startDownload}
            downloadDisabled={download.busy}
            onError={onError}
          />
        ) : null}
        onClose={() => onClose(viewer.node)}
      >
        <WebViewerDownloadFeedback download={download} />
        {viewer.loading ? (
          <WebViewerQuietFirstRead />
        ) : viewer.error || !viewer.node ? (
          <WebViewerReadError
            message={viewer.error || '文件不存在或已无法访问。'}
            onRetry={viewer.error && viewer.canRetryRead ? viewer.retryRead : undefined}
          />
        ) : <XDriveFilePreviewSurface
          key={dialogOwner.session}
          target={target}
          loadTextPreview={(currentTarget, signal) => api.fileTextPreview(Number(currentTarget.id), signal)}
          loadImagePreview={loadThumbnail}
          loadPreviewURL={async (_target, kind, signal, onProgress) => (
            kind === 'live_photo'
              ? api.mediaLivePhotoStillURL(viewer.node!.id, signal)
              : kind === 'image' && xDriveFileNeedsBrowserCompatibleImagePreview(_target.name)
                ? api.mediaAnalysisPreviewURL(viewer.node!.id, signal, viewer.node!.revision, onProgress)
                : api.filePreviewURL(viewer.node!.id, signal)
          )}
          loadLivePhotoMotion={(currentTarget, _progress, signal) =>
            api.mediaLivePhotoMotionURL(Number(currentTarget.id), signal)}
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
        key={dialogOwner.session}
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareOpen}
        tagsOpen={tagsOpen}
        onShareClose={() => closeDialog('share')}
        onTagsClose={() => closeDialog('tags')}
        onError={onError}
      /> : null}
    </>
  )
}

function WebMediaViewerApp({
  route,
  api,
  gallerySource,
  onBorrowGalleryThumbnail,
  shareDialogAdapter,
  onNavigate,
  onShowInFolder,
  onClose,
  onFileOperationQueued,
  onCreativeCompleted,
  onMediaEditorActivityChange,
  onError,
}: {
  route: Extract<XDriveWebAppRoute, { app: 'media-viewer' }>
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  onBorrowGalleryThumbnail?: XDriveRoutedGalleryThumbnailBorrower
  shareDialogAdapter: XDriveShareDialogAdapter
  onNavigate: (nodeID: number) => void
  onShowInFolder?: (location: NodeLocation) => void
  onClose: (node: Node | null) => void
  onFileOperationQueued?: () => void
  onCreativeCompleted?: () => void
  onMediaEditorActivityChange?: (active: boolean) => void
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
  // The routed Viewer only borrows a warmed cache URL from the still-mounted
  // Gallery that opened THIS exact context. A cold/direct/foreign-context
  // Viewer keeps its original Owner-scoped thumbnail transport.
  const loadRoutedGalleryThumbnail = useCallback(async (
    target: XDriveFilePreviewTarget,
    signal?: AbortSignal,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (signal?.aborted) return null
    const nodeID = Number(target.id)
    const revision = Number(target.revision)
    const lease = onBorrowGalleryThumbnail?.(route.params.context, nodeID, revision)
    if (lease) {
      if (signal?.aborted) {
        lease.release()
        return null
      }
      return lease
    }
    return gallerySource.loadThumbnail(nodeID, signal, revision, onProgress)
  }, [gallerySource, onBorrowGalleryThumbnail, route.params.context])
  const mediaItem = viewer.mediaItem
  // The actual routed Viewer is common to Mobile Web and wide Web. An iOS 27
  // compact rail cannot show ten 44px controls at 390px without sideways
  // scrolling; move only the presentation of secondary actions to More.
  const narrowMediaViewer = useMediaQuery('(max-width:899.95px)')
  const ultraNarrowMediaViewer = useMediaQuery('(max-width:367.95px)')
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  // The share, tags, inspector and More dialogs are bound to the exact
  // route/revision. A prior modal must not attach to a new Node even for a frame.
  const modalOwnerRef = useRef({
    nodeID: route.params.node,
    revision: viewer.node?.revision,
    context: route.params.context,
    api,
    gallerySource, session: 0,
  })
  if (modalOwnerRef.current.nodeID !== route.params.node ||
      modalOwnerRef.current.revision !== viewer.node?.revision ||
      modalOwnerRef.current.context !== route.params.context ||
      modalOwnerRef.current.api !== api ||
      modalOwnerRef.current.gallerySource !== gallerySource) {
    modalOwnerRef.current = {
      nodeID: route.params.node,
      revision: viewer.node?.revision,
      context: route.params.context,
      api,
      gallerySource, session: modalOwnerRef.current.session + 1,
    }
  }
  const modalOwner = modalOwnerRef.current
  // Browsing an adjacent item continues a slideshow, but a new account,
  // Gallery source or collection scope cannot inherit a prior Owner's play state.
  const slideshowScopeRef = useRef({
    api, gallerySource, context: route.params.context, session: 0,
  })
  if (slideshowScopeRef.current.api !== api ||
      slideshowScopeRef.current.gallerySource !== gallerySource ||
      slideshowScopeRef.current.context !== route.params.context) {
    slideshowScopeRef.current = {
      api, gallerySource, context: route.params.context,
      session: slideshowScopeRef.current.session + 1,
    }
  }
  const [visibleModalOwner, setVisibleModalOwner] = useState<typeof modalOwner | null>(null)
  const ownsModal = visibleModalOwner === modalOwner
  const shareVisible = ownsModal && shareOpen
  const tagsVisible = ownsModal && tagsOpen
  const infoVisible = ownsModal && infoOpen
  const locationVisible = ownsModal && locationOpen
  const openShare = () => {
    if (modalOwnerRef.current !== modalOwner) return
    setVisibleModalOwner(modalOwner)
    setShareOpen(true)
  }
  const openTags = () => {
    if (modalOwnerRef.current !== modalOwner) return
    setVisibleModalOwner(modalOwner)
    setTagsOpen(true)
  }
  const openLocation = () => {
    if (modalOwnerRef.current !== modalOwner) return
    setVisibleModalOwner(modalOwner)
    setLocationOpen(true)
  }

  // Same-tick duplicate operations and old-route callbacks cannot claim the
  // newer Viewer. Server transfers continue; only their visible owner expires.
  const actionOwnerRef = useRef({
    nodeID: route.params.node,
    revision: viewer.node?.revision,
    context: route.params.context,
    api,
    gallerySource,
    inFlight: false,
  })
  if (actionOwnerRef.current.nodeID !== route.params.node ||
      actionOwnerRef.current.revision !== viewer.node?.revision ||
      actionOwnerRef.current.context !== route.params.context ||
      actionOwnerRef.current.api !== api ||
      actionOwnerRef.current.gallerySource !== gallerySource) {
    actionOwnerRef.current = {
      nodeID: route.params.node,
      revision: viewer.node?.revision,
      context: route.params.context,
      api,
      gallerySource,
      inFlight: false,
    }
  }
  const actionOwner = actionOwnerRef.current
  // The authenticated Web Gallery single-item download resolves to
  // XDriveApi.download; retain the existing server ticket/FS-access path.
  // Its progress receipt is strictly this Node/revision/route session.
  const viewerDownload = useWebViewerDownload(api, actionOwner, viewer.node)
  const [busyViewerAction, setBusyViewerAction] = useState<{
    owner: typeof actionOwner
    kind: 'favorite' | 'download'
  } | null>(null)
  const actionBusy = busyViewerAction?.owner === actionOwner ? busyViewerAction.kind : null
  const runViewerAction = (kind: 'favorite' | 'download', task: () => Promise<unknown>) => {
    if (actionOwnerRef.current !== actionOwner || actionOwner.inFlight ||
        !viewer.node || !mediaItem ||
        viewer.node.id !== mediaItem.node.id ||
        viewer.node.revision !== mediaItem.node.revision) return
    actionOwner.inFlight = true
    setBusyViewerAction({ owner: actionOwner, kind })
    void Promise.resolve().then(task).catch((error) => {
      if (actionOwnerRef.current === actionOwner) onError(error)
    }).finally(() => {
      actionOwner.inFlight = false
      if (actionOwnerRef.current === actionOwner) setBusyViewerAction(null)
    })
  }
  // A dialog belongs to one actual Node revision. Navigating the bounded
  // Filmstrip must never reopen a previous asset's editor on the next photo.
  const [editTarget, setEditTarget] = useState<{ id: number; revision: number; owner: typeof modalOwner } | null>(null)
  // The shared Creative Dialog owns its own Server job. This target is only
  // the visible originating Viewer session, not a second task controller.
  const [creativeTarget, setCreativeTarget] = useState<{
    id: number; revision: number; context?: string; owner: typeof modalOwner
  } | null>(null)
  const creativeTargetRef = useRef(creativeTarget)
  creativeTargetRef.current = creativeTarget
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; revision: number; owner: typeof modalOwner } | null>(null)
  // Each accepted delete remains owned by its original Viewer session.
  // A pending old-route receipt must not disable or close a newer session.
  const [deleteBusyOwner, setDeleteBusyOwner] = useState<typeof modalOwner | null>(null)
  const deleteBusy = deleteBusyOwner === modalOwner
  const deleteInFlightRef = useRef(new Set<typeof modalOwner>())
  // Deletion belongs to the original Node/revision and browse route; a late
  // Task Center receipt must never close a newer Filmstrip item.
  const currentDeleteRouteRef = useRef({
    node: route.params.node, context: route.params.context, revision: viewer.node?.revision,
    api, gallerySource,
  })
  currentDeleteRouteRef.current = {
    node: route.params.node, context: route.params.context, revision: viewer.node?.revision,
    api, gallerySource,
  }
  useEffect(() => {
    setEditTarget(null)
    setCreativeTarget(null)
    setDeleteTarget(null)
    setMoreAnchor(null)
    setShareOpen(false)
    setTagsOpen(false)
    setInfoOpen(false)
    setAlbums([])
    setVisibleModalOwner(null)
    setLocationOpen(false)
  }, [route.params.node, route.params.context, viewer.node?.revision, api, gallerySource])
  // A More sheet opened at 899px must not reappear if the viewport crosses
  // 900px and returns. Menu ownership belongs to the current compact chrome.
  useEffect(() => {
    if (!narrowMediaViewer) setMoreAnchor(null)
  }, [narrowMediaViewer])
  const [albums, setAlbums] = useState<MediaAlbum[]>([])

  const openInfo = () => {
    if (modalOwnerRef.current !== modalOwner) return
    const opening = !ownsModal || !infoOpen
    setVisibleModalOwner(modalOwner)
    setInfoOpen(opening)
    if (opening) void gallerySource.listAlbums().then((value) => {
      if (modalOwnerRef.current === modalOwner) setAlbums(value)
    }).catch((error) => {
      if (modalOwnerRef.current === modalOwner) onError(error)
    })
  }

  const previewKind = viewer.node ? xDriveClassifyFilePreview({
    name: viewer.node.name,
    kind: viewer.node.type,
  }) : ''
  const supported = ['image', 'video', 'live_photo'].includes(previewKind)
  const slideshowTarget = mediaItem && viewer.node &&
    viewer.node.id === mediaItem.node.id && viewer.node.revision === mediaItem.node.revision
    ? { id: viewer.node.id, name: viewer.node.name, kind: 'file' as const, revision: viewer.node.revision }
    : null
  const slideshowPresentation = useXDrivePreviewPresentation(slideshowTarget, modalOwner.session)
  // Never auto-skip a video after mere metadata/loadeddata readiness. A video
  // terminates the still-only slideshow, retaining ordinary manual playback.
  const slideshowEligible = Boolean(slideshowTarget && !viewer.loading && !viewer.error &&
    (previewKind === 'image' || previewKind === 'live_photo'))
  const editingItem = mediaItem && viewer.node?.id === mediaItem.node.id &&
    editTarget?.id === mediaItem.node.id && editTarget.revision === mediaItem.node.revision &&
    editTarget.owner === modalOwner
      ? mediaItem : null
  const editOpen = Boolean(editingItem)
  const creativeItem = mediaItem && viewer.node?.id === mediaItem.node.id &&
    creativeTarget?.id === mediaItem.node.id &&
    creativeTarget.revision === mediaItem.node.revision &&
    creativeTarget.context === route.params.context &&
    creativeTarget.owner === modalOwner ? mediaItem : null
  const creativeOpen = Boolean(creativeItem)

  // Report the already-owned dialog sessions, not their media contents. A
  // mounted edit/creative dialog can hold an unsaved draft or active action.
  // Closing/switching Viewer clears the hint, but never cancels Server work.
  useEffect(() => {
    onMediaEditorActivityChange?.(editOpen || creativeOpen)
  }, [editOpen, creativeOpen, onMediaEditorActivityChange])
  useEffect(() => () => {
    onMediaEditorActivityChange?.(false)
  }, [onMediaEditorActivityChange])

  const deletingItem = mediaItem && viewer.node?.id === mediaItem.node.id &&
    deleteTarget?.id === mediaItem.node.id && deleteTarget.revision === mediaItem.node.revision &&
    deleteTarget.owner === modalOwner
      ? mediaItem : null
  const deleteOpen = Boolean(deletingItem)
  const submitDelete = () => {
    if (!deletingItem || !gallerySource.deleteItems ||
        modalOwnerRef.current !== modalOwner || deleteInFlightRef.current.has(modalOwner)) return
    const item = deletingItem
    const initiatingOwner = modalOwner
    const targetNode = item.node
    const targetContext = route.params.context
    const stillAtTarget = () => modalOwnerRef.current === initiatingOwner &&
      currentDeleteRouteRef.current.node === targetNode.id &&
      currentDeleteRouteRef.current.context === targetContext &&
      currentDeleteRouteRef.current.revision === targetNode.revision &&
      currentDeleteRouteRef.current.api === api &&
      currentDeleteRouteRef.current.gallerySource === gallerySource
    deleteInFlightRef.current.add(initiatingOwner)
    setDeleteBusyOwner(initiatingOwner)
    void gallerySource.deleteItems([item]).then((operation) => {
      // A queued file operation is a Task Center receipt, NOT proof that the
      // photo has already been moved to Trash or that its bytes are gone.
      if (operation && (operation.status === 'failed' || operation.status === 'cancelled')) {
        throw new Error('服务端未接受删除任务，请在任务中心核查或重试。')
      }
      if (stillAtTarget()) {
        onFileOperationQueued?.()
        setDeleteTarget(null)
        onClose(targetNode)
      }
    }).catch((error) => {
      if (stillAtTarget()) onError(error)
    }).finally(() => {
      deleteInFlightRef.current.delete(initiatingOwner)
      setDeleteBusyOwner((current) => current === initiatingOwner ? null : current)
    })
  }

const canCreate = Boolean(gallerySource.createCreativeGeneration &&
    gallerySource.getCreativeGeneration && gallerySource.loadPreviewURL &&
    !viewer.isTrashContext && xDriveMediaItemSupportsCreative(mediaItem))
  const canEdit = Boolean(gallerySource.saveEditRecipe &&
    xDriveMediaItemSupportsBasicEditing(mediaItem))
  const canDelete = Boolean(gallerySource.deleteItems && !viewer.isTrashContext)

  const startDownload = () => {
    if (!viewer.node || !mediaItem ||
        viewer.node.id !== mediaItem.node.id ||
        viewer.node.revision !== mediaItem.node.revision ||
        actionOwnerRef.current !== actionOwner || actionOwner.inFlight) return
    const currentNode = viewer.node
    const currentItem = mediaItem
    // Preserve the existing Gallery DataSource as the authority for media
    // download, failure/retry, bulk actions and Owner revision semantics.
    // Only the Web adapter's optional one-item path exposes its exact Task
    // Center receipt; older/test/other hosts keep their normal delegation.
    const sourceWithReceipt = gallerySource as MediaGalleryDataSource & {
      downloadItemsWithReceipt?: (
        items: Parameters<NonNullable<MediaGalleryDataSource['downloadItems']>>[0],
        onCreated: (transferID: string) => void,
      ) => Promise<unknown>
    }
    runViewerAction('download', async () => {
      if (sourceWithReceipt.downloadItemsWithReceipt) {
        await sourceWithReceipt.downloadItemsWithReceipt(
          [currentItem], viewerDownload.onTransferCreated,
        )
      } else if (gallerySource.downloadItems) {
        await gallerySource.downloadItems([currentItem])
      } else {
        await api.download(currentNode)
      }
    })
  }

  const latitude = mediaItem?.metadata.latitude
  const longitude = mediaItem?.metadata.longitude
  const hasPhotoGPS = typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  const actions = !viewer.loading && !viewer.error && supported && viewer.node && mediaItem && mediaItem.node.id === viewer.node.id ? (
    <Stack direction="row" spacing={narrowMediaViewer ? 0 : 0.25} data-xdrive-gallery-viewer-actions>
      {mediaItem && gallerySource.setFavorite ? (
        <Tooltip title={mediaItem.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            size="small"
            aria-label={mediaItem.favorite ? '取消收藏' : '收藏'}
            disabled={Boolean(actionBusy)}
            onClick={() => {
              const favorite = !mediaItem.favorite
              const initiatingItem = mediaItem
              runViewerAction('favorite', async () => {
                await gallerySource.setFavorite!(initiatingItem.node.id, favorite)
                viewer.updateMediaItem(initiatingItem, { favorite })
              })
            }}
          >
            {mediaItem.favorite
              ? <StarRoundedIcon fontSize="small" />
              : <StarBorderRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowMediaViewer && canCreate ? (
        <Tooltip title="创作">
          <IconButton
            size="small"
            aria-label="创作图片"
            onClick={() => setCreativeTarget({
              id: mediaItem.node.id,
              revision: mediaItem.node.revision,
              context: route.params.context,
              owner: modalOwner,
            })}
          >
            <AutoFixHighRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowMediaViewer && canEdit ? (
        <Tooltip title="编辑">
          <IconButton
            size="small"
            aria-label="编辑媒体"
            onClick={() => setEditTarget({
              id: mediaItem.node.id,
              revision: mediaItem.node.revision,
              owner: modalOwner,
            })}
          >
            <EditRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {canDelete ? (
        <Tooltip title="删除">
          <IconButton
            size="small"
            aria-label="删除媒体"
            disabled={deleteBusy || Boolean(actionBusy)}
            onClick={() => setDeleteTarget({
              id: mediaItem.node.id,
              revision: mediaItem.node.revision,
              owner: modalOwner,
            })}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowMediaViewer && hasPhotoGPS ? (
        <Tooltip title="在地图上查看照片">
          <IconButton size="small" aria-label="在地图上查看照片" onClick={openLocation}>
            <MapOutlinedIcon fontSize="small" />
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
      {!narrowMediaViewer && gallerySource.exportLivePhoto &&
      (mediaItem.live_photo || mediaItem.asset_kind === 'live_photo') ? (
        <Tooltip title="导出完整实况（照片与动态原件）">
          <IconButton
            size="small"
            aria-label="导出完整实况"
            onClick={() => {
              runViewerAction('download', () => gallerySource.exportLivePhoto!(mediaItem))
            }}
          >
            <ArchiveRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowMediaViewer ? (
        <FileViewerActions
          node={viewer.node}
          api={api}
          onShare={openShare}
          onTags={openTags}
          onDownload={async () => { startDownload() }}
          downloadDisabled={Boolean(actionBusy) || viewerDownload.busy}
          onError={onError}
        />
      ) : (
        <>
          <Tooltip title="分享">
            <IconButton size="small" aria-label="分享媒体"
              onClick={openShare}>
              <ShareRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="更多">
            <IconButton
              size="small"
              aria-label="更多照片操作"
              aria-haspopup="menu"
              aria-controls={moreAnchor ? 'xdrive-gallery-viewer-more' : undefined}
              aria-expanded={Boolean(moreAnchor)}
              onClick={(event) => {
                if (modalOwnerRef.current !== modalOwner) return
                setVisibleModalOwner(modalOwner)
                setMoreAnchor(event.currentTarget)
              }}
            >
              <MoreHorizRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  ) : null

  return (
    <>
      <WebViewerFrame
        chromeSessionKey={modalOwner.session}
        title={viewer.node?.name ?? '媒体查看器'}
        subtitle={mediaItem && mediaItem.node.id === viewer.node?.id ? xDriveMediaCaptureTimeLabel(mediaItem.metadata.captured_at) : undefined}
        positionLabel={viewer.totalCount > 0 ? `${viewer.activeIndex + 1} / ${viewer.totalCount}` : undefined}
        immersive
        photosViewer
        slideshow={slideshowEligible}
        slideshowOwnerKey={slideshowScopeRef.current.session}
        sourceKey={slideshowPresentation.sourceKey}
        presentationState={slideshowPresentation.presentationState}
        navigationLoading={viewer.loading || viewer.navigationLoading}
        keepChromeVisible={shareVisible || tagsVisible || infoVisible || editOpen || creativeOpen || deleteOpen || locationVisible || (ownsModal && Boolean(moreAnchor))}
        canPrevious={Boolean(viewer.previous)}
        canNext={Boolean(viewer.next)}
        onPrevious={viewer.goPrevious}
        onNext={viewer.goNext}
        actions={actions}
        filmstrip={mediaItem && viewer.filmstripEntries.length > 0 ? (
          <XDriveMediaGalleryFilmstrip
            entries={viewer.filmstripEntries}
            activeIndex={viewer.activeIndex}
            loadThumbnail={gallerySource.loadThumbnail}
            onSelect={viewer.goToFilmstripIndex}
          />
        ) : undefined}
        onClose={() => onClose(viewer.node)}
      >
        <WebViewerDownloadFeedback download={viewerDownload} />
        {viewer.loading ? (
          <WebViewerQuietFirstRead />
        ) : viewer.error || !viewer.node ? (
          <WebViewerReadError
            message={viewer.error || '媒体不存在或已无法访问。'}
            onRetry={viewer.error && viewer.canRetryRead ? viewer.retryRead : undefined}
          />
        ) : !supported ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2 }}>
            <XDriveStatusAlert tone="warning">此文件不是图片、视频或实况照片。</XDriveStatusAlert>
          </Box>
        ) : !mediaItem || mediaItem.node.id !== viewer.node.id ? (
          <WebViewerQuietFirstRead />
        ) : <XDriveMediaViewerContent
          key={modalOwner.session}
          item={mediaItem}
          loadThumbnail={gallerySource.loadThumbnail}
          loadBorrowedThumbnail={onBorrowGalleryThumbnail ? loadRoutedGalleryThumbnail : undefined}
          loadLivePhotoMotion={gallerySource.loadLivePhotoMotion}
          loadPreviewURL={gallerySource.loadPreviewURL}
          onPresentationStateChange={slideshowPresentation.onPresentationStateChange}
          videoControlsSafeArea={narrowMediaViewer ? (viewer.filmstripEntries.length > 0 ? 'actions-filmstrip' : 'actions') : undefined}
          interactiveImage
          onSwipePrevious={viewer.previous ? viewer.goPrevious : undefined}
          onSwipeNext={viewer.next ? viewer.goNext : undefined}
          minHeight={0}
          maxHeight="none"
        />}
      </WebViewerFrame>
      {locationVisible && mediaItem ? (
        <XDriveMediaGalleryViewerLocationDialog
          open
          item={mediaItem}
          onOpenDynamicMap={() => {
            setLocationOpen(false)
            window.location.hash = xDriveWebAppHash({ app: 'gallery', params: { section: 'places' } })
          }}
          onClose={() => setLocationOpen(false)}
        />
      ) : null}
      <Menu
        id="xdrive-gallery-viewer-more"
        anchorEl={ownsModal ? moreAnchor : null}
        open={Boolean(moreAnchor) && ownsModal && narrowMediaViewer &&
          !viewer.loading && !viewer.error && Boolean(mediaItem) &&
          viewer.node?.id === mediaItem?.node.id}
        onClose={() => setMoreAnchor(null)}
        MenuListProps={{ 'aria-label': '更多照片操作' }}
      >
        {ultraNarrowMediaViewer && viewer.previous ? (
          <MenuItem aria-label="上一张" onClick={() => {
            if (modalOwnerRef.current !== modalOwner) return
            setMoreAnchor(null)
            viewer.goPrevious()
          }}>上一张</MenuItem>
        ) : null}
        {ultraNarrowMediaViewer && viewer.next ? (
          <MenuItem aria-label="下一张" onClick={() => {
            if (modalOwnerRef.current !== modalOwner) return
            setMoreAnchor(null)
            viewer.goNext()
          }}>下一张</MenuItem>
        ) : null}
        {canEdit && mediaItem ? (
          <MenuItem aria-label="编辑媒体" onClick={() => {
            setMoreAnchor(null)
            setEditTarget({
              id: mediaItem.node.id,
              revision: mediaItem.node.revision,
              owner: modalOwner,
            })
          }}>编辑媒体</MenuItem>
        ) : null}
        {canCreate && mediaItem ? (
          <MenuItem aria-label="创作图片" onClick={() => {
            setMoreAnchor(null)
            setCreativeTarget({
              id: mediaItem.node.id,
              revision: mediaItem.node.revision,
              context: route.params.context,
              owner: modalOwner,
            })
          }}>创作图片</MenuItem>
        ) : null}
        {hasPhotoGPS ? (
          <MenuItem aria-label="在地图上查看照片" onClick={() => {
            setMoreAnchor(null)
            openLocation()
          }}>在地图上查看照片</MenuItem>
        ) : null}
        <MenuItem aria-label="标签" onClick={() => {
          setMoreAnchor(null)
          openTags()
        }}>标签</MenuItem>
        {gallerySource.exportLivePhoto && mediaItem &&
        (mediaItem.live_photo || mediaItem.asset_kind === 'live_photo') ? (
          <MenuItem aria-label="导出完整实况" onClick={() => {
            setMoreAnchor(null)
            runViewerAction('download', () => gallerySource.exportLivePhoto!(mediaItem))
          }} disabled={Boolean(actionBusy)}>导出完整实况</MenuItem>
        ) : null}
        <MenuItem aria-label="下载" onClick={() => {
          setMoreAnchor(null)
          startDownload()
        }} disabled={Boolean(actionBusy) || viewerDownload.busy}>下载</MenuItem>
      </Menu>
      {viewer.node ? <FileDialogs
        key={modalOwner.session}
        node={viewer.node}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        shareOpen={shareVisible}
        tagsOpen={tagsVisible}
        onShareClose={() => setShareOpen(false)}
        onTagsClose={() => setTagsOpen(false)}
        onError={onError}
      /> : null}
      <XDriveConfirmDialog
        open={deleteOpen}
        title="删除这张照片或视频？"
        description="将提交移入回收站的文件操作。任务可能仍在进行中，可在任务中心核查状态或取消。"
        confirmLabel="删除"
        confirmIntent="danger"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={submitDelete}
      />
      <XDriveMediaGalleryCreativeDialog
        open={creativeOpen}
        item={creativeItem}
        loadPreviewURL={gallerySource.loadPreviewURL}
        onCreate={gallerySource.createCreativeGeneration
          ? (item, input) => gallerySource.createCreativeGeneration!(item.node.id, input)
          : undefined}
        onGet={gallerySource.getCreativeGeneration}
        onCancel={gallerySource.cancelCreativeGeneration}
        onCompleted={(generation) => {
          // Only a completed generation of the still-active originating
          // Node/revision can refresh the one mounted Gallery collection.
          // Old asynchronous job results cannot mutate the next Viewer route.
          if (!creativeItem || !creativeTarget ||
              creativeTargetRef.current !== creativeTarget ||
              currentDeleteRouteRef.current.node !== creativeItem.node.id ||
              currentDeleteRouteRef.current.revision !== creativeItem.node.revision ||
              currentDeleteRouteRef.current.context !== route.params.context ||
              generation.state !== 'completed' || !generation.output_node_id ||
              generation.source_node_id !== creativeItem.node.id ||
              generation.source_node_revision !== creativeItem.node.revision) return
          onCreativeCompleted?.()
        }}
        onClose={() => setCreativeTarget(null)}
      />
      <XDriveMediaGalleryEditDialog
        open={editOpen}
        item={editingItem}
        loadThumbnail={gallerySource.loadThumbnail}
        loadPreviewURL={gallerySource.loadPreviewURL}
        onSave={async (item, input) => {
          if (!gallerySource.saveEditRecipe) throw new Error('当前客户端不支持媒体编辑')
          const recipe = await gallerySource.saveEditRecipe(item.node.id, input)
          viewer.updateMediaItem(item, { edit_recipe: recipe.revision ? recipe : undefined })
          return recipe
        }}
        onReset={gallerySource.resetEditRecipe ? async (item, revision) => {
          const recipe = await gallerySource.resetEditRecipe!(item.node.id, revision)
          viewer.updateMediaItem(item, { edit_recipe: recipe.revision ? recipe : undefined })
          return recipe
        } : undefined}
        onClose={() => setEditTarget(null)}
      />
      <XDriveMediaDetailsInspector
        item={infoVisible ? mediaItem : null}
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

// The standalone Text/PDF/Audio viewers have one authenticated download intent
// per exact route/Owner/Node revision. A stale callback or receipt cannot act
// on another account, and repeated taps are single-flight immediately.
function useWebViewerDownload(api: XDriveApi, owner: object, node: Node | null) {
  const tokenRef = useRef({
    api, owner, nodeID: node?.id, revision: node?.revision,
  })
  if (tokenRef.current.api !== api || tokenRef.current.owner !== owner ||
      tokenRef.current.nodeID !== node?.id ||
      tokenRef.current.revision !== node?.revision) {
    tokenRef.current = { api, owner, nodeID: node?.id, revision: node?.revision }
  }
  const token = tokenRef.current
  const pendingRef = useRef<typeof token | null>(null)
  const mountedRef = useRef(true)
  const [receipt, setReceipt] = useState<{
    token: typeof token
    busy: boolean
    error: string
  } | null>(null)
  // Task Center is authoritative. Never guess the transfer from a filename:
  // a second window may download an identically named file concurrently.
  const [trackedTransfer, setTrackedTransfer] = useState<{
    token: typeof token
    id: string
    task: XDriveTransferTask | null
  } | null>(null)
  const currentTransferID = trackedTransfer?.token === token ? trackedTransfer.id : null
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    if (!currentTransferID) return
    return api.onTransfers((items) => {
      if (!mountedRef.current || tokenRef.current !== token) return
      const task = items.find((candidate) =>
        candidate.id === currentTransferID &&
        candidate.kind === 'download' &&
        candidate.cloud_node_id === token.nodeID) ?? null
      setTrackedTransfer((current) => {
        if (!current || current.token !== token || current.id !== currentTransferID ||
            current.task === task) return current
        return { ...current, task }
      })
    })
  }, [api, currentTransferID, token])

  const onTransferCreated = (id: string) => {
    if (!node || !mountedRef.current || tokenRef.current !== token ||
        typeof api.transfers !== 'function') return
    // Exact Server/Web Task Center ID is required. Never guess from a
    // filename or inspect another Owner/Node's transfer.
    const task = api.transfers().find((candidate) =>
      candidate.id === id && candidate.kind === 'download' &&
      candidate.cloud_node_id === node.id) ?? null
    if (task) setTrackedTransfer({ token, id, task })
  }
  const start = () => {
    if (!node || !mountedRef.current || tokenRef.current !== token ||
        pendingRef.current === token) return
    pendingRef.current = token
    const downloadNode = node
    setTrackedTransfer(null)
    setReceipt({ token, busy: true, error: '' })
    void Promise.resolve().then(() => api.download(downloadNode, {
      onTransferCreated,
    })).then(() => {
      if (mountedRef.current && tokenRef.current === token) {
        setReceipt({ token, busy: false, error: '' })
      }
    }, () => {
      if (mountedRef.current && tokenRef.current === token) {
        // Keep untrusted ticket/Authorization/path details out of React state.
        setReceipt({
          token, busy: false,
          error: '下载失败，可再次点击下载按钮重试。',
        })
      }
    }).finally(() => {
      if (pendingRef.current === token) pendingRef.current = null
    })
  }
  const activeTask = trackedTransfer?.token === token ? trackedTransfer.task : null
  const error = receipt?.token === token ? receipt.error : ''
  return {
    start,
    onTransferCreated,
    busy: receipt?.token === token && receipt.busy,
    error,
    status: !error && activeTask ? xDriveViewerDownloadTransferLabel(activeTask) : '',
    // Live bytes may update frequently. Preserve accessible text, but announce
    // only terminal/handoff transitions to avoid flooding VoiceOver.
    announceStatus: Boolean(!error && activeTask &&
      ['completed', 'failed', 'cancelled', 'handed_off'].includes(activeTask.state)),
  }
}

// Standalone text/audio metadata uses one explicit-retry Owner reader.
// Changing route, account, or attempt aborts the old in-flight request;
 // old callbacks cannot paint into the new file, even across A→B→A.
function useWebViewerRemoteRead<T>(
  owner: object,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const liveOwnerRef = useRef(owner)
  liveOwnerRef.current = owner
  const [attemptState, setAttemptState] = useState({ owner, generation: 0 })
  const generation = attemptState.owner === owner ? attemptState.generation : 0
  const [readState, setReadState] = useState<{
    owner: object
    generation: number
    value: T | null
    error: string
  } | null>(null)
  const requestRef = useRef<{
    owner: object
    generation: number
    controller: AbortController
  } | null>(null)
  const retryGateRef = useRef<{ owner: object; generation: number } | null>(null)
  const current = readState?.owner === owner && readState.generation === generation ? readState : null

  useEffect(() => {
    const controller = new AbortController()
    const request = { owner, generation, controller }
    requestRef.current = request
    void Promise.resolve().then(() => load(controller.signal)).then((value) => {
      if (!controller.signal.aborted && liveOwnerRef.current === owner &&
          requestRef.current === request) {
        setReadState({ owner, generation, value, error: '' })
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && liveOwnerRef.current === owner &&
          requestRef.current === request) {
        setReadState({
          owner, generation, value: null,
          error: reason instanceof Error ? reason.message : String(reason),
        })
      }
    })
    return () => {
      controller.abort()
      if (requestRef.current === request) requestRef.current = null
    }
  }, [owner, generation, load])

  const retryRead = () => {
    if (liveOwnerRef.current !== owner || !current?.error ||
        (retryGateRef.current?.owner === owner &&
          retryGateRef.current.generation === generation)) return
    retryGateRef.current = { owner, generation }
    // Abort immediately on the click, not after the next useEffect cleanup.
    if (requestRef.current?.owner === owner) requestRef.current.controller.abort()
    setAttemptState((previous) => ({
      owner, generation: previous.owner === owner ? previous.generation + 1 : 1,
    }))
  }
  return { value: current?.value ?? null, error: current?.error ?? '', retryRead }
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
  // One reader per API and route, even when navigation returns A→B→A.
  // Ownership changes during render, before any stale response can paint.
  const readerOwnerRef = useRef({ api, nodeID: route.params.node })
  if (readerOwnerRef.current.api !== api ||
      readerOwnerRef.current.nodeID !== route.params.node) {
    readerOwnerRef.current = { api, nodeID: route.params.node }
  }
  const readerOwner = readerOwnerRef.current
  const loadText = useCallback(async (signal: AbortSignal) => {
    const [node, preview] = await Promise.all([
      api.node(readerOwner.nodeID, signal),
      api.fileTextPreview(readerOwner.nodeID, signal),
    ])
    // A successful HTTP response without a usable text body is terminal,
    // not an infinite quiet spinner. The user may explicitly retry.
    if (!node) throw new Error('当前文件信息不可用，请重试。')
    if (!preview) throw new Error('当前文件无法生成文本预览，请重试。')
    return { node, preview }
  }, [api, readerOwner])
  const read = useWebViewerRemoteRead(readerOwner, loadText)
  const node = read.value?.node ?? null
  const preview = read.value?.preview ?? null
  const error = read.error
  const download = useWebViewerDownload(api, readerOwner, node)
  const [wrap, setWrap] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

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
          <Tooltip title={download.busy ? '正在下载' : '下载完整文件'}>
            <IconButton size="small" aria-label="下载完整文件"
              disabled={download.busy} onClick={download.start}>
              <DownloadRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : null}
      onClose={() => onClose(node)}
    >
      <WebViewerDownloadFeedback download={download} />
      {error ? (
        <WebViewerReadError message={error} onRetry={read.retryRead} />
      ) : !node || !preview ? (
        <WebViewerQuietFirstRead />
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
  // A→B→A and same-ID cross-account navigation each require a fresh
  // authorized metadata read; route-name changes also create a new Owner.
  const readerOwnerRef = useRef({ api, nodeID: route.params.node, app: route.app })
  if (readerOwnerRef.current.api !== api ||
      readerOwnerRef.current.nodeID !== route.params.node ||
      readerOwnerRef.current.app !== route.app) {
    readerOwnerRef.current = { api, nodeID: route.params.node, app: route.app }
  }
  const readerOwner = readerOwnerRef.current
  const loadNode = useCallback(async (signal: AbortSignal) => {
    const value = await api.node(readerOwner.nodeID, signal)
    // Leave PDF's existing behavior unchanged; Audio must not silently stay
    // pending after an empty but successful metadata response.
    if (readerOwner.app === 'audio-player' && !value) {
      throw new Error('当前音频文件信息不可用，请重试。')
    }
    return value
  }, [api, readerOwner])
  const read = useWebViewerRemoteRead(readerOwner, loadNode)
  const node = read.value
  const error = read.error
  const download = useWebViewerDownload(api, readerOwner, node)

  return (
    <WebViewerFrame
      title={node?.name ?? (route.app === 'pdf-viewer' ? 'PDF 查看器' : '音频播放器')}
      actions={node && !error ? (
        <Tooltip title={download.busy ? '正在下载' : '下载'}>
          <IconButton size="small" aria-label="下载"
            disabled={download.busy} onClick={download.start}>
            <DownloadRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      onClose={() => onClose(node)}
    >
      <WebViewerDownloadFeedback download={download} />
      {error ? (
        <WebViewerReadError
          message={error}
          onRetry={route.app === 'audio-player' ? read.retryRead : undefined}
        />
      ) : !node ? (
        <WebViewerQuietFirstRead />
      ) : <XDriveFilePreviewSurface
        target={{
          id: node.id,
          name: node.name,
          kind: node.type,
          size: node.size,
          revision: node.revision,
        }}
        loadPreviewURL={async (_target, kind, signal) => {
          if (route.app === 'pdf-viewer' && kind !== 'pdf') return null
          if (route.app === 'audio-player' && kind !== 'audio') return null
          const url = await api.filePreviewURL(node.id, signal)
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
  onBorrowGalleryThumbnail,
  shareDialogAdapter,
  onReplaceRoute,
  onShowInFolder,
  onClose,
  onFileOperationQueued,
  onCreativeCompleted,
  onMediaEditorActivityChange,
  onError,
}: {
  route: XDriveWebAppRoute
  api: XDriveApi
  gallerySource: MediaGalleryDataSource
  onBorrowGalleryThumbnail?: XDriveRoutedGalleryThumbnailBorrower
  shareDialogAdapter: XDriveShareDialogAdapter
  onReplaceRoute: (route: XDriveWebAppRoute) => void
  onShowInFolder?: (location: NodeLocation) => void
  onClose: (node: Node | null) => void
  onFileOperationQueued?: () => void
  onCreativeCompleted?: () => void
  onMediaEditorActivityChange?: (active: boolean) => void
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
        onBorrowGalleryThumbnail={onBorrowGalleryThumbnail}
        shareDialogAdapter={shareDialogAdapter}
        onNavigate={(nodeID) => onReplaceRoute({
          app: 'media-viewer',
          params: { ...route.params, node: nodeID },
        })}
        onShowInFolder={onShowInFolder}
        onClose={onClose}
        onFileOperationQueued={onFileOperationQueued}
        onCreativeCompleted={onCreativeCompleted}
        onMediaEditorActivityChange={onMediaEditorActivityChange}
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

export { xDriveWebOpenRouteForNode } from './webViewerRoute'

export function xDriveWebRouteURL(route: XDriveWebAppRoute) {
  return xDriveWebAppHash(route)
}
