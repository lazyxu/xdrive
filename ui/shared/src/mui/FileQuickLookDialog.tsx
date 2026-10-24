import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
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
    id: item?.id, revision: item?.revision,
    text: loadTextPreview, image: loadImagePreview,
    url: loadPreviewURL, motion: loadLivePhotoMotion, session: 0,
  })
  if (
    chromeOwnerRef.current.id !== item?.id ||
    chromeOwnerRef.current.revision !== item?.revision ||
    chromeOwnerRef.current.text !== loadTextPreview ||
    chromeOwnerRef.current.image !== loadImagePreview ||
    chromeOwnerRef.current.url !== loadPreviewURL ||
    chromeOwnerRef.current.motion !== loadLivePhotoMotion
  ) {
    chromeOwnerRef.current = {
      id: item?.id, revision: item?.revision,
      text: loadTextPreview, image: loadImagePreview,
      url: loadPreviewURL, motion: loadLivePhotoMotion,
      session: chromeOwnerRef.current.session + 1,
    }
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
    onNext,
    onStop: () => setSlideshowPlaying(false),
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
              onClick={action.onSelect}
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
            onClick={() => setSlideshowPlaying((value) => !value)}
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
      chromeSessionKey={chromeOwnerRef.current.session}
      actions={headerActions}
      immersive={fullScreen}
      fullScreen={fullScreen}
      onFullScreenChange={(next) => {
        setFullScreen(next)
        if (!next) setSlideshowPlaying(false)
      }}
      canPrevious={canPrevious}
      canNext={canNext}
      onPrevious={onPrevious}
      onNext={onNext}
      onClose={onClose}
    >
      <XDriveFilePreviewSurface
        target={item}
        loadTextPreview={loadTextPreview}
        loadImagePreview={loadImagePreview}
        loadPreviewURL={loadPreviewURL}
        loadLivePhotoMotion={loadLivePhotoMotion}
        onPresentationStateChange={presentation.onPresentationStateChange}
        interactiveImage
        onSwipePrevious={canPrevious ? onPrevious : undefined}
        onSwipeNext={canNext ? onNext : undefined}
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
