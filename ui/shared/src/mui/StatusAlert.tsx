import type { ReactNode } from 'react'
import { Alert, AlertTitle } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { XDriveStatusTone } from './StatusBadge'

function severityForTone(tone: XDriveStatusTone) {
  if (tone === 'good') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'bad') return 'error'
  return 'info'
}

export function XDriveStatusAlert({
  tone,
  title,
  children,
  action,
  sx,
}: {
  tone: XDriveStatusTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <Alert severity={severityForTone(tone)} action={action} sx={sx}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children}
    </Alert>
  )
}
