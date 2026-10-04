import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export type XDriveWorkspaceContentPresentation = 'page' | 'files'

export function XDriveWorkspaceContent({
  children,
  presentation = 'page',
  responsive = false,
  className,
  sx,
}: {
  children: ReactNode
  presentation?: XDriveWorkspaceContentPresentation
  responsive?: boolean
  className?: string
  sx?: SxProps<Theme>
}) {
  const files = presentation === 'files'

  return (
    <Box
      component="main"
      className={className}
      sx={[
        {
          width: '100%',
          minWidth: 0,
          minHeight: 0,
          height: responsive ? { xs: 'auto', md: '100%' } : '100%',
          ...(files
            ? {
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
                ...(responsive
                  ? {
                      p: 2,
                      overflow: 'visible',
                      '@media (min-width: 721px) and (max-width: 899.95px)': {
                        p: 4,
                      },
                      '@media (min-width: 900px)': {
                        p: 0,
                        overflow: 'hidden',
                      },
                    }
                  : {
                      p: 0,
                      overflow: 'hidden',
                    }),
              }
            : responsive
              ? {
                  px: 'clamp(16px, 4vw, 56px)',
                  py: 4,
                  overflowY: 'auto',
                  '@media (max-width: 720px)': {
                    p: 2,
                  },
                }
              : {
                  p: '34px 40px 48px',
                  overflow: 'auto',
                  '@media (max-width: 960px)': {
                    p: '28px',
                  },
                }),
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  )
}
