import type {
  XDriveCloudStorageDataSource,
  XDriveLocalStorageDataSource,
  XDriveWorkspaceHostAdapter,
  XDriveWorkspaceHostServices,
} from '@xdrive/ui/mui'

// A Browser never inherits native Agent/DSM fallbacks merely because it
// shares the React page dispatcher. Every route gets only its current,
// authenticated Web Server API or origin-scoped Browser data port.
type DeviceBackupPagePorts = {
  source: NonNullable<NonNullable<XDriveWorkspaceHostServices['deviceBackupPage']>['source']>
  initialSourceID?: number
}
type RemotePullPagePorts = Pick<
  NonNullable<XDriveWorkspaceHostServices['remotePullPage']>,
  'adapter' | 'initialSourceID' | 'defaultTargetNodeID' |
  'defaultTargetLabel' | 'defaultTargetPath' | 'onSelectedSourceChange' | 'onError'
>

export function createXDriveBrowserWorkspaceHost(ports: {
  cloudStorage: XDriveCloudStorageDataSource
  localStorage: XDriveLocalStorageDataSource
  deviceBackup?: DeviceBackupPagePorts
  remotePull?: RemotePullPagePorts
  /** Accepted only from the current authenticated Server /me profile. */
  adminRoleVerified?: boolean
  /** Existing Owner-scoped Web task/operation controller props. */
  taskCenter?: NonNullable<XDriveWorkspaceHostServices['taskCenterPage']>
  adminUsers?: NonNullable<XDriveWorkspaceHostServices['adminUsersPage']>
  adminAudit?: NonNullable<XDriveWorkspaceHostServices['adminAuditPage']>
}): XDriveWorkspaceHostAdapter {
  return {
    platform: 'web',
    // This UI gate is derived exclusively from the current authenticated
    // Server /me response, never a platform label or a native IPC claim.
    // Backend authorization remains mandatory on every task request.
    adminRoleVerified: ports.adminRoleVerified === true,
    services: {
      cloudStorage: ports.cloudStorage,
      localStorage: ports.localStorage,
      ...(ports.deviceBackup ? {
        // Owner device history and folder runs are Server read ports. No
        // local agent, device-root control, or native backup writer is exposed.
        deviceBackupPage: {
          source: ports.deviceBackup.source,
          initialSourceID: ports.deviceBackup.initialSourceID,
        },
      } : {}),
      ...(ports.remotePull ? {
        // Pull operations are existing Owner-authorized Server API calls,
        // never a new NAS/Agent RPC. Do not permit a Push-only UI here.
        remotePullPage: { ...ports.remotePull, directionFilter: 'pull' as const },
      } : {}),
      ...(ports.taskCenter ? {
        // The existing Web TaskCenter controller owns transfers, background
        // polling, operation receipts and cancellation. This is JSX routing,
        // NOT a new job queue or an implicit cross-Owner task capability.
        taskCenterPage: ports.taskCenter,
      } : {}),
      ...(ports.adminRoleVerified === true && ports.adminUsers ? {
        adminUsersPage: ports.adminUsers,
      } : {}),
      ...(ports.adminRoleVerified === true && ports.adminAudit ? {
        adminAuditPage: ports.adminAudit,
      } : {}),
    },
  }
}
