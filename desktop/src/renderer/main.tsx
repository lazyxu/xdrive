import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import type { XDriveAppearance } from '@xdrive/shared'
import type { XDriveFileExplorerMediaTraceScenario } from '@xdrive/ui/mui/perf'
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
