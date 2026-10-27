import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { Box, IconButton, Menu, MenuItem, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'
import type {
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaItem,
  MediaBaiduMapConsent,
  MediaBaiduMapConsentInput,
  MediaBaiduMapIndexJob,
  MediaBaiduMapIndexJobInput,
} from '../models'
import {
  xDriveMediaItemSupportsBasicEditing,
} from '../media-edit'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveFeedbackSnackbar } from './FeedbackSnackbar'
import { XDriveOpenPreviewDialog } from './FileOpenPreviewDialog'
import {
  XDriveMediaGalleryCreativeDialog,
  xDriveMediaItemSupportsCreative,
} from './MediaGalleryCreativeDialog'
import { XDriveMediaGalleryEditDialog } from './MediaGalleryEditDialog'
import { XDriveMediaGalleryViewerLocationDialog } from './MediaGalleryViewerLocationDialog'
import { XDriveMediaGalleryFilmstrip } from './MediaGalleryFilmstrip'
import type { XDriveMediaGalleryFilmstripEntry } from './MediaGalleryFilmstrip'
import { XDriveMediaViewerContent } from './MediaViewerContent'
import { useXDriveViewerDownloadReceipt } from './useViewerDownloadReceipt'
import type { XDriveViewerDownloadReceiptPort } from './useViewerDownloadReceipt'
import type { XDriveFilePreviewImageLoader } from './FilePreviewSurface'
import { useXDrivePreviewPresentation, useXDrivePreviewSlideshow } from './usePreviewSlideshow'
import { xDriveClassifyFilePreview } from '../file-preview'
import { xDriveMediaCaptureTimeLabel } from '../media-viewer'
import type {
  MediaMotionLoader,
  MediaPreviewURLLoader,
  MediaThumbnailLoader,
} from './MediaGallery'

type ViewerAction = 'favorite' | 'download' | 'delete' | ''

export function XDriveMediaGalleryViewer({
  item,
  positionLabel,
  canPrevious,
  canNext,
  filmstripEntries,
  activeIndex,
  loadThumbnail,
  loadBorrowedThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  getBaiduMapConsent,
  saveBaiduMapConsent,
  revokeBaiduMapConsent,
  getBaiduMapIndexJob,
  enqueueBaiduMapIndexJob,
  cancelBaiduMapIndexJob,
  onOpenDynamicMap,
  onPrevious,
  onNext,
  onFilmstripSelect,
  externalInteractionPaused = false,
  onToggleFavorite,
  onInfo,
  onSaveEditRecipe,
  onResetEditRecipe,
  onCreateCreativeGeneration,
  onGetCreativeGeneration,
  onCancelCreativeGeneration,
  onCreativeCompleted,
  onDownload,
  viewerDownloadReceipt,
  onExportLivePhoto,
  onShare,
  onDelete,
  parentReportsViewerActionErrors = false,
  onClose,
}: {
  item: MediaItem | null
  positionLabel?: ReactNode
  canPrevious: boolean
  canNext: boolean
  filmstripEntries: readonly XDriveMediaGalleryFilmstripEntry[]
  activeIndex: number
  loadThumbnail: MediaThumbnailLoader
  loadBorrowedThumbnail?: XDriveFilePreviewImageLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  getBaiduMapConsent?: (nodeID: number) => Promise<MediaBaiduMapConsent>
  saveBaiduMapConsent?: (nodeID: number, input: MediaBaiduMapConsentInput) => Promise<MediaBaiduMapConsent>
  revokeBaiduMapConsent?: (nodeID: number, revision: number) => Promise<MediaBaiduMapConsent>
  getBaiduMapIndexJob?: (nodeID: number) => Promise<MediaBaiduMapIndexJob>
  enqueueBaiduMapIndexJob?: (nodeID: number, input: MediaBaiduMapIndexJobInput) => Promise<MediaBaiduMapIndexJob>
  cancelBaiduMapIndexJob?: (nodeID: number, revision: number) => Promise<MediaBaiduMapIndexJob>
  onOpenDynamicMap?: () => void
  onPrevious: () => void
  onNext: () => void
  onFilmstripSelect: (index: number) => void
  externalInteractionPaused?: boolean
  onToggleFavorite?: (item: MediaItem) => Promise<void>
  onInfo?: (item: MediaItem) => void
  onSaveEditRecipe?: (
    item: MediaItem,
    input: MediaEditRecipeInput,
  ) => Promise<MediaEditRecipe>
  onResetEditRecipe?: (
    item: MediaItem,
    revision: number,
  ) => Promise<MediaEditRecipe>
  onCreateCreativeGeneration?: (
    item: MediaItem,
    input: MediaCreativeInput,
  ) => Promise<MediaCreativeGeneration>
  onGetCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCancelCreativeGeneration?: (
    generationID: string,
  ) => Promise<MediaCreativeGeneration>
  onCreativeCompleted?: (generation: MediaCreativeGeneration) => void
  onDownload?: (item: MediaItem, clientRequestID?: string) => Promise<void | { saved: boolean }>
  viewerDownloadReceipt?: XDriveViewerDownloadReceiptPort
  onExportLivePhoto?: (item: MediaItem) => Promise<void>
  onShare?: (item: MediaItem) => void
  onDelete?: (item: MediaItem) => Promise<void>
  // Gallery Page's upstream Favorite/Download/Live Export/Delete adapters report
  // failures via the host Snackbar. Avoid a second competing notification.
  parentReportsViewerActionErrors?: boolean
  onClose: () => void
}) {
  const [fullScreen, setFullScreen] = useState(false)
  const narrowViewer = useMediaQuery('(max-width:899.95px)')
  const ultraNarrowViewer = useMediaQuery('(max-width:367.95px)')
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  // Dialog visibility belongs to the actual Node/revision action session.
  // Closing a filmstrip item must not leave a previous confirmation or editor
  // armed for a different photo before the passive effects have run.
  const [deleteDialogOwner, setDeleteDialogOwner] = useState<object | null>(null)
  const [creativeDialogOwner, setCreativeDialogOwner] = useState<object | null>(null)
  const [editDialogOwner, setEditDialogOwner] = useState<object | null>(null)
  const [locationDialogOwner, setLocationDialogOwner] = useState<object | null>(null)
  // The visible Viewer can change while a durable action is still running.
  // Pending work keeps running, but only its initiating media session may own
  // the action chrome or close that session on completion.
  const actionOwnerRef = useRef({
    nodeID: item?.node.id,
    nodeRevision: item?.node.revision,
    thumbnailLoader: loadThumbnail,
    borrowedThumbnailLoader: loadBorrowedThumbnail,
    previewLoader: loadPreviewURL,
    motionLoader: loadLivePhotoMotion,
    session: 0,
    inFlight: false,
  })
  if (
    actionOwnerRef.current.nodeID !== item?.node.id ||
    actionOwnerRef.current.nodeRevision !== item?.node.revision ||
    actionOwnerRef.current.thumbnailLoader !== loadThumbnail ||
    actionOwnerRef.current.borrowedThumbnailLoader !== loadBorrowedThumbnail ||
    actionOwnerRef.current.previewLoader !== loadPreviewURL ||
    actionOwnerRef.current.motionLoader !== loadLivePhotoMotion
  ) {
    // The same Node/revision may exist in two authorized sources. Treat a
    // changed preview loader as a new session before effects or pending JSX
    // handlers can read the prior account's image, Live motion, or dialog.
    const session = actionOwnerRef.current.session + 1
    actionOwnerRef.current = {
      nodeID: item?.node.id,
      nodeRevision: item?.node.revision,
      thumbnailLoader: loadThumbnail,
      borrowedThumbnailLoader: loadBorrowedThumbnail,
      previewLoader: loadPreviewURL,
      motionLoader: loadLivePhotoMotion,
      session,
      inFlight: false,
    }
  }
  const actionOwner = actionOwnerRef.current
  // Keep Agent progress isolated to this mounted Viewer, never re-render the
  // underlying virtualized 100k Gallery on each transfer update.
  const downloadReceipt = useXDriveViewerDownloadReceipt(
    viewerDownloadReceipt, actionOwner, item?.node.id,
  )
  // An unmounted Gallery Viewer receives no new render to invalidate queued
  // callbacks. Layout cleanup retires this exact media/source session.
  const mountedOwnerRef = useRef<typeof actionOwner | null>(actionOwner)
  mountedOwnerRef.current = actionOwner
  useLayoutEffect(() => {
    mountedOwnerRef.current = actionOwner
    return () => {
      if (mountedOwnerRef.current === actionOwner) mountedOwnerRef.current = null
    }
  }, [actionOwner])
  const navigationRef = useRef({ canPrevious, canNext, onPrevious, onNext, onFilmstripSelect })
  navigationRef.current = { canPrevious, canNext, onPrevious, onNext, onFilmstripSelect }
  const isCurrentActionOwner = () => Boolean(item) &&
    actionOwnerRef.current === actionOwner && mountedOwnerRef.current === actionOwner
  const previousIfCurrent = () => {
    if (isCurrentActionOwner() && navigationRef.current.canPrevious &&
        navigationRef.current.onPrevious === onPrevious) onPrevious()
  }
  const nextIfCurrent = () => {
    if (isCurrentActionOwner() && navigationRef.current.canNext &&
        navigationRef.current.onNext === onNext) onNext()
  }
  const filmstripIfCurrent = (index: number) => {
    if (isCurrentActionOwner() &&
        navigationRef.current.onFilmstripSelect === onFilmstripSelect) onFilmstripSelect(index)
  }
  const setFullScreenIfCurrent = (value: boolean) => {
    if (isCurrentActionOwner()) setFullScreen(value)
  }
  const toggleSlideshowIfCurrent = () => {
    if (isCurrentActionOwner()) setSlideshowPlaying((value) => !value)
  }
  const [slideshowPlaying, setSlideshowPlaying] = useState(false)
  const slideshowKind = item ? xDriveClassifyFilePreview({
    name: item.node.name, kind: 'file', mimeType: item.metadata.mime_type,
  }) : 'none'
  const slideshowEligible = Boolean(item && (slideshowKind === 'image' || slideshowKind === 'live_photo'))
  const slideshowPresentation = useXDrivePreviewPresentation(item ? {
    id: item.node.id, name: item.node.name, revision: item.node.revision, kind: 'file',
  } : null, actionOwner.session)
  // A new gallery account/loader cannot inherit the previous collection's playback.
  useEffect(() => { setSlideshowPlaying(false) }, [loadThumbnail, loadLivePhotoMotion, loadPreviewURL])
  useEffect(() => {
    if (!slideshowEligible) setSlideshowPlaying(false)
  }, [slideshowEligible])
  // The last queued pointer event from a replaced photo must not start a
  // synchronous Share or Inspector action against the old media identity.
  const runCurrentItemAction = (handler?: (value: MediaItem) => void) => {
    if (isCurrentActionOwner() && handler) handler(item!)
  }
  const [moreOwner, setMoreOwner] = useState<typeof actionOwner | null>(null)
  const moreOpen = Boolean(item && narrowViewer && moreAnchor && moreOwner === actionOwner)
  const openMore = (anchor: HTMLElement) => {
    if (!isCurrentActionOwner()) return
    setMoreOwner(actionOwner)
    setMoreAnchor(anchor)
  }
  const closeMore = () => {
    if (!isCurrentActionOwner()) return
    setMoreAnchor(null)
    setMoreOwner(null)
  }
  // Match routed Web Viewer: leaving compact layout permanently dismisses
  // this menu. 390→900→390 must never resurrect its previous menu anchor.
  useEffect(() => {
    if (!narrowViewer) {
      setMoreAnchor(null)
      setMoreOwner(null)
    }
  }, [narrowViewer])
  const deleteOpen = deleteDialogOwner === actionOwner
  const creativeOpen = creativeDialogOwner === actionOwner
  const editOpen = editDialogOwner === actionOwner
  const locationOpen = locationDialogOwner === actionOwner
  useXDrivePreviewSlideshow({
    enabled: slideshowEligible,
    playing: slideshowPlaying,
    sourceKey: slideshowPresentation.sourceKey,
    presentationState: slideshowPresentation.presentationState,
    canNext,
    interactionPaused: externalInteractionPaused || moreOpen || deleteOpen || creativeOpen || editOpen || locationOpen,
    onNext: nextIfCurrent,
    onStop: () => {
      if (isCurrentActionOwner()) setSlideshowPlaying(false)
    },
  })
  // Old JSX callbacks remain callable after a Filmstrip navigation. Reject
  // them even if A is selected again after A → B → A.
  const setDeleteOpen = (open: boolean) => {
    if (isCurrentActionOwner()) setDeleteDialogOwner(open ? actionOwner : null)
  }
  const setCreativeOpen = (open: boolean) => {
    if (isCurrentActionOwner()) setCreativeDialogOwner(open ? actionOwner : null)
  }
  const setEditOpen = (open: boolean) => {
    if (isCurrentActionOwner()) setEditDialogOwner(open ? actionOwner : null)
  }
  const setLocationOpen = (open: boolean) => {
    if (isCurrentActionOwner()) setLocationDialogOwner(open ? actionOwner : null)
  }
  const [busyState, setBusyState] = useState<{
    owner: typeof actionOwner
    action: ViewerAction
  } | null>(null)
  const busyAction: ViewerAction =
    busyState?.owner === actionOwner ? busyState.action : ''
  // Full-screen feedback is tied to the exact Node/revision/source session.
  // Reject late failures and late Snackbar dismissals across A → B → A.
  const [actionError, setActionError] = useState<{
    owner: typeof actionOwner
    action: ViewerAction
  } | null>(null)
  const visibleActionError = actionError?.owner === actionOwner ? actionError : null
  // Transport errors can contain signed URLs. Render only fixed safe messages.
  const actionErrorMessage = visibleActionError?.action === 'favorite'
    ? '收藏失败，请重试'
    : visibleActionError?.action === 'delete'
      ? '删除失败，请重试'
      : '下载或导出失败，请重试'

  const run = useCallback(async (
    action: ViewerAction,
    task: () => Promise<void>,
  ): Promise<boolean> => {
    // Claim ownership synchronously, before React can publish disabled state.
    // Old JSX callbacks and same-tick repeated actions are both rejected.
    if (!isCurrentActionOwner() || actionOwner.inFlight) {
      return false
    }
    actionOwner.inFlight = true
    setBusyState({ owner: actionOwner, action })
    setActionError(null)
    try {
      await task()
      return isCurrentActionOwner()
    } catch (error) {
      if (isCurrentActionOwner() && !parentReportsViewerActionErrors) {
        setActionError({ owner: actionOwner, action })
      }
      throw error
    } finally {
      actionOwner.inFlight = false
      if (isCurrentActionOwner()) setBusyState(null)
    }
  }, [actionOwner, item, parentReportsViewerActionErrors])

  // Claim the download action before creating an Agent correlation. The
  // existing `run` fence owns same-tick duplicate taps and A→B→A sessions.
  const downloadCurrent = () => {
    if (!item || !onDownload) return
    void run('download', async () => {
      const id = downloadReceipt.claim()
      try {
        const outcome = await onDownload(item, id)
        // Native SaveDialog cancellation creates no task: don't leave a
        // phantom pending receipt behind the current still/video.
        if (outcome && outcome.saved === false) downloadReceipt.dismiss(id)
      } catch (error) {
        downloadReceipt.dismiss(id)
        throw error
      }
    }).catch(() => undefined)
  }

  const close = () => {
    if (!isCurrentActionOwner()) return
    // A close/reopen of the same Node still starts a fresh action session.
    actionOwnerRef.current = {
      ...actionOwnerRef.current,
      nodeID: undefined,
      nodeRevision: undefined,
      session: actionOwnerRef.current.session + 1,
      inFlight: false,
    }
    setBusyState(null)
    setActionError(null)
    setDeleteDialogOwner(null)
    setCreativeDialogOwner(null)
    setEditDialogOwner(null)
    setLocationDialogOwner(null)
    setMoreAnchor(null)
    setMoreOwner(null)
    setFullScreen(false)
    setSlideshowPlaying(false)
    onClose()
  }

  const latitude = item?.metadata.latitude
  const longitude = item?.metadata.longitude
  const hasPhotoGPS = typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  const actions = item ? (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {onToggleFavorite ? (
        <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
          <span>
            <IconButton
              size="small"
              aria-label={item.favorite ? '取消收藏' : '收藏'}
              disabled={Boolean(busyAction)}
              onClick={() => {
                void run('favorite', () => onToggleFavorite(item)).catch(() => undefined)
              }}
            >
              {item.favorite
                ? <StarRoundedIcon fontSize="small" />
                : <StarBorderRoundedIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {!narrowViewer && onCreateCreativeGeneration &&
      onGetCreativeGeneration &&
      loadPreviewURL &&
      xDriveMediaItemSupportsCreative(item) ? (
        <Tooltip title="创作">
          <IconButton
            size="small"
            aria-label="创作图片"
            onClick={() => setCreativeOpen(true)}
          >
            <AutoFixHighRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowViewer && onSaveEditRecipe && xDriveMediaItemSupportsBasicEditing(item) ? (
        <Tooltip title="编辑">
          <IconButton
            size="small"
            aria-label="编辑媒体"
            onClick={() => setEditOpen(true)}
          >
            <EditRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowViewer && hasPhotoGPS ? (
        <Tooltip title="在地图上查看照片">
          <IconButton size="small" aria-label="在地图上查看照片" onClick={() => setLocationOpen(true)}>
            <MapOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onInfo ? (
        <Tooltip title="属性">
          <IconButton size="small" aria-label="查看属性" onClick={() => runCurrentItemAction(onInfo)}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowViewer && slideshowEligible && (canNext || slideshowPlaying) ? (
        <Tooltip title={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}>
          <IconButton size="small"
            aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
            onClick={toggleSlideshowIfCurrent}>
            {slideshowPlaying ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {!narrowViewer && onDownload ? (
        <Tooltip title="下载">
          <span>
            <IconButton
              size="small"
              aria-label="下载媒体"
              disabled={Boolean(busyAction)}
              onClick={() => {
                downloadCurrent()
              }}
            >
              <DownloadRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {!narrowViewer && onExportLivePhoto && (item.live_photo || item.asset_kind === 'live_photo') ? (
        <Tooltip title="导出完整实况（照片与动态原件）">
          <span>
            <IconButton
              size="small"
              aria-label="导出完整实况"
              disabled={Boolean(busyAction)}
              onClick={() => {
                void run('download', () => onExportLivePhoto(item)).catch(() => undefined)
              }}
            >
              <ArchiveRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {onShare ? (
        <Tooltip title="分享">
          <IconButton size="small" aria-label="分享媒体" onClick={() => runCurrentItemAction(onShare)}>
            <ShareRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onDelete ? (
        <Tooltip title="删除">
          <span>
            <IconButton
              size="small"
              color="error"
              aria-label="删除媒体"
              disabled={Boolean(busyAction)}
              onClick={() => setDeleteOpen(true)}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {narrowViewer ? (
        <Tooltip title="更多">
          <IconButton
            size="small"
            aria-label="更多照片操作"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? 'xdrive-shared-gallery-viewer-more' : undefined}
            onClick={(event) => openMore(event.currentTarget)}
          >
            <MoreHorizRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  ) : null

  // Match the routed Web Viewer: no blank lower overlay for a singleton.
  const footer = item && filmstripEntries.length > 0 ? (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <XDriveMediaGalleryFilmstrip
        entries={filmstripEntries}
        activeIndex={activeIndex}
        loadThumbnail={loadThumbnail}
        onSelect={filmstripIfCurrent}
      />
    </Box>
  ) : null

  return (
    <>
      <XDriveOpenPreviewDialog
        open={Boolean(item)}
        title={item?.node.name ?? ''}
        subtitle={item ? xDriveMediaCaptureTimeLabel(item.metadata.captured_at) : undefined}
        positionLabel={positionLabel}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={previousIfCurrent}
        onNext={nextIfCurrent}
        actions={actions}
        footer={footer}
        keepChromeVisible={externalInteractionPaused || moreOpen || deleteOpen || creativeOpen || editOpen || locationOpen}
        chromeSessionKey={actionOwner.session}
        immersive
        mobileEdgeToEdge
        fullScreen={fullScreen}
        onFullScreenChange={setFullScreenIfCurrent}
        onClose={close}
      >
        {downloadReceipt.text ? (
          <Box
            data-xdrive-viewer-agent-download-progress
            role="status"
            aria-live={downloadReceipt.announce ? 'polite' : 'off'}
            sx={{
              position: 'absolute', top: 12, left: 12, zIndex: 5,
              maxWidth: 'calc(100% - 24px)', px: 1.5, py: 0.75,
              bgcolor: 'rgba(0,0,0,.68)', color: 'common.white',
              borderRadius: 1.5, pointerEvents: 'none',
              '& .MuiTypography-root': { color: 'inherit', overflowWrap: 'anywhere' },
            }}
          >
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {downloadReceipt.text}
            </Typography>
          </Box>
        ) : null}
        {item ? (
          <XDriveMediaViewerContent
            key={actionOwner.session}
            item={item}
            loadThumbnail={loadThumbnail}
            loadBorrowedThumbnail={loadBorrowedThumbnail}
            loadLivePhotoMotion={loadLivePhotoMotion}
            loadPreviewURL={loadPreviewURL}
            onPresentationStateChange={slideshowPresentation.onPresentationStateChange}
            videoControlsSafeArea={narrowViewer ? (filmstripEntries.length > 0 ? 'actions-filmstrip' : 'actions') : undefined}
            interactiveImage
            onSwipePrevious={canPrevious ? previousIfCurrent : undefined}
            onSwipeNext={canNext ? nextIfCurrent : undefined}
            minHeight={0}
            maxHeight="none"
          />
        ) : null}
      </XDriveOpenPreviewDialog>

      <Menu
        id="xdrive-shared-gallery-viewer-more"
        anchorEl={moreOpen ? moreAnchor : null}
        open={moreOpen}
        onClose={closeMore}
        MenuListProps={{ 'aria-label': '更多照片操作' }}
      >
        {ultraNarrowViewer && canPrevious ? (
          <MenuItem aria-label="上一张" onClick={() => {
            if (!isCurrentActionOwner()) return
            closeMore()
            previousIfCurrent()
          }}>上一张</MenuItem>
        ) : null}
        {ultraNarrowViewer && canNext ? (
          <MenuItem aria-label="下一张" onClick={() => {
            if (!isCurrentActionOwner()) return
            closeMore()
            nextIfCurrent()
          }}>下一张</MenuItem>
        ) : null}
        {slideshowEligible && (canNext || slideshowPlaying) ? (
          <MenuItem aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'} onClick={() => {
            closeMore()
            toggleSlideshowIfCurrent()
          }}>{slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}</MenuItem>
        ) : null}
        {item && onCreateCreativeGeneration && onGetCreativeGeneration && loadPreviewURL &&
        xDriveMediaItemSupportsCreative(item) ? (
          <MenuItem aria-label="创作图片" onClick={() => { closeMore(); setCreativeOpen(true) }}>创作图片</MenuItem>
        ) : null}
        {item && onSaveEditRecipe && xDriveMediaItemSupportsBasicEditing(item) ? (
          <MenuItem aria-label="编辑媒体" onClick={() => { closeMore(); setEditOpen(true) }}>编辑媒体</MenuItem>
        ) : null}
        {item && hasPhotoGPS ? (
          <MenuItem aria-label="在地图上查看照片" onClick={() => { closeMore(); setLocationOpen(true) }}>在地图上查看照片</MenuItem>
        ) : null}
        {item && onExportLivePhoto && (item.live_photo || item.asset_kind === 'live_photo') ? (
          <MenuItem aria-label="导出完整实况" disabled={Boolean(busyAction)} onClick={() => {
            closeMore()
            void run('download', () => onExportLivePhoto(item)).catch(() => undefined)
          }}>导出完整实况</MenuItem>
        ) : null}
        {item && onDownload ? (
          <MenuItem aria-label="下载" disabled={Boolean(busyAction)} onClick={() => {
            closeMore()
            downloadCurrent()
          }}>下载</MenuItem>
        ) : null}
      </Menu>

      <XDriveMediaGalleryViewerLocationDialog
        open={locationOpen}
        item={item}
        onOpenDynamicMap={onOpenDynamicMap ? () => {
          if (isCurrentActionOwner()) onOpenDynamicMap()
        } : undefined}
        getBaiduMapConsent={getBaiduMapConsent}
        saveBaiduMapConsent={saveBaiduMapConsent}
        revokeBaiduMapConsent={revokeBaiduMapConsent}
        getBaiduMapIndexJob={getBaiduMapIndexJob}
        enqueueBaiduMapIndexJob={enqueueBaiduMapIndexJob}
        cancelBaiduMapIndexJob={cancelBaiduMapIndexJob}
        onClose={() => {
          if (isCurrentActionOwner()) setLocationOpen(false)
        }}
      />

      <XDriveMediaGalleryCreativeDialog
        open={creativeOpen}
        item={item}
        loadPreviewURL={loadPreviewURL}
        onCreate={onCreateCreativeGeneration}
        onGet={onGetCreativeGeneration}
        onCancel={onCancelCreativeGeneration}
        onCompleted={onCreativeCompleted}
        onClose={() => setCreativeOpen(false)}
      />

      <XDriveMediaGalleryEditDialog
        open={editOpen}
        item={item}
        loadThumbnail={loadThumbnail}
        loadPreviewURL={loadPreviewURL}
        onSave={async (value, input) => {
          if (!onSaveEditRecipe) throw new Error('当前客户端不支持媒体编辑')
          return onSaveEditRecipe(value, input)
        }}
        onReset={onResetEditRecipe}
        onClose={() => setEditOpen(false)}
      />

      <XDriveConfirmDialog
        open={deleteOpen}
        title="删除这张照片或视频？"
        description="项目会移到回收站；删除任务可在任务中心查看和取消。"
        confirmLabel="删除"
        confirmIntent="danger"
        loading={busyAction === 'delete'}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!item || !onDelete) return
          void run('delete', () => onDelete(item))
            .then((completedInCurrentSession) => {
              if (!completedInCurrentSession) return
              setDeleteOpen(false)
              close()
            })
            .catch(() => undefined)
        }}
      />
      <XDriveFeedbackSnackbar
        open={Boolean(visibleActionError)}
        tone="bad"
        message={actionErrorMessage}
        dismissible
        onClose={() => setActionError((current) =>
          current?.owner === actionOwner ? null : current)}
        alertSx={{
          // Float above the filmstrip and mobile action rail, not over buttons.
          mb: narrowViewer ? 'calc(124px + env(safe-area-inset-bottom))' : '84px',
          maxWidth: 'min(420px, calc(100vw - 24px))',
        }}
      />
    </>
  )
}
