import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

const workspace = readRepo('ui/shared/src/mui/WorkspaceSurface.tsx')
const sources = read('src/ExternalSources.tsx')
const storage = read('src/StorageStatsModal.tsx')

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
  "presentation = 'dialog'",
  "presentation?: 'dialog' | 'page'",
  "const surfaceOpen = presentation === 'page' || open",
  '<XDriveWorkspaceSurface',
  "title={scope === 'global' ? '全局存储统计' : '我的存储统计'}",
], 'StorageStats')

if (sources.includes('<Dialog open={open} onClose={onClose} maxWidth="md"')) {
  throw new Error('ExternalSources outer workspace is still hard-wired to Dialog')
}
if (storage.includes('<Dialog\n        open={open}\n        onClose={onClose}\n        maxWidth="lg"')) {
  throw new Error('StorageStats outer workspace is still hard-wired to Dialog')
}

console.log('Web workspace presentation checks passed')
