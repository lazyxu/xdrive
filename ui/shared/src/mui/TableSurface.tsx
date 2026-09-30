import type { ReactNode } from 'react'
import { TableContainer } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export function XDriveTableSurface({
  children,
  sx,
}: {
  children: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <TableContainer
      sx={[
        {
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          overflowX: 'auto',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </TableContainer>
  )
}
