import type { ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { DialogTitle, IconButton } from '@mui/material'

export const desktopDialogPaperProps = {
  className: 'desktop-dialog-paper',
} as const

export default function DesktopDialogTitle({
  title,
  subtitle,
  onClose,
  closeDisabled = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  closeDisabled?: boolean
}) {
  return (
    <DialogTitle className="desktop-dialog-title">
      <div className="desktop-dialog-title-copy">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <IconButton
        className="desktop-dialog-close"
        aria-label="关闭弹窗"
        title="关闭"
        size="small"
        disabled={closeDisabled}
        onClick={onClose}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </DialogTitle>
  )
}
