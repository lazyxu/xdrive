import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider as MuiThemeProvider, useMediaQuery } from '@mui/material'
import { createXDriveMuiTheme } from '@xdrive/ui/mui'
import { normalizeXDriveAppearance, type XDriveAppearance } from '../../ui/shared/src'
import App from './App'
import './styles.css'

const APPEARANCE_KEY = 'xdrive.appearance'

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const [appearance, setAppearance] = React.useState<XDriveAppearance>(
    () => normalizeXDriveAppearance(localStorage.getItem(APPEARANCE_KEY)),
  )
  const resolvedMode = appearance === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : appearance
  const theme = React.useMemo(() => createXDriveMuiTheme(resolvedMode), [resolvedMode])

  React.useEffect(() => {
    document.documentElement.dataset.xdriveTheme = resolvedMode
    document.documentElement.style.colorScheme = resolvedMode
  }, [resolvedMode])

  const changeAppearance = React.useCallback((next: XDriveAppearance) => {
    localStorage.setItem(APPEARANCE_KEY, next)
    setAppearance(next)
  }, [])

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      <App appearance={appearance} onAppearanceChange={changeAppearance} />
    </MuiThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
