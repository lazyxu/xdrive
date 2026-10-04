import { useEffect, useMemo, type ReactNode } from 'react'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import type { PaletteMode } from '@mui/material'
import type { XDriveAppearance } from '../preferences'
import { createXDriveMuiTheme } from './theme'

export function xDriveResolveAppearanceMode(
  appearance: XDriveAppearance,
  prefersDark: boolean,
): PaletteMode {
  return appearance === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : appearance
}

export function XDriveAppearanceThemeProvider({
  appearance,
  children,
}: {
  appearance: XDriveAppearance
  children: ReactNode
}) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const resolvedMode = xDriveResolveAppearanceMode(appearance, prefersDark)
  const theme = useMemo(() => createXDriveMuiTheme(resolvedMode), [resolvedMode])

  useEffect(() => {
    document.documentElement.dataset.xdriveTheme = resolvedMode
  }, [resolvedMode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
