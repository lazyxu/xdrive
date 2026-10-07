export type XDriveFileExplorerKeyboardProfile = 'windows' | 'macos' | 'web'

export type XDriveFileExplorerKeyboardCommand =
  | 'new-tab'
  | 'close-tab'
  | 'restore-closed-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'back'
  | 'forward'
  | 'up'
  | 'focus-path'
  | 'focus-search'
  | 'refresh'
  | 'new-folder'
  | 'toggle-inspector'
  | 'undo'
  | 'redo'
  | 'rename'
  | 'context-menu'
  | 'select-all'
  | 'copy'
  | 'copy-path'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'properties'
  | 'open'
  | 'quick-look'

export type XDriveFileExplorerKeyboardEventLike = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export function xDriveFileExplorerKeyboardProfileFromPlatform(
  platform: string | null | undefined,
): XDriveFileExplorerKeyboardProfile {
  const value = (platform ?? '').trim().toLocaleLowerCase()
  if (
    value === 'darwin' ||
    value.includes('mac') ||
    value.includes('iphone') ||
    value.includes('ipad')
  ) {
    return 'macos'
  }
  if (value === 'win32' || value.includes('windows') || value.startsWith('win')) {
    return 'windows'
  }
  return 'web'
}

export function xDriveFileExplorerPrimaryModifierActive(
  event: XDriveFileExplorerKeyboardEventLike,
  profile: XDriveFileExplorerKeyboardProfile,
) {
  if (profile === 'macos') return Boolean(event.metaKey)
  if (profile === 'windows') return Boolean(event.ctrlKey)
  return Boolean(event.ctrlKey || event.metaKey)
}

function xDriveFileExplorerSecondaryPrimaryModifierActive(
  event: XDriveFileExplorerKeyboardEventLike,
  profile: XDriveFileExplorerKeyboardProfile,
) {
  if (profile === 'macos') return Boolean(event.ctrlKey)
  if (profile === 'windows') return Boolean(event.metaKey)
  return false
}

function xDriveFileExplorerPlainKey(event: XDriveFileExplorerKeyboardEventLike) {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

function xDriveFileExplorerPrimaryOnly(
  event: XDriveFileExplorerKeyboardEventLike,
  profile: XDriveFileExplorerKeyboardProfile,
  shift = false,
) {
  return (
    xDriveFileExplorerPrimaryModifierActive(event, profile) &&
    !xDriveFileExplorerSecondaryPrimaryModifierActive(event, profile) &&
    !event.altKey &&
    Boolean(event.shiftKey) === shift
  )
}

export function xDriveFileExplorerKeyboardTabIndex(
  event: XDriveFileExplorerKeyboardEventLike,
  profile: XDriveFileExplorerKeyboardProfile,
): number | null {
  if (
    profile !== 'windows' ||
    !event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !/^[1-9]$/.test(event.key)
  ) {
    return null
  }
  return Number(event.key) - 1
}

export function xDriveFileExplorerKeyboardCommand(
  event: XDriveFileExplorerKeyboardEventLike,
  profile: XDriveFileExplorerKeyboardProfile,
): XDriveFileExplorerKeyboardCommand | null {
  const key = event.key.toLocaleLowerCase()
  const primary = xDriveFileExplorerPrimaryModifierActive(event, profile)

  if (
    profile === 'macos' &&
    key === 'c' &&
    Boolean(event.metaKey) &&
    Boolean(event.altKey) &&
    !event.ctrlKey &&
    !event.shiftKey
  ) {
    return 'copy-path'
  }

  if (
    profile === 'macos' &&
    key === 'tab' &&
    Boolean(event.ctrlKey) &&
    !event.metaKey &&
    !event.altKey
  ) {
    return event.shiftKey ? 'previous-tab' : 'next-tab'
  }

  if (
    profile === 'windows' &&
    key === 'insert' &&
    Boolean(event.ctrlKey) &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return 'copy'
  }

  if (
    profile === 'windows' &&
    key === 'insert' &&
    Boolean(event.shiftKey) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    return 'paste'
  }

  if (xDriveFileExplorerPrimaryOnly(event, profile)) {
    if (key === 't') return 'new-tab'
    if (key === 'w') return 'close-tab'
    if (key === 'tab' && profile !== 'macos') return 'next-tab'
    if (key === 'f') return 'focus-search'
    if (key === 'a') return 'select-all'
    if (key === 'c') return 'copy'
    if (key === 'x') return 'cut'
    if (key === 'v') return 'paste'
    if (key === 'z') return 'undo'

    if (profile === 'macos') {
      if (key === '[') return 'back'
      if (key === ']') return 'forward'
      if (key === 'arrowup') return 'up'
      if (key === 'arrowdown' || key === 'o') return 'open'
      if (key === 'i') return 'properties'
      if (key === 'y') return 'quick-look'
      if (key === 'backspace') return 'delete'
    } else {
      if (key === 'l') return 'focus-path'
      if (key === 'e') return 'focus-search'
      if (key === 'r') return 'refresh'
      if (key === 'y') return 'redo'
      if (profile === 'windows' && key === 'd') return 'delete'
    }
  }

  if (xDriveFileExplorerPrimaryOnly(event, profile, true)) {
    if (key === 't') return 'restore-closed-tab'
    if (key === 'tab' && profile !== 'macos') return 'previous-tab'
    if (key === 'n') return 'new-folder'
    if (key === 'z') return 'redo'
    if (key === 'c' && profile !== 'macos') return 'copy-path'

    if (profile === 'macos') {
      if (key === 'g') return 'focus-path'
      if (key === 'p') return 'toggle-inspector'
    }
  }

  if (profile !== 'macos' && event.altKey && !primary && !event.shiftKey) {
    if (key === 'arrowleft') return 'back'
    if (key === 'arrowright') return 'forward'
    if (key === 'arrowup') return 'up'
    if (key === 'd') return 'focus-path'
    if (key === 'p') return 'toggle-inspector'
    if (key === 'enter') return 'properties'
  }

  if (profile !== 'macos' && event.shiftKey && !primary && !event.altKey && key === 'f10') {
    return 'context-menu'
  }

  if (xDriveFileExplorerPlainKey(event)) {
    if (key === ' ') return 'quick-look'

    if (profile === 'macos') {
      if (key === 'enter') return 'rename'
      return null
    }

    if (key === 'enter') return 'open'
    if (key === 'backspace') return 'back'
    if (key === 'delete') return 'delete'
    if (key === 'f2') return 'rename'
    if (key === 'f3') return 'focus-search'
    if (key === 'f4') return 'focus-path'
    if (key === 'f5') return 'refresh'
  }

  return null
}
