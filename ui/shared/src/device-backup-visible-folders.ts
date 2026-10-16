import type { XDriveDeviceBackupDevice, XDriveDeviceBackupFolder } from './device-backups'

// A manually paged owner-redacted keyset replaces the overview preview
// only after it supplies data or explicitly completes with zero rows.
export interface XDriveDeviceBackupFolderReadOverlay {
  items: XDriveDeviceBackupFolder[]
  complete: boolean
}

export function xDriveDeviceBackupVisibleFolders(
  device: XDriveDeviceBackupDevice,
  page?: XDriveDeviceBackupFolderReadOverlay,
): XDriveDeviceBackupFolder[] {
  return page && (page.items.length !== 0 || page.complete) ? page.items : device.folders
}

// A deep link can reference a Source omitted by the global 1000-binding
// preview; never fall back to unrestricted Source/Root lookup to find it.
export function xDriveDeviceBackupContainsVisibleSource(
  devices: XDriveDeviceBackupDevice[],
  pages: Record<string, XDriveDeviceBackupFolderReadOverlay>,
  sourceID: number,
): boolean {
  return Number.isSafeInteger(sourceID) && sourceID > 0 && devices.some((device) =>
    xDriveDeviceBackupVisibleFolders(device, pages[device.id])
      .some((folder) => folder.source_id === sourceID),
  )
}
