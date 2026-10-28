import {
  xDriveFileExplorerKeyboardProfileFromPlatform,
  type XDriveFileExplorerKeyboardProfile,
} from '../../ui/shared/src/file-explorer-keyboard'

/** Shortcut-label hint only: a denied optional WebKit UA getter must not blank Files. */
export function xDriveWebFilesKeyboardProfile(): XDriveFileExplorerKeyboardProfile {
  let platform = ''
  let userAgent = ''
  try {
    if (typeof navigator === 'undefined') return 'web'
    // Safari can deny either property independently. Do not lose the hint
    // that remains accessible, or treat a missing hint as OS authorization.
    try {
      const observed = navigator.platform
      if (typeof observed === 'string') platform = observed
    } catch { /* optional platform hint */ }
    try {
      const observed = navigator.userAgent
      if (typeof observed === 'string') userAgent = observed
    } catch { /* optional user-agent hint */ }
  } catch { /* even the global navigator getter can be restricted */ }
  return xDriveFileExplorerKeyboardProfileFromPlatform(`${platform} ${userAgent}`)
}
