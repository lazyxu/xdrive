import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import type { XDriveAppearance } from '@xdrive/shared'
import type {
  XDriveFileExplorerMediaTraceScenario,
  XDriveGalleryRendererTraceScenario,
} from '@xdrive/ui/mui/perf'
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
const perfSearch = new URLSearchParams(window.location.search)
const fileExplorerPerfScenario = import.meta.env.VITE_XDRIVE_FILE_EXPLORER_PERF === '1'
  ? perfSearch.get('xdriveFileExplorerPerf')
  : null
const galleryPerfScenario = import.meta.env.VITE_XDRIVE_GALLERY_PERF === '1'
  ? perfSearch.get('xdriveGalleryPerf')
  : null
const perfWindow = window as Window & {
  __xdriveFileExplorerPerfBoot?: string | null
  __xdriveFileExplorerPerfBootError?: string
  __xdriveGalleryPerfBoot?: string | null
  __xdriveGalleryPerfBootError?: string
}
perfWindow.__xdriveFileExplorerPerfBoot = fileExplorerPerfScenario
perfWindow.__xdriveGalleryPerfBoot = galleryPerfScenario

if (galleryPerfScenario) {
  void import('@xdrive/ui/mui/perf').then((module) => {
    root.render(
      <XDriveAppearanceThemeProvider appearance="light">
        <module.XDriveGalleryPerformanceHarness scenario={galleryPerfScenario as XDriveGalleryRendererTraceScenario} />
      </XDriveAppearanceThemeProvider>,
    )
  }).catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    perfWindow.__xdriveGalleryPerfBootError = message
    console.error('__XDRIVE_GALLERY_PERF_BOOT_ERROR__' + message)
  })
} else if (fileExplorerPerfScenario) {
  void import('@xdrive/ui/mui/perf').then((module) => {
    root.render(
      <XDriveAppearanceThemeProvider appearance="light">
        <module.XDriveFileExplorerPerformanceHarness scenario={fileExplorerPerfScenario as XDriveFileExplorerMediaTraceScenario} />
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
