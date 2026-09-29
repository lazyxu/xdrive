import { createTheme } from '@mui/material/styles'
import type { PaletteMode } from '@mui/material'

export function createXDriveMuiTheme(mode: PaletteMode = 'light') {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#5f8ff4' : '#4177e6' },
      background: {
        default: dark ? '#0f141d' : '#f5f7fb',
        paper: dark ? '#171d27' : '#ffffff',
      },
    },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' },
        },
      },
    },
  })
}
