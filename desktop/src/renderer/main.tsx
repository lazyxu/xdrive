import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import type { XDriveAppearance } from '@xdrive/shared'
import App from './App'
import './styles.css'

function Root() {
  const [appearance, setAppearance] = React.useState<XDriveAppearance>('system')

  React.useEffect(() => {
    let active = true
    void window.xdriveDesktop.getPreferences().then((preferences) => {
      if (active) setAppearance(preferences.appearance)
    })
    return () => { active = false }
  }, [])

  const changeAppearance = React.useCallback(async (next: XDriveAppearance) => {
    const result = await window.xdriveDesktop.setAppearance(next)
    if (!result.ok) throw new Error(result.error.message)
    setAppearance(result.data.appearance)
  }, [])

  return (
    <XDriveAppearanceThemeProvider appearance={appearance}>
      <App appearance={appearance} onAppearanceChange={changeAppearance} />
    </XDriveAppearanceThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
