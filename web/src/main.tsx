import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import { normalizeXDriveAppearance, type XDriveAppearance } from '../../ui/shared/src'
import App from './App'
import './styles.css'

const APPEARANCE_KEY = 'xdrive.appearance'

function Root() {
  const [appearance, setAppearance] = React.useState<XDriveAppearance>(
    () => normalizeXDriveAppearance(localStorage.getItem(APPEARANCE_KEY)),
  )

  const changeAppearance = React.useCallback((next: XDriveAppearance) => {
    localStorage.setItem(APPEARANCE_KEY, next)
    setAppearance(next)
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
