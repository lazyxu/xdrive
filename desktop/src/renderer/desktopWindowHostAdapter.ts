import type { DesktopWindowHostActions } from './DesktopHostFrame'

/** Narrow Electron window capability; never exposed to DSM or shared pages. */
export const desktopWindowHostAdapter: DesktopWindowHostActions = {
  minimize: () => { window.xdriveDesktop.minimizeWindow() },
  toggleMaximize: () => { window.xdriveDesktop.toggleMaximizeWindow() },
  close: () => { window.xdriveDesktop.closeWindow() },
}
