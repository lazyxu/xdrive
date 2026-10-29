import type { ReactNode } from 'react'
import { XDriveStatePanel } from './StatePanel'
import { XDriveHomePage } from './HomePage'
import { XDriveOverviewPage } from './OverviewPage'
import { XDriveMediaGalleryPage } from './MediaGallery'
import { XDriveSourceManager } from './SourceManager'
import { XDriveSynologyOwnerFilesPage } from './SynologyOwnerFilesPage'
import { XDriveDeviceBackupPage } from './DeviceBackupPage'
import { XDriveDiagnosticsHostController } from './DiagnosticsHostController'
import { XDriveConflictsPage } from './ConflictsPage'
import { XDriveDiagnosticsPage } from './DiagnosticsPage'
import { XDriveTaskCenterPage } from './TaskCenterPage'
import { XDriveCloudStoragePage } from './CloudStoragePage'
import { XDriveLocalStoragePage } from './LocalStoragePage'
import { XDriveSystemMaintenancePage } from './SystemMaintenancePage'
import XDriveAdminUsersPage from './AdminUsersPage'
import XDriveAdminAuditPage from './AdminAuditPage'
import XDriveGlobalStorageStatsPage from './GlobalStorageStatsPage'
import { XDriveServiceDependenciesPage } from './ServiceDependenciesPage'
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
  // Only an explicit Host capability admits backup-only Owner read surfaces.
  // A Desktop Host gaining a local Agent port must not silently replace its
  // native controllers with an unrelated NAS fallback.
  const local = services?.ownerBackupReadFallback === true
    ? services.localBackupClient : undefined
  const navigate = (destination: XDriveWorkspaceAppRoute) =>
    onNavigate ? () => onNavigate(destination) : undefined
  let page: ReactNode | null = null
  if (services) {
    switch (view) {
      case 'overview':
        if (services.overviewPage) page = <XDriveOverviewPage key={revision} {...services.overviewPage} />
        else if (local) page = (
          <XDriveHomePage key={revision} localBackupClient={local}
            onOpenBackup={navigate('device-backup')}
            onOpenTasks={navigate('transfers')}
            onOpenDiagnostics={navigate('diagnostics')}
            onOpenCloudStorage={navigate('cloud-storage')} />
        )
        break
      case 'gallery':
        if (services.galleryPage) page = <XDriveMediaGalleryPage {...services.galleryPage} />
        break
      case 'remote-pull':
        if (services.remotePullPage) page = <XDriveSourceManager {...services.remotePullPage} />
        break
      case 'files':
        // Only an explicit authenticated Owner Files port admits this page.
        // A generic local backup client never implies Files read permission.
        if (services.ownerFilesPage) page = (
          <XDriveSynologyOwnerFilesPage key={revision}
            client={services.ownerFilesPage.client}
            unavailableActions={services.ownerFilesPage.unavailableActions} />
        )
        break
      case 'device-backup':
        if (services.deviceBackupPage) {
          page = <XDriveDeviceBackupPage key={revision} {...services.deviceBackupPage} />
        } else if (local) page = (
          <XDriveDeviceBackupPage key={revision}
            localBackupClient={local} source={services.deviceBackups} />
        )
        break
      case 'conflicts':
        if (services.conflictsPage) page = (
          <XDriveConflictsPage {...services.conflictsPage} />
        )
        break
      case 'diagnostics':
        if (services.diagnosticsPage) page = (
          <XDriveDiagnosticsPage {...services.diagnosticsPage} />
        )
        else if (services.diagnosticsSource) page = (
          <XDriveDiagnosticsHostController key={revision} source={services.diagnosticsSource} />
        )
        break
      case 'transfers':
      case 'global-tasks':
        if (services.taskCenterPage) {
          page = <XDriveTaskCenterPage key={revision} {...services.taskCenterPage}
            backgroundScope={view === 'global-tasks' ? 'global' : 'mine'}
            mediaSelectionJobPort={view === 'global-tasks' ? undefined : services.taskCenterPage.mediaSelectionJobPort} />
        } else if (local && view === 'transfers') page = (
          // With local Agent enabled, TaskCenter ignores Server arrays;
          // empty arguments do not mean Server feeds were verified empty.
          <XDriveTaskCenterPage key={revision} transfers={[]} operations={[]}
            localBackupClient={local} onOpenLocalBackup={navigate('device-backup')} />
        )
        break
      case 'cloud-storage':
        if (services.cloudStorage) page = (
          <XDriveCloudStoragePage key={revision} source={services.cloudStorage}
            clearOnRefresh={services.cloudStorageRefresh?.clearOnRefresh === true} />
        )
        break
      case 'local-storage':
        if (services.localStorage) page = (
          <XDriveLocalStoragePage key={revision} source={services.localStorage} />
        )
        break
      case 'admin-maintenance':
        if (services.adminMaintenancePage) page = (
          <XDriveSystemMaintenancePage {...services.adminMaintenancePage} />
        )
        break
      case 'admin-users':
        if (services.adminUsersPage) page = (
          <XDriveAdminUsersPage {...services.adminUsersPage} />
        )
        break
      case 'admin-audit':
        if (services.adminAuditPage) page = (
          <XDriveAdminAuditPage {...services.adminAuditPage} />
        )
        break
      case 'admin-storage':
        if (services.adminStoragePage) page = (
          <XDriveGlobalStorageStatsPage {...services.adminStoragePage} />
        )
        break
      case 'admin-services':
        if (services.adminServicesPage) page = (
          <XDriveServiceDependenciesPage {...services.adminServicesPage} />
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
