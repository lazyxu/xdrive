import type { XDriveLocalStorageDataSource, XDriveLocalStorageSnapshot } from './mui/LocalStoragePage'
import type { XDriveSynologyBackupLocalClient } from './synology-backup-adapter'
import { createXDriveSynologyBrowserStorageSource } from './synology-browser-storage'

/**
 * Same canonical LocalStorage page as Desktop, with separate verified NAS
 * filesystem facts. Browser StorageManager totals never become NAS totals.
 * No Server quota, path selector, Agent credentials or delete operation.
 */
export function createXDriveSynologyNASStorageSource(
  client: Pick<XDriveSynologyBackupLocalClient, 'nasVolumeSpace'>,
): XDriveLocalStorageDataSource {
  const browser = createXDriveSynologyBrowserStorageSource()
  return {
    async load(signal): Promise<XDriveLocalStorageSnapshot> {
      const result = await browser.load(signal)
      if (signal?.aborted) throw new Error('DSM storage read cancelled')
      try {
        const volume = await client.nasVolumeSpace(signal)
        if (signal?.aborted) throw new Error('DSM storage read cancelled')
        return { ...result, nasSpace: {
          supported: true,
          capacity_bytes: volume.capacity_bytes,
          available_bytes: volume.available_bytes,
        } }
      } catch (error) {
        if (signal?.aborted) throw error
        return { ...result, nasSpace: {
          supported: false,
          reason: '无法确认当前 DSM 套件数据所在文件系统容量；请检查登录授权和本机 Agent。',
        } }
      }
    },
  }
}
