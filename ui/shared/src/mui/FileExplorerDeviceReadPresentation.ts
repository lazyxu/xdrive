import {
  xDriveFileExplorerAvailabilityError,
  xDriveFileExplorerAvailabilityFromSnapshot,
  type XDriveFileExplorerAvailability,
} from '../file-explorer-availability'
import { xDriveFileExplorerDeviceHydrationPathKey } from './FileExplorerHydrationStatus'

/**
 * A Host-neutral presentation of genuine local-device read evidence.
 * Does not start/cancel transfers, infer Owner permissions, read disk paths,
 * or turn an unavailable Agent into verified file corruption.
 */
export type XDriveFileExplorerDeviceReadState = Readonly<{
  Path: string
  Mode: string
  Pinned: boolean
  OnlineOnly: boolean
  AvailableOffline: boolean
  Mixed: boolean
  Syncing: boolean
  InSync: boolean
}>

export type XDriveFileExplorerDeviceReadEntry<T extends XDriveFileExplorerDeviceReadState> =
  Readonly<{ state?: T; error?: string }>

/** The exact visible Status column; unknown remains unknown, not 'synced'. */
export function xDriveFileExplorerDeviceReadStatus<T extends XDriveFileExplorerDeviceReadState>(
  entry: XDriveFileExplorerDeviceReadEntry<T> | undefined,
  hydrationProgressByPath: ReadonlyMap<string, number | null>,
  statusLabel: (state: T, syncing: boolean) => string,
): string | undefined {
  if (entry?.error) return '状态异常'
  if (!entry?.state) return undefined
  const hydrated = hydrationProgressByPath.has(
    xDriveFileExplorerDeviceHydrationPathKey(entry.state.Path),
  )
  return statusLabel(entry.state, hydrated)
}

/** The exact Availability column and optional, bounded hydration progress. */
export function xDriveFileExplorerDeviceReadAvailability<
  T extends XDriveFileExplorerDeviceReadState,
>(
  entry: XDriveFileExplorerDeviceReadEntry<T> | undefined,
  hydrationProgressByPath: ReadonlyMap<string, number | null>,
): XDriveFileExplorerAvailability | undefined {
  if (entry?.error) return xDriveFileExplorerAvailabilityError()
  if (!entry?.state) return undefined
  const hydrationProgress = hydrationProgressByPath.get(
    xDriveFileExplorerDeviceHydrationPathKey(entry.state.Path),
  )
  return xDriveFileExplorerAvailabilityFromSnapshot({
    mode: entry.state.Mode,
    pinned: entry.state.Pinned,
    onlineOnly: entry.state.OnlineOnly,
    availableOffline: entry.state.AvailableOffline,
    mixed: entry.state.Mixed,
    syncing: entry.state.Syncing || hydrationProgress !== undefined,
    progress: hydrationProgress ?? undefined,
  })
}
