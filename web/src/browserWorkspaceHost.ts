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
}): XDriveWorkspaceHostAdapter {
  return {
    platform: 'web',
    // The Browser controls admin navigation separately with its verified
    // /me profile; these four ordinary routes never require an admin grant.
    adminRoleVerified: false,
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
    },
  }
}
