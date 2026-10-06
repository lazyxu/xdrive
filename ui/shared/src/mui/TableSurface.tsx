import type { ReactNode, Ref, UIEventHandler } from 'react'
import { TableContainer } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export function XDriveTableSurface({
  children,
  sx,
  containerRef,
  onScroll,
}: {
  children: ReactNode
  sx?: SxProps<Theme>
  containerRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  return (
    <TableContainer
      ref={containerRef}
      onScroll={onScroll}
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
