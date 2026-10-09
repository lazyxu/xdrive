import React from 'react'
import ReactDOM from 'react-dom/client'
import { XDriveAppearanceThemeProvider } from '@xdrive/ui/mui'
import { normalizeXDriveAppearance, type XDriveAppearance } from '../../ui/shared/src'
import type {
  XDriveFileExplorerMediaTraceScenario,
  XDriveGalleryRendererTraceScenario,
} from '@xdrive/ui/mui/perf'
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
const perfSearch = new URLSearchParams(window.location.search)
const fileExplorerPerfScenario = import.meta.env.VITE_XDRIVE_FILE_EXPLORER_PERF === '1'
  ? perfSearch.get('xdriveFileExplorerPerf')
  : null
const galleryPerfScenario = import.meta.env.VITE_XDRIVE_GALLERY_PERF === '1'
  ? perfSearch.get('xdriveGalleryPerf')
  : null
const largeTransferPerfScenario = import.meta.env.VITE_XDRIVE_LARGE_TRANSFER_PERF === '1'
  ? perfSearch.get('xdriveLargeTransferPerf')
  : null
const largeTransferPerfSample = perfSearch.get('xdriveLargeTransferSample') ?? 'sample-unknown'
const perfWindow = window as Window & {
  __xdriveFileExplorerPerfBoot?: string | null
  __xdriveFileExplorerPerfBootError?: string
  __xdriveGalleryPerfBoot?: string | null
  __xdriveGalleryPerfBootError?: string
  __xdriveLargeTransferPerfBoot?: string | null
  __xdriveLargeTransferPerfBootError?: string
}
perfWindow.__xdriveFileExplorerPerfBoot = fileExplorerPerfScenario
perfWindow.__xdriveGalleryPerfBoot = galleryPerfScenario
perfWindow.__xdriveLargeTransferPerfBoot = largeTransferPerfScenario

if (largeTransferPerfScenario) {
  void import('./LargeTransferPerformanceHarness').then((module) => {
    root.render(
      <module.XDriveLargeTransferPerformanceHarness
        scenario={largeTransferPerfScenario as 'upload' | 'download'}
        sample={largeTransferPerfSample}
      />,
    )
  }).catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    perfWindow.__xdriveLargeTransferPerfBootError = message
    console.error('__XDRIVE_LARGE_TRANSFER_PERF_BOOT_ERROR__' + message)
  })
} else if (galleryPerfScenario) {
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
