import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import type { XDriveDeviceBackupDataSource } from '../device-backups'
import type { XDriveCloudStorageDataSource } from './CloudStoragePage'
import type { XDriveLocalStorageDataSource } from './LocalStoragePage'
import type { ComponentProps } from 'react'
import type { XDriveMediaGalleryPageProps } from './MediaGallery'
import type { XDriveSourceManagerProps } from './SourceManager'
import type { XDriveTaskCenterPageProps } from './TaskCenterPage'
import type { XDriveDeviceBackupPage } from './DeviceBackupPage'
import type XDriveAdminUsersPage from './AdminUsersPage'
import type XDriveAdminAuditPage from './AdminAuditPage'
import type XDriveGlobalStorageStatsPage from './GlobalStorageStatsPage'
import type { XDriveSystemMaintenancePage } from './SystemMaintenancePage'
import type { XDriveServiceDependenciesPage } from './ServiceDependenciesPage'
import type { XDriveConflictsPageProps } from './ConflictsPage'
import type { XDriveDiagnosticsPage } from './DiagnosticsPage'
import type { XDriveOverviewPageProps } from './OverviewPage'
import type { XDriveFileExplorerUnavailableActions } from './FileExplorer'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveDiagnosticsReadSource } from './DiagnosticsHostController'

/** Authenticated domain ports, not Host-owned JSX or a generic Agent proxy. */
export type XDriveWorkspaceHostServices = {
  /** Transitional Owner-scoped bridge until file/task domain ports converge. */
  readonly overviewPage?: XDriveOverviewPageProps
  readonly localBackupClient?: XDriveSynologyBackupLocalClient
  /**
   * An explicit opt-in to backup-only Owner read surfaces (Home, Tasks and
   * Backup). A Host gaining a local backup transport does NOT implicitly
   * replace its full application controllers with the NAS read fallback.
   */
  readonly ownerBackupReadFallback?: true
  /**
   * Explicit read-only Owner Files domain port. This transitional client
   * remains authenticated and Owner-scoped in the Host; the shared route
   * does not infer Files access from platform or backup CGI presence.
   * Missing mutations are advertised as disabled, never implemented as stubs.
   */
  readonly ownerFilesPage?: {
    readonly client: XDriveSynologyBackupLocalClient
    readonly unavailableActions?: XDriveFileExplorerUnavailableActions
  }
  /**
   * Transitional full Desktop Files controller, mounted only by the shared
   * Files route outlet. It is a live, authenticated native controller element,
   * NOT an alternative route registry or an admission to DSM/Browser writes.
   * Replace with host-neutral controller data/ports after extracting the
   * remaining DesktopFileExplorer lifecycle from its Electron wrapper.
   */
  readonly filesControllerContent?: ReactNode
  readonly deviceBackups?: XDriveDeviceBackupDataSource
  readonly cloudStorage?: XDriveCloudStorageDataSource
  /** Host-owned refresh policy, never inferred from a platform name. */
  readonly cloudStorageRefresh?: { readonly clearOnRefresh?: boolean }
  readonly localStorage?: XDriveLocalStorageDataSource
  /** Desktop and DSM use the same page JSX: only verified page props differ. */
  readonly galleryPage?: XDriveMediaGalleryPageProps
  readonly deviceBackupPage?: ComponentProps<typeof XDriveDeviceBackupPage>
  readonly remotePullPage?: XDriveSourceManagerProps
  readonly taskCenterPage?: XDriveTaskCenterPageProps
  readonly adminMaintenancePage?: ComponentProps<typeof XDriveSystemMaintenancePage>
  readonly adminUsersPage?: ComponentProps<typeof XDriveAdminUsersPage>
  readonly adminAuditPage?: ComponentProps<typeof XDriveAdminAuditPage>
  readonly adminStoragePage?: ComponentProps<typeof XDriveGlobalStorageStatsPage>
  readonly adminServicesPage?: ComponentProps<typeof XDriveServiceDependenciesPage>
  readonly conflictsPage?: XDriveConflictsPageProps
  readonly diagnosticsPage?: ComponentProps<typeof XDriveDiagnosticsPage>
  /** Explicit scoped Host read, never implied by an unrelated CGI client. */
  readonly diagnosticsSource?: XDriveDiagnosticsReadSource
}

export type XDriveWorkspaceHostAdapter = {
  /** Web/PWA uses the same page outlet only for explicitly supplied
   * authenticated Browser ports, never for a native Agent/DSM fallback. */
  readonly platform: 'desktop' | 'synology' | 'web'
  readonly services?: XDriveWorkspaceHostServices
  /** Only true after xDrive Server verifies the current account's admin role. */
  readonly adminRoleVerified?: boolean
  readonly unavailableMessage?: (view: XDriveWorkspaceAppRoute) => string
}
