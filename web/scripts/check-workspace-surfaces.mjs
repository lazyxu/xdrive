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
  '<Dialog',
  '<XDriveDialogTitle',
  '<XDriveDialogContent',
], 'XDriveWorkspaceSurface')

requireText(sources, [
  'XDriveWorkspaceSurface',
  "presentation = 'dialog'",
  "presentation?: 'dialog' | 'page'",
  "const surfaceOpen = presentation === 'page' || open",
  '<XDriveWorkspaceSurface',
  'title="外部来源"',
], 'ExternalSources')

requireText(storage, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  "title={scope === 'global' ? '全局存储统计' : '我的存储统计'}",
], 'StorageStats')

requireText(adminUsers, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface presentation="page"',
  'title="用户管理"',
], 'AdminUsers')

requireText(adminAudit, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface presentation="page"',
  'title="审计日志"',
], 'AdminAudit')

if (sources.includes('<Dialog open={open} onClose={onClose} maxWidth="md"')) {
  throw new Error('ExternalSources outer workspace is still hard-wired to Dialog')
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
