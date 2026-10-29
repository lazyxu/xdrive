import type {
  XDriveCloudStorageDataSource,
  XDriveLocalStorageDataSource,
  XDriveWorkspaceHostAdapter,
} from '@xdrive/ui/mui'

/**
 * The Browser Host has real, already-authenticated Server / origin data ports
 * for these two migrated read surfaces. It never carries desktop IPC, NAS CGI,
 * backup-only Owner fallbacks or a fabricated Server administrator role.
 *
 * The Browser App still owns route hashes, current Owner/session, offline
 * runtime, Viewer and durable upload tasks. This Host is strictly page data.
 */
export function createXDriveBrowserWorkspaceHost(ports: {
  cloudStorage: XDriveCloudStorageDataSource
  localStorage: XDriveLocalStorageDataSource
}): XDriveWorkspaceHostAdapter {
  return {
    platform: 'web',
    adminRoleVerified: false,
    services: {
      cloudStorage: ports.cloudStorage,
      localStorage: ports.localStorage,
    },
  }
}
