import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
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
  const presentation = useXDrivePreviewPresentation(item)

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
    enabled: open && fullScreen,
    playing: slideshowPlaying,
    sourceKey: presentation.sourceKey,
    presentationState: presentation.presentationState,
    canNext,
    onNext,
    onStop: () => setSlideshowPlaying(false),
    intervalMs: slideshowIntervalMs,
  })

  const hasSlideshow = canPrevious || canNext
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
