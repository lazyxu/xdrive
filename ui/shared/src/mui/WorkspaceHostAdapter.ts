import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveDeviceBackupDataSource } from '../device-backups'
import type { XDriveCloudStorageDataSource } from './CloudStoragePage'
import type { XDriveLocalStorageDataSource } from './LocalStoragePage'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'

/** Authenticated domain ports, not Host-owned JSX or a generic Agent proxy. */
export type XDriveWorkspaceHostServices = {
  /** Transitional Owner-scoped bridge until file/task domain ports converge. */
  readonly localBackupClient?: XDriveSynologyBackupLocalClient
  readonly deviceBackups?: XDriveDeviceBackupDataSource
  readonly cloudStorage?: XDriveCloudStorageDataSource
  readonly localStorage?: XDriveLocalStorageDataSource
}

export type XDriveWorkspaceHostAdapter = {
  readonly platform: 'desktop' | 'synology'
  readonly services?: XDriveWorkspaceHostServices
  /** Only true after xDrive Server verifies the current account's admin role. */
  readonly adminRoleVerified?: boolean
  readonly unavailableMessage?: (view: XDriveWorkspaceAppRoute) => string
}
