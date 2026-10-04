import { createTheme } from '@mui/material/styles'
import type { PaletteMode } from '@mui/material'

function xDriveCssTokens(dark: boolean) {
  return dark
    ? {
        pageBg: '#0f141d',
        surface: '#171d27',
        surfaceSoft: '#1a222e',
        surfaceMuted: '#202936',
        surfaceSubtle: '#1d2530',
        border: '#2b3645',
        borderSoft: '#273240',
        borderStrong: '#3a4657',
        text: '#e7edf7',
        textStrong: '#e1e8f3',
        textMid: '#c5cfdd',
        textMuted: '#93a1b4',
        textFaint: '#758499',
        link: '#8fb1ff',
        primary: '#5f8ff4',
        primaryBorder: '#6c97f3',
        focus: '#7da2f4',
        dangerBg: '#321d23',
        dangerBorder: '#5b2e39',
        dangerText: '#ff9dad',
        successBg: '#153027',
        successBorder: '#285846',
        successText: '#7ed8b2',
        warningBg: '#352817',
        warningBorder: '#66502a',
        warningText: '#f2c57a',
        infoBg: '#18283e',
        infoText: '#9bbcf3',
        shadow: 'rgba(0,0,0,.35)',
      }
    : {
        pageBg: '#f4f6fa',
        surface: '#ffffff',
        surfaceSoft: '#f8fafc',
        surfaceMuted: '#eef2f7',
        surfaceSubtle: '#f4f6f9',
        border: '#d5dce6',
        borderSoft: '#e3e8ef',
        borderStrong: '#c4ceda',
        text: '#172033',
        textStrong: '#111827',
        textMid: '#344054',
        textMuted: '#667085',
        textFaint: '#98a2b3',
        link: '#2457d6',
        primary: '#376fd0',
        primaryBorder: '#4f7ed5',
        focus: '#5684df',
        dangerBg: '#fff1f3',
        dangerBorder: '#ffc7d0',
        dangerText: '#b4233b',
        successBg: '#ecfdf3',
        successBorder: '#abefc6',
        successText: '#067647',
        warningBg: '#fffaeb',
        warningBorder: '#fedf89',
        warningText: '#b54708',
        infoBg: '#eff6ff',
        infoText: '#2457a7',
        shadow: 'rgba(21,37,63,.10)',
      }
}

export function createXDriveMuiTheme(mode: PaletteMode = 'light') {
  const dark = mode === 'dark'
  const tokens = xDriveCssTokens(dark)

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
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            '--page-bg': tokens.pageBg,
            '--surface': tokens.surface,
            '--surface-soft': tokens.surfaceSoft,
            '--surface-muted': tokens.surfaceMuted,
            '--surface-subtle': tokens.surfaceSubtle,
            '--border': tokens.border,
            '--border-soft': tokens.borderSoft,
            '--border-strong': tokens.borderStrong,
            '--text': tokens.text,
            '--text-strong': tokens.textStrong,
            '--text-mid': tokens.textMid,
            '--text-muted': tokens.textMuted,
            '--text-faint': tokens.textFaint,
            '--link': tokens.link,
            '--primary': tokens.primary,
            '--primary-border': tokens.primaryBorder,
            '--focus': tokens.focus,
            '--danger-bg': tokens.dangerBg,
            '--danger-border': tokens.dangerBorder,
            '--danger-text': tokens.dangerText,
            '--success-bg': tokens.successBg,
            '--success-border': tokens.successBorder,
            '--success-text': tokens.successText,
            '--warning-bg': tokens.warningBg,
            '--warning-border': tokens.warningBorder,
            '--warning-text': tokens.warningText,
            '--info-bg': tokens.infoBg,
            '--info-text': tokens.infoText,
            '--shadow': tokens.shadow,
            colorScheme: mode,
            fontSynthesis: 'none',
            textRendering: 'optimizeLegibility',
          },
          body: {
            backgroundColor: tokens.pageBg,
            color: tokens.text,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' },
        },
      },
    },
  })
}
