import type { ReactNode } from 'react'
import { DialogContent } from '@mui/material'

export function XDriveDialogContent({
  children,
  dividers = false,
  flush = false,
}: {
  children: ReactNode
  dividers?: boolean
  flush?: boolean
}) {
  return (
    <DialogContent
      dividers={dividers}
      sx={{
        px: flush ? 0 : { xs: 2, sm: 2.5 },
        py: flush ? 0 : { xs: 2, sm: 2.25 },
        overflowY: 'auto',
      }}
    >
      {children}
    </DialogContent>
  )
}
