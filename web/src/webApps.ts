import type { XDriveWebAppID, XDriveWebAppPresentation, XDriveWebAppRoute } from '../../ui/shared/src'
import {
  xDriveWorkspaceKeyFromWebApp,
  xDriveWebAppForWorkspaceRoute,
  xDriveWebRouteForWorkspaceRoute,
} from '../../ui/shared/src/web-workspace-route'

export type XDriveWebAppDescriptor = {
  id: XDriveWebAppID
  title: string
  presentation: XDriveWebAppPresentation
  workspaceKey?: string
  sidebar: boolean
  admin?: boolean
}

export const XDRIVE_WEB_APPS: Record<XDriveWebAppID, XDriveWebAppDescriptor> = {
  overview: { id: 'overview', title: '主页', presentation: 'workspace', workspaceKey: 'overview', sidebar: true },
  files: { id: 'files', title: '文件', presentation: 'workspace', workspaceKey: 'files', sidebar: true },
  gallery: { id: 'gallery', title: '图库', presentation: 'workspace', workspaceKey: 'gallery', sidebar: true },
  'sync-folders': { id: 'sync-folders', title: '同步文件夹', presentation: 'workspace', sidebar: false }, // compatibility route
  'device-backup': { id: 'device-backup', title: '设备备份', presentation: 'workspace', workspaceKey: 'device-backup', sidebar: true },
  'remote-pull': { id: 'remote-pull', title: '远程拉取', presentation: 'workspace', workspaceKey: 'remote-pull', sidebar: true },
  tasks: { id: 'tasks', title: '任务', presentation: 'workspace', workspaceKey: 'transfers', sidebar: true },
  'local-storage': { id: 'local-storage', title: '本地存储', presentation: 'workspace', workspaceKey: 'local-storage', sidebar: true },
  'cloud-storage': { id: 'cloud-storage', title: '云端存储', presentation: 'workspace', workspaceKey: 'cloud-storage', sidebar: true },
  preview: { id: 'preview', title: '预览', presentation: 'immersive', sidebar: false },
  'media-viewer': { id: 'media-viewer', title: '媒体查看器', presentation: 'immersive', sidebar: false },
  'text-viewer': { id: 'text-viewer', title: '文本/代码查看器', presentation: 'viewer', sidebar: false },
  'pdf-viewer': { id: 'pdf-viewer', title: 'PDF 查看器', presentation: 'viewer', sidebar: false },
  'audio-player': { id: 'audio-player', title: '音频播放器', presentation: 'viewer', sidebar: false },
  'admin-users': { id: 'admin-users', title: '用户管理', presentation: 'workspace', workspaceKey: 'admin-users', sidebar: true, admin: true },
  'admin-audit': { id: 'admin-audit', title: '审计日志', presentation: 'workspace', workspaceKey: 'admin-audit', sidebar: true, admin: true },
  'admin-storage': { id: 'admin-storage', title: '全局存储', presentation: 'workspace', workspaceKey: 'admin-storage', sidebar: true, admin: true },
  'admin-services': { id: 'admin-services', title: '系统依赖', presentation: 'workspace', workspaceKey: 'admin-services', sidebar: true, admin: true },
  'admin-maintenance': { id: 'admin-maintenance', title: '系统维护', presentation: 'workspace', workspaceKey: 'admin-maintenance', sidebar: true, admin: true },
}

export function xDriveWebAppWorkspaceKey(app: XDriveWebAppID, params?: XDriveWebAppRoute['params']) {
  return xDriveWorkspaceKeyFromWebApp(app, params)
}

export function xDriveWebAppForWorkspaceKey(key: string): XDriveWebAppID | null {
  return xDriveWebAppForWorkspaceRoute(key)
}

export function xDriveWebAppRouteForWorkspaceKey(key: string): XDriveWebAppRoute | null {
  return xDriveWebRouteForWorkspaceRoute(key)
}
