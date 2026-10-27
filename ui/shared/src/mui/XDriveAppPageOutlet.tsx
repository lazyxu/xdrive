import type { ReactNode } from 'react'
import { XDriveStatePanel } from './StatePanel'
import { XDriveHomePage } from './HomePage'
import { XDriveSynologyOwnerFilesPage } from './SynologyOwnerFilesPage'
import { XDriveDeviceBackupPage } from './DeviceBackupPage'
import { XDriveSynologyDiagnosticsPanel } from './SynologyDiagnosticsPanel'
import { XDriveTaskCenterPage } from './TaskCenterPage'
import { XDriveCloudStoragePage } from './CloudStoragePage'
import { XDriveLocalStoragePage } from './LocalStoragePage'
import {
  xDriveIsWorkspaceAppRoute,
  xDriveWorkspaceRouteRequiresAdmin,
  type XDriveWorkspaceAppRoute,
} from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

/**
 * One shared page dispatcher: Hosts provide authenticated domain sources,
 * never route-specific JSX factories. The existing read-only DSM Owner-files
 * controller remains transitional but already renders common FileExplorer.
 */
export function XDriveAppPageOutlet({
  host, view, revision = 0, onNavigate,
}: {
  host: XDriveWorkspaceHostAdapter
  view: string
  revision?: number
  onNavigate?: (view: XDriveWorkspaceAppRoute) => void
}) {
  if (!xDriveIsWorkspaceAppRoute(view)) {
    return <XDriveStatePanel message="未知的 xDrive 页面。" />
  }
  // Every backend request still requires Server and Agent authorization.
  if (xDriveWorkspaceRouteRequiresAdmin(view) && host.adminRoleVerified !== true) {
    return <XDriveStatePanel message="此页面需要经过 xDrive Server 确认的管理员身份。" />
  }
  const services = host.services
  const local = services?.localBackupClient
  const navigate = (destination: XDriveWorkspaceAppRoute) =>
    onNavigate ? () => onNavigate(destination) : undefined
  let page: ReactNode | null = null
  if (services) {
    switch (view) {
      case 'overview':
        if (local) page = (
          <XDriveHomePage key={revision} localBackupClient={local}
            onOpenBackup={navigate('device-backup')}
            onOpenTasks={navigate('transfers')}
            onOpenDiagnostics={navigate('diagnostics')}
            onOpenCloudStorage={navigate('cloud-storage')} />
        )
        break
      case 'files':
        if (local) page = <XDriveSynologyOwnerFilesPage key={revision} client={local} />
        break
      case 'device-backup':
        if (local) page = (
          <XDriveDeviceBackupPage key={revision}
            localBackupClient={local} source={services.deviceBackups} />
        )
        break
      case 'diagnostics':
        if (local) page = <XDriveSynologyDiagnosticsPanel key={revision} client={local} />
        break
      case 'transfers':
        if (local) page = (
          // With local Agent enabled, TaskCenter ignores Server arrays;
          // empty arguments do not mean Server feeds were verified empty.
          <XDriveTaskCenterPage key={revision} transfers={[]} operations={[]}
            localBackupClient={local} onOpenLocalBackup={navigate('device-backup')} />
        )
        break
      case 'cloud-storage':
        if (services.cloudStorage) page = (
          <XDriveCloudStoragePage key={revision} source={services.cloudStorage} clearOnRefresh />
        )
        break
      case 'local-storage':
        if (services.localStorage) page = (
          <XDriveLocalStoragePage key={revision} source={services.localStorage} />
        )
        break
      default:
        break
    }
  }
  if (!page) {
    return <XDriveStatePanel message={
      host.unavailableMessage?.(view) ??
      '此宿主尚未接通当前功能。界面与 Desktop 共用，操作需要真实的宿主能力。'
    } />
  }
  return <>{page}</>
}
