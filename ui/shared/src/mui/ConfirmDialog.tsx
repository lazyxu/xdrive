import type { ReactNode } from 'react'
import { Dialog, DialogContentText } from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import type { XDriveActionIntent } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

export function XDriveConfirmDialog({
  open,
  title = '确认操作',
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmIntent = 'primary',
  loading = false,
  loadingLabel = '正在处理…',
  maxWidth = 'sm',
  onCancel,
  onConfirm,
}: {
  open: boolean
  title?: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  confirmIntent?: XDriveActionIntent
  loading?: boolean
  loadingLabel?: ReactNode
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false
  onCancel: () => void
  onConfirm: () => void
}) {
  const close = () => {
    if (!loading) onCancel()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      aria-label="确认操作"
      maxWidth={maxWidth}
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title={title} onClose={close} closeDisabled={loading} />
      <XDriveDialogContent>
        <DialogContentText component="div">{description}</DialogContentText>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton disabled={loading} onClick={close}>{cancelLabel}</XDriveActionButton>
        <XDriveActionButton
          intent={confirmIntent}
          loading={loading}
          loadingLabel={loadingLabel}
          onClick={onConfirm}
        >
          {confirmLabel}
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
