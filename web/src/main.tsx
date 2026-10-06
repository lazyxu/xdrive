import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import { normalizeXDriveAppearance, type XDriveAppearance } from '../../ui/shared/src'
import type { XDriveFileExplorerMediaTraceScenario } from '@xdrive/ui/mui/perf'
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

const root = ReactDOM.createRoot(document.getElementById('root')!)
const perfScenario = import.meta.env.VITE_XDRIVE_FILE_EXPLORER_PERF === '1'
  ? new URLSearchParams(window.location.search).get('xdriveFileExplorerPerf')
  : null
const perfWindow = window as Window & {
  __xdriveFileExplorerPerfBoot?: string | null
  __xdriveFileExplorerPerfBootError?: string
}
perfWindow.__xdriveFileExplorerPerfBoot = perfScenario

if (perfScenario) {
  void import('@xdrive/ui/mui/perf').then((module) => {
    root.render(
      <XDriveAppearanceThemeProvider appearance="light">
        <module.XDriveFileExplorerPerformanceHarness scenario={perfScenario as XDriveFileExplorerMediaTraceScenario} />
      </XDriveAppearanceThemeProvider>,
    )
  }).catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    perfWindow.__xdriveFileExplorerPerfBootError = message
    console.error('__XDRIVE_FILE_EXPLORER_PERF_BOOT_ERROR__' + message)
  })
} else {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
}
