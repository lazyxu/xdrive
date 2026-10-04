import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import { createXDriveMuiTheme } from '@xdrive/ui/mui'
import type { XDriveAppearance } from '@xdrive/shared'
import App from './App'
import './styles.css'

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const [appearance, setAppearance] = React.useState<XDriveAppearance>('system')

  React.useEffect(() => {
    let active = true
    void window.xdriveDesktop.getPreferences().then((preferences) => {
      if (active) setAppearance(preferences.appearance)
    })
    return () => { active = false }
  }, [])

  const resolvedMode = appearance === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : appearance

  React.useEffect(() => {
    document.documentElement.dataset.xdriveTheme = resolvedMode
  }, [resolvedMode])

  const theme = React.useMemo(
    () => createXDriveMuiTheme(resolvedMode),
    [resolvedMode],
  )

  const changeAppearance = React.useCallback(async (next: XDriveAppearance) => {
    const result = await window.xdriveDesktop.setAppearance(next)
    if (!result.ok) throw new Error(result.error.message)
    setAppearance(result.data.appearance)
  }, [])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App appearance={appearance} onAppearanceChange={changeAppearance} />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
