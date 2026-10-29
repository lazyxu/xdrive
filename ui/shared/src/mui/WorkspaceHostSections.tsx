import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import {
  xDriveDiagnosticsSidebarDestination,
  xDriveSettingsSidebarDestination,
} from './WorkspaceNavigation'
import type { XDriveSidebarSectionModel } from './WorkspaceNavigation'
import { xDriveWorkspaceRouteTitle } from './WorkspaceRouteTitles'

/** Shared Desktop / DSM navigation. Only the authenticated xDrive Server
 * admin role may reveal admin entries; it grants no backend authorization. */
export function xDriveWorkspaceHostSections({
  adminRoleVerified = false,
  conflictCount,
  diagnosticsAriaLabel = 'xDrive 辅助功能',
  includeUtilityRoutes = true,
}: {
  adminRoleVerified?: boolean
  conflictCount?: number
  diagnosticsAriaLabel?: string
  /** False for Web/PWA: Settings lives in its account menu, while these
   * Host-only utility pages have not been migrated to the browser. */
  includeUtilityRoutes?: boolean
} = {}): XDriveSidebarSectionModel[] {
  return [
    {
      key: 'overview',
      placement: 'before-core',
      items: [{ key: 'overview', label: xDriveWorkspaceRouteTitle('overview'), icon: <DashboardRoundedIcon fontSize="small" /> }],
    },
    ...(includeUtilityRoutes ? [{
      key: 'conflicts',
      placement: 'after-core' as const,
      items: [{
        key: 'conflicts', label: xDriveWorkspaceRouteTitle('conflicts'),
        icon: <WarningAmberRoundedIcon fontSize="small" />,
        badge: conflictCount,
      }],
    }, {
      key: 'diagnostics',
      ariaLabel: diagnosticsAriaLabel,
      placement: 'after-core' as const,
      items: [xDriveDiagnosticsSidebarDestination()],
    }] : []),
    ...(adminRoleVerified ? [{
      key: 'admin',
      label: '管理',
      ariaLabel: '管理员功能',
      placement: 'after-core' as const,
      items: [
        { key: 'admin-users', label: xDriveWorkspaceRouteTitle('admin-users'), icon: <ManageAccountsRoundedIcon fontSize="small" /> },
        { key: 'global-tasks', label: xDriveWorkspaceRouteTitle('global-tasks'), icon: <AdminPanelSettingsOutlinedIcon fontSize="small" /> },
        { key: 'admin-audit', label: xDriveWorkspaceRouteTitle('admin-audit'), icon: <AssessmentRoundedIcon fontSize="small" /> },
        { key: 'admin-storage', label: xDriveWorkspaceRouteTitle('admin-storage'), icon: <StorageRoundedIcon fontSize="small" /> },
        { key: 'admin-services', label: xDriveWorkspaceRouteTitle('admin-services'), icon: <DnsRoundedIcon fontSize="small" /> },
        { key: 'admin-maintenance', label: xDriveWorkspaceRouteTitle('admin-maintenance'), icon: <BuildRoundedIcon fontSize="small" /> },
      ],
    }] : []),
    ...(includeUtilityRoutes ? [{
      key: 'settings',
      placement: 'bottom' as const,
      items: [xDriveSettingsSidebarDestination()],
    }] : []),
  ]
}
