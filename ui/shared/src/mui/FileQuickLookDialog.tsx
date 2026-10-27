import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { xDriveClassifyFilePreview } from '../file-preview'
import type { XDriveFilePreviewTarget } from '../file-preview'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewMotionLoader,
  XDriveFilePreviewTextLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { XDriveOpenPreviewDialog } from './FileOpenPreviewDialog'
import { useXDriveViewerDownloadReceipt } from './useViewerDownloadReceipt'
import type { XDriveViewerDownloadReceiptPort } from './useViewerDownloadReceipt'
import { useXDrivePreviewPresentation, useXDrivePreviewSlideshow } from './usePreviewSlideshow'

export type XDriveFileQuickLookAction = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

export type XDriveFileQuickLookDialogProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  open: boolean
  item: T | null
  positionLabel?: ReactNode
  actions?: readonly XDriveFileQuickLookAction[]
  /** Desktop-only optional exact Agent Task Center receipt; other hosts keep default actions. */
  viewerDownloadReceipt?: XDriveViewerDownloadReceiptPort
  onDownloadWithReceipt?: (item: T, clientRequestID: string) => Promise<void | { saved: boolean }>
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  loadLivePhotoMotion?: XDriveFilePreviewMotionLoader<T>
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  slideshowIntervalMs?: number
}

export function XDriveFileQuickLookDialog<T extends XDriveFilePreviewTarget>({
  open,
  item,
  positionLabel,
  actions = [],
  viewerDownloadReceipt,
  onDownloadWithReceipt,
  loadTextPreview,
  loadImagePreview,
  loadPreviewURL,
  loadLivePhotoMotion,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  onClose,
  slideshowIntervalMs = 5000,
}: XDriveFileQuickLookDialogProps<T>) {
  const [fullScreen, setFullScreen] = useState(false)
  const [slideshowPlaying, setSlideshowPlaying] = useState(false)
  // A same-ID file opened from another Agent/account must reset pending
  // chrome taps as well as the Preview Engine's existing byte leases.
  const chromeOwnerRef = useRef({
    open, id: item?.id, revision: item?.revision,
    text: loadTextPreview, image: loadImagePreview,
    url: loadPreviewURL, motion: loadLivePhotoMotion, session: 0,
  })
  if (
    chromeOwnerRef.current.open !== open ||
    chromeOwnerRef.current.id !== item?.id ||
    chromeOwnerRef.current.revision !== item?.revision ||
    chromeOwnerRef.current.text !== loadTextPreview ||
    chromeOwnerRef.current.image !== loadImagePreview ||
    chromeOwnerRef.current.url !== loadPreviewURL ||
    chromeOwnerRef.current.motion !== loadLivePhotoMotion
  ) {
    chromeOwnerRef.current = {
      open, id: item?.id, revision: item?.revision,
      text: loadTextPreview, image: loadImagePreview,
      url: loadPreviewURL, motion: loadLivePhotoMotion,
      session: chromeOwnerRef.current.session + 1,
    }
  }

  // Action callbacks can remain queued after closing, reopening, or replacing an
  // Owner/Agent loader for the same Node ID. Fence dispatch synchronously; the
  // Preview Engine's byte cancellation alone does not protect UI actions.
  const chromeOwner = chromeOwnerRef.current
  const downloadReceipt = useXDriveViewerDownloadReceipt(
    open ? viewerDownloadReceipt : undefined,
    chromeOwner,
    open && item ? Number(item.id) : undefined,
  )
  const downloadInFlightRef = useRef({ owner: chromeOwner, busy: false })
  if (downloadInFlightRef.current.owner !== chromeOwner) {
    downloadInFlightRef.current = { owner: chromeOwner, busy: false }
  }
  // A keyed FileExplorer remount can retire the entire Quick Look instance.
  // Unlike a prop change, it never gets another render to rotate chromeOwnerRef.
  // Layout cleanup revokes queued clicks before the discarded frame can act.
  const mountedOwnerRef = useRef<typeof chromeOwner | null>(chromeOwner)
  useLayoutEffect(() => {
    mountedOwnerRef.current = chromeOwner
    return () => {
      if (mountedOwnerRef.current === chromeOwner) mountedOwnerRef.current = null
    }
  }, [chromeOwner])
  // Navigation and menu capabilities can change without changing the file.
  // A queued event must not bypass the *current* disabled/neighbor state or
  // execute a replaced callback from an obsolete browsing context.
  const currentActionsRef = useRef(actions)
  currentActionsRef.current = actions
  const currentNavigationRef = useRef({ canPrevious, canNext, onPrevious, onNext, onClose })
  currentNavigationRef.current = { canPrevious, canNext, onPrevious, onNext, onClose }
  const isCurrentChromeOwner = () => open && Boolean(item) &&
    chromeOwnerRef.current === chromeOwner && mountedOwnerRef.current === chromeOwner
  const previousIfCurrent = () => {
    if (isCurrentChromeOwner() && currentNavigationRef.current.canPrevious &&
        currentNavigationRef.current.onPrevious === onPrevious) onPrevious?.()
  }
  const nextIfCurrent = () => {
    if (isCurrentChromeOwner() && currentNavigationRef.current.canNext &&
        currentNavigationRef.current.onNext === onNext) onNext?.()
  }
  const closeIfCurrent = () => {
    if (isCurrentChromeOwner() && currentNavigationRef.current.onClose === onClose) onClose()
  }

  const downloadWithReceiptIfCurrent = (fallback: () => void) => {
    if (!isCurrentChromeOwner() || !item) return
    if (!viewerDownloadReceipt || !onDownloadWithReceipt) {
      fallback()
      return
    }
    const flight = downloadInFlightRef.current
    if (flight.owner !== chromeOwner || flight.busy) return
    flight.busy = true
    let nonce: string | undefined
    try {
      nonce = downloadReceipt.claim()
    } catch {
      // WebCrypto is unavailable: never invent a weak correlation, but keep
      // the original working native SaveDialog download path.
      flight.busy = false
      fallback()
      return
    }
    if (!nonce) {
      flight.busy = false
      fallback()
      return
    }
    const requestID = nonce
    void Promise.resolve().then(() => {
      // A modal can close or switch source before this microtask runs; never
      // launch an old Owner's saved-file operation from its stale button.
      if (!isCurrentChromeOwner()) {
        downloadReceipt.dismiss(requestID)
        return { saved: false }
      }
      return onDownloadWithReceipt(item, requestID)
    })
      .then((outcome) => {
        if (outcome && outcome.saved === false) downloadReceipt.dismiss(requestID)
      }, () => {
        // Original Desktop file action reports failures through its host;
        // never display an untrusted local path in Viewer feedback.
        downloadReceipt.dismiss(requestID)
      }).finally(() => {
        flight.busy = false
      })
  }

  const previewKind = item ? xDriveClassifyFilePreview(item) : 'none'
  const slideshowEligible = previewKind === 'image' || previewKind === 'live_photo'
  // Source readiness is session-scoped: identical Node/revision across Agent
  // rebinding must not inherit an earlier Owner's decoded still.
  const presentation = useXDrivePreviewPresentation(item, chromeOwnerRef.current.session)

  useEffect(() => {
    if (!slideshowEligible) setSlideshowPlaying(false)
  }, [slideshowEligible])
  // Do not carry a prior Owner's playback intent into a rebound adapter.
  useEffect(() => { setSlideshowPlaying(false) }, [
    loadTextPreview, loadImagePreview, loadPreviewURL, loadLivePhotoMotion,
  ])

  useEffect(() => {
    if (open) return
    setFullScreen(false)
    setSlideshowPlaying(false)
  }, [open])

  useEffect(() => {
    if (fullScreen) return
    setSlideshowPlaying(false)
  }, [fullScreen])

  useXDrivePreviewSlideshow({
    enabled: open && fullScreen && slideshowEligible,
    playing: slideshowPlaying,
    sourceKey: presentation.sourceKey,
    presentationState: presentation.presentationState,
    canNext,
    onNext: onNext ? nextIfCurrent : undefined,
    onStop: () => {
      if (isCurrentChromeOwner()) setSlideshowPlaying(false)
    },
    intervalMs: slideshowIntervalMs,
  })

  const hasSlideshow = slideshowEligible && (canPrevious || canNext)
  const headerActions = (
    <>
      {actions.map((action) => (
        <Tooltip key={action.id} title={action.label}>
          <span>
            <IconButton
              size="small"
              aria-label={action.label}
              disabled={action.disabled}
              onClick={() => {
                if (!isCurrentChromeOwner()) return
                const current = currentActionsRef.current.find((candidate) => candidate.id === action.id)
                if (current && !current.disabled && current.onSelect === action.onSelect) {
                  if (action.id === 'download') {
                    downloadWithReceiptIfCurrent(current.onSelect)
                  } else {
                    current.onSelect()
                  }
                }
              }}
            >
              {action.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
      {fullScreen && hasSlideshow ? (
        <Tooltip title={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}>
          <IconButton
            size="small"
            aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}
            onClick={() => {
              if (isCurrentChromeOwner()) setSlideshowPlaying((value) => !value)
            }}
          >
            {slideshowPlaying
              ? <PauseRoundedIcon fontSize="small" />
              : <PlayArrowRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
    </>
  )

  return (
    <XDriveOpenPreviewDialog
      open={open && Boolean(item)}
      title={item?.name ?? ''}
      positionLabel={positionLabel}
      quickLook
      chromeSessionKey={chromeOwner.session}
      actions={headerActions}
      immersive={fullScreen}
      fullScreen={fullScreen}
      onFullScreenChange={(next) => {
        if (!isCurrentChromeOwner()) return
        setFullScreen(next)
        if (!next) setSlideshowPlaying(false)
      }}
      canPrevious={canPrevious}
      canNext={canNext}
      onPrevious={onPrevious ? previousIfCurrent : undefined}
      onNext={onNext ? nextIfCurrent : undefined}
      onClose={closeIfCurrent}
    >
      {downloadReceipt.text ? (
        <Box data-xdrive-quicklook-download-progress role="status"
          aria-live={downloadReceipt.announce ? 'polite' : 'off'}
          sx={{
            position: 'absolute', top: 12, left: 12, zIndex: 5,
            maxWidth: 'calc(100% - 24px)', px: 1.5, py: 0.75,
            bgcolor: 'rgba(0,0,0,.68)', color: 'common.white',
            borderRadius: 1.5, pointerEvents: 'none',
            '& .MuiTypography-root': { color: 'inherit', overflowWrap: 'anywhere' },
          }}>
          <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {downloadReceipt.text}
          </Typography>
        </Box>
      ) : null}
      <XDriveFilePreviewSurface
        key={chromeOwner.session}
        target={item}
        loadTextPreview={loadTextPreview}
        loadImagePreview={loadImagePreview}
        loadPreviewURL={loadPreviewURL}
        loadLivePhotoMotion={loadLivePhotoMotion}
        onPresentationStateChange={presentation.onPresentationStateChange}
        interactiveImage
        onSwipePrevious={canPrevious ? previousIfCurrent : undefined}
        onSwipeNext={canNext ? nextIfCurrent : undefined}
        fallback={(
          <Stack spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 4 }}>
            <InsertDriveFileRoundedIcon sx={{ fontSize: 64 }} />
            <Typography variant="body2">此文件暂无可用预览</Typography>
          </Stack>
        )}
        minHeight={fullScreen ? 0 : 320}
        maxHeight={fullScreen ? 'none' : 760}
      />
    </XDriveOpenPreviewDialog>
  )
}
