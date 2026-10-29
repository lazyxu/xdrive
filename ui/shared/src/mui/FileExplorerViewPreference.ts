import { useCallback, useEffect, useState } from 'react'
import type { XDriveFileExplorerViewMode } from './FileExplorer'

/**
 * Desktop's existing preference keys are intentionally kept for upgrades.
 * DSM has a different browser origin and therefore stores its own preferences,
 * but the Files layout and presentation now follow the same schema and defaults.
 * These keys never contain Server Owner identity, paths, credentials or data.
 */
export const XDRIVE_HOST_FILES_PREFERENCES = {
  viewMode: 'xdrive.desktop.files.view_mode',
  detailsLayout: 'xdrive.desktop.files.details_layout',
  viewPreferences: 'xdrive.desktop.files.view_preferences',
} as const

export function xDriveReadFileExplorerStoredViewMode(
  storageKey: string,
): XDriveFileExplorerViewMode {
  if (!storageKey || typeof window === 'undefined') return 'details'
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === 'grid' || stored === 'columns' ? stored : 'details'
  } catch {
    // Storage may be denied in private browsing/DSM restricted sessions.
    // The FileExplorer remains usable with an in-memory Details fallback.
    return 'details'
  }
}

/**
 * A small Host-neutral view-only controller. Desktop's tabbed Files navigation
 * uses the same stored-view parser; DSM uses this hook for its single current
 * Owner Files workspace. A preference is UI state, never an Owner capability.
 */
export function useXDriveFileExplorerPersistedViewMode(storageKey: string) {
  const [snapshot, setSnapshot] = useState(() => ({
    key: storageKey, mode: xDriveReadFileExplorerStoredViewMode(storageKey),
  }))
  // On a key switch, never show the previous Host's preferred mode even before
  // passive effects. No file/Owner data is persisted by this controller.
  const viewMode = snapshot.key === storageKey
    ? snapshot.mode : xDriveReadFileExplorerStoredViewMode(storageKey)

  useEffect(() => {
    setSnapshot({ key: storageKey, mode: xDriveReadFileExplorerStoredViewMode(storageKey) })
  }, [storageKey])

  const onViewModeChange = useCallback((mode: XDriveFileExplorerViewMode) => {
    if (mode !== 'details' && mode !== 'grid' && mode !== 'columns') return
    setSnapshot({ key: storageKey, mode })
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, mode)
    } catch {
      // Do not report success of persistence or unmount the Files workspace.
      // The current in-memory mode remains available.
    }
  }, [storageKey])

  return { viewMode, onViewModeChange }
}
