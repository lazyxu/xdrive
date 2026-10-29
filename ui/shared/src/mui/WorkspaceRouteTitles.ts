import { xDriveIsWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'

// Canonical display vocabulary for Desktop, DSM, Web/PWA and iOS WKWebView.
// Native Android uses the same product contract, but does not render JSX.
// Titles never grant Owner permissions or privileged Host capabilities.
export const XDRIVE_WORKSPACE_ROUTE_TITLES = {
  overview: '主页',
  files: '文件',
  gallery: '图库',
  'device-backup': '设备备份',
  'remote-pull': '远程拉取',
  transfers: '任务',
  'global-tasks': '全局后台任务',
  'local-storage': '本地存储',
  'cloud-storage': '云端存储',
  conflicts: '冲突',
  diagnostics: '诊断',
  'admin-users': '用户管理',
  'admin-audit': '审计日志',
  'admin-storage': '全局存储',
  'admin-services': '系统依赖',
  'admin-maintenance': '备份与系统维护',
} as const satisfies Readonly<Record<XDriveWorkspaceAppRoute, string>>

/** Browser Viewer/preview and unknown routes have no workspace title. */
export function xDriveWorkspaceRouteTitle(route: string, fallback = 'xDrive'): string {
  return xDriveIsWorkspaceAppRoute(route)
    ? XDRIVE_WORKSPACE_ROUTE_TITLES[route]
    : fallback
}
