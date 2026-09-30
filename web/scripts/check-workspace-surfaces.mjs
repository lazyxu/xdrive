import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

const workspace = readRepo('ui/shared/src/mui/WorkspaceSurface.tsx')
const sources = read('src/ExternalSources.tsx')
const storage = read('src/StorageStatsPanel.tsx')
const adminUsers = read('src/AdminUsers.tsx')
const adminAudit = read('src/AdminAudit.tsx')

const requireText = (source, values, label) => {
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`${label} missing: ${value}`)
  }
}

requireText(workspace, [
  "export type XDriveWorkspacePresentation = 'dialog' | 'page'",
  'export function XDriveWorkspaceSurface',
  "presentation === 'page'",
  'workspace-page-surface',
  'subtitle={subtitle}',
  'actions={pageActions}',
  '<Dialog',
  '<XDriveDialogTitle',
  '<XDriveDialogContent',
], 'XDriveWorkspaceSurface')

requireText(sources, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  'title="外部来源"',
  'subtitle="统一管理外部媒体来源、凭据、调度方式与运行状态。"',
  'pageActions={',
], 'ExternalSources')

requireText(storage, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  "title={scope === 'global' ? '全局存储' : '存储'}",
], 'StorageStats')

requireText(adminUsers, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  'title="用户管理"',
], 'AdminUsers')

requireText(adminAudit, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  'title="审计日志"',
], 'AdminAudit')

if (sources.includes("presentation = 'dialog'") || sources.includes("presentation?: 'dialog' | 'page'") || sources.includes('surfaceOpen')) {
  throw new Error('ExternalSources top-level workspace must remain page-only')
}
for (const [name, source] of [
  ['StorageStats', storage],
  ['AdminUsers', adminUsers],
  ['AdminAudit', adminAudit],
]) {
  if (source.includes("presentation = 'dialog'") || source.includes("presentation?: 'dialog' | 'page'")) {
    throw new Error(`${name} top-level workspace must remain page-only`)
  }
}

console.log('Web workspace presentation checks passed')
