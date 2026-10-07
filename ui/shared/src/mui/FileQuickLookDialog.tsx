import type { ReactNode } from 'react'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import { Stack, Typography } from '@mui/material'
import type { XDriveFilePreviewTarget } from '../file-preview'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewMotionLoader,
  XDriveFilePreviewTextLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { XDriveOpenPreviewDialog } from './FileOpenPreviewDialog'

export type XDriveFileQuickLookDialogProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  open: boolean
  item: T | null
  positionLabel?: ReactNode
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  loadLivePhotoMotion?: XDriveFilePreviewMotionLoader<T>
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}

export function XDriveFileQuickLookDialog<T extends XDriveFilePreviewTarget>({
  open,
  item,
  positionLabel,
  loadTextPreview,
  loadImagePreview,
  loadPreviewURL,
  loadLivePhotoMotion,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  onClose,
}: XDriveFileQuickLookDialogProps<T>) {
  return (
    <XDriveOpenPreviewDialog
      open={open && Boolean(item)}
      title={item?.name ?? ''}
      positionLabel={positionLabel}
      quickLook
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
        fallback={(
          <Stack spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 4 }}>
            <InsertDriveFileRoundedIcon sx={{ fontSize: 64 }} />
            <Typography variant="body2">此文件暂无可用预览</Typography>
          </Stack>
        )}
        minHeight={320}
        maxHeight={760}
      />
    </XDriveOpenPreviewDialog>
  )
}
