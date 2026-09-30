import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

const workspace = readRepo('ui/shared/src/mui/WorkspaceSurface.tsx')
const workspaceShell = readRepo('ui/shared/src/mui/WorkspaceShell.tsx')
const fileExplorer = readRepo('ui/shared/src/mui/FileExplorer.tsx')
const desktopFileExplorer = readRepo('desktop/src/renderer/DesktopFileExplorer.tsx')
const desktopStyles = readRepo('desktop/src/renderer/styles.css')
const app = read('src/App.tsx')
const webFileExplorer = read('src/WebFileExplorer.tsx')
const styles = read('src/styles.css')
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

requireText(workspaceShell, [
  'export function XDriveWorkspaceShell',
  'XDRIVE_SIDEBAR_WIDTH',
  'XDRIVE_SIDEBAR_COMPACT_WIDTH',
  "'@media (max-width: 960px)'",
], 'XDriveWorkspaceShell')

requireText(fileExplorer, [
  "export type XDriveFileExplorerPresentation = 'card' | 'workspace'",
  "presentation = 'card'",
  'presentation?: XDriveFileExplorerPresentation',
  "variant={presentation === 'workspace' ? 'elevation' : 'outlined'}",
  "square={presentation === 'workspace'}",
  "border: presentation === 'workspace' ? 0 : undefined",
  "borderRadius: presentation === 'workspace' ? 0 : 2",
], 'Shared FileExplorer workspace presentation')

requireText(fileExplorer, [
  'export function XDriveFileExplorerCommandButton',
  'variant="text"',
  'color="inherit"',
  "color: 'text.primary'",
  '<XDriveFileExplorerCommandButton startIcon={<CreateNewFolderRoundedIcon />} onClick={onCreateFolder}>',
  '<XDriveFileExplorerCommandButton startIcon={<UploadRoundedIcon />} onClick={onUpload}>',
  'startIcon={<SortRoundedIcon />}',
], 'Shared FileExplorer command chrome')

if ((fileExplorer.match(/<XDriveFileExplorerCommandButton/g) || []).length < 3) {
  throw new Error('Shared FileExplorer must use neutral command chrome for create, upload and sort')
}

requireText(fileExplorer, [
  "const xDriveWindowsFolderYellow = '#ffcb3d'",
  'color: xDriveWindowsFolderYellow',
], 'Shared FileExplorer Windows folder color')

if (/fileKind === 'folder'.*warning\.main/.test(fileExplorer)) {
  throw new Error('Shared FileExplorer folder icon must not fall back to the MUI warning palette')
}

requireText(webFileExplorer, [
  'presentation="workspace"',
  'XDriveFileExplorerCommandButton',
  '<XDriveFileExplorerCommandButton startIcon={<RestoreFromTrashRoundedIcon />} onClick={onOpenTrash}>',
], 'Web FileExplorer workspace presentation')

requireText(desktopFileExplorer, [
  'presentation="workspace"',
  'XDriveFileExplorerCommandButton',
  '<XDriveFileExplorerCommandButton startIcon={<RestoreFromTrashRoundedIcon />} onClick={onOpenTrash}>',
], 'Desktop FileExplorer workspace presentation')

if (webFileExplorer.includes('<XDriveActionButton compact startIcon={<RestoreFromTrashRoundedIcon />}') || desktopFileExplorer.includes('<XDriveActionButton compact onClick={onOpenTrash}>')) {
  throw new Error('FileExplorer command bar extensions must use shared neutral command chrome')
}

requireText(app, [
  'file-manager-shell',
  'XDriveWorkspaceShell',
  'className="web-workspace-shell"',
  "sx={{ flex: { md: 1 }, minHeight: { md: 0 } }}",
  "className={appView === 'files' ? 'content-wrap files-workspace' : 'content-wrap'}",
  'className="files-workspace-surface"',
  "height: { xs: 560, md: '100%' }",
  "overflowY: { md: appView === 'files' ? 'hidden' : 'auto' }",
], 'Web files workspace')

if (app.includes('<XDriveWorkspaceSurface presentation="page" title="文件">')) {
  throw new Error('Web files workspace must not render a duplicate page header')
}

requireText(styles, [
  '@media (min-width: 900px)',
  '.file-manager-shell',
  '.content-wrap.files-workspace',
  'padding: 0',
  'overflow: hidden',
], 'Web files workspace styles')

if (styles.includes('.files-workspace-surface [data-xdrive-file-explorer]')) {
  throw new Error('Web must not override shared FileExplorer workspace chrome')
}
if (/\.content-wrap\.files-workspace\s*\{[^}]*background\s*:\s*#fff\b/.test(styles)) {
  throw new Error('Web files workspace must not hard-code a light-only background')
}
if (/\.cloud-explorer-panel > \[data-xdrive-file-explorer\]\s*\{[^}]*\b(border|border-radius)\s*:/.test(desktopStyles)) {
  throw new Error('Desktop must not override shared FileExplorer workspace chrome')
}

requireText(sources, [
  'XDriveWorkspaceSurface',
  '<XDriveWorkspaceSurface',
  'presentation="page"',
  'title="同步文件夹"',
  'subtitle="统一管理同步文件夹、凭据、调度方式与运行状态。"',
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

for (const legacyClass of ['.file-card', '.file-toolbar', '.upload-progress', '.folder-icon']) {
  if (styles.includes(legacyClass)) {
    throw new Error(`Web files workspace must not retain legacy dashboard file chrome: ${legacyClass}`)
  }
}

if (app.includes("calc(100vh - 48px)")) {
  throw new Error('Web workspace must not duplicate AppBar viewport subtraction math')
}
