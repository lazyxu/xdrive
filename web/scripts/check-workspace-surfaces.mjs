import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

const workspace = readRepo('ui/shared/src/mui/WorkspaceSurface.tsx')
const workspaceShell = readRepo('ui/shared/src/mui/WorkspaceShell.tsx')
const workspaceContent = readRepo('ui/shared/src/mui/WorkspaceContent.tsx')
const workspaceSidebar = readRepo('ui/shared/src/mui/WorkspaceSidebar.tsx')
const fileExplorer = readRepo('ui/shared/src/mui/FileExplorer.tsx')
const fileExplorerActions = readRepo('ui/shared/src/mui/FileExplorerActions.tsx')
const fileExplorerNavigationPane = readRepo('ui/shared/src/mui/FileExplorerNavigationPane.tsx')
const desktopFileExplorer = readRepo('desktop/src/renderer/DesktopFileExplorer.tsx')
const desktopStyles = readRepo('desktop/src/renderer/styles.css')
const app = read('src/App.tsx')
const webFileExplorer = read('src/WebFileExplorer.tsx')
const styles = read('src/styles.css')
const sources = [
  'SourceManager.tsx',
  'SourceManagerDialogs.tsx',
  'SourceManagerDetailsDialog.tsx',
  'SourceManagerCreateDialog.tsx',
  'SourceManagerSettingsDialog.tsx',
  'SourceManagerListPage.tsx',
].map((name) => readRepo(`ui/shared/src/mui/${name}`)).join('\n')
const storage = read('src/StorageStatsPanel.tsx')
const cloudStorage = readRepo('ui/shared/src/mui/CloudStoragePage.tsx')
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

requireText(workspaceContent, [
  "export type XDriveWorkspaceContentPresentation = 'page' | 'files'",
  'export function XDriveWorkspaceContent',
  "const files = presentation === 'files'",
  "p: '34px 40px 48px'",
  "'@media (max-width: 960px)'",
  "'@media (min-width: 900px)'",
  "overflow: 'hidden'",
], 'XDriveWorkspaceContent')

requireText(workspaceSidebar, [
  'export function XDriveWorkspaceSidebar',
  '<XDriveSidebarSurface',
  '<XDriveSidebarNavList',
  '<XDriveCoreWorkspaceNavItems',
  '<XDriveSidebarSection',
  '<XDriveSidebarStorageSummary',
], 'XDriveWorkspaceSidebar')

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
  'startIcon={<CreateNewFolderRoundedIcon />}',
  "fileExplorerShortcutTitle('新建文件夹', 'new-folder', keyboardProfile)",
  'onClick={onCreateFolder}',
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

requireText(fileExplorerActions, [
  'xDriveFileExplorerBackgroundMenuItems',
  'xDriveFileExplorerStandardItemMenuItems',
  '<XDriveFileExplorerCommandButton',
], 'Shared FileExplorer action presentation')

requireText(webFileExplorer, [
  'presentation="workspace"',
  'onNavigateTrash={onOpenTrash}',
  'trashActive ? trash.items : explorerItems',
  'xDriveFileExplorerBackgroundMenuItems({',
  'xDriveFileExplorerStandardItemMenuItems({',
], 'Web FileExplorer workspace presentation')

requireText(desktopFileExplorer, [
  'presentation="workspace"',
  'onNavigateTrash={onOpenTrash}',
  'trashActive ? trash.items : explorerItems',
  'xDriveFileExplorerBackgroundMenuItems({',
  'xDriveFileExplorerStandardItemMenuItems({',
], 'Desktop FileExplorer workspace presentation')

requireText(fileExplorerNavigationPane, [
  'aria-label="回收站"',
  'selected={trashActive}',
  'onNavigateTrash',
], 'Shared FileExplorer Trash navigation')

if (webFileExplorer.includes('XDriveFileExplorerTrashCommandButton') || desktopFileExplorer.includes('XDriveFileExplorerTrashCommandButton')) {
  throw new Error('Trash must be a FileExplorer navigation workspace, not a command-bar dialog action')
}

requireText(app, [
  'XDriveWorkspaceShell',
  'XDriveWorkspaceSidebar',
  'XDriveWorkspaceContent',
  'className="web-workspace-shell"',
  "sx={{ flex: { md: 1 }, minHeight: { md: 0 } }}",
  'presentation={xDriveWorkspacePresentation(appView)}',
  "height: { md: '100vh' }",
  "overflow: { md: 'hidden' }",
  "height: { xs: 560, md: '100%' }",
], 'Web files workspace')

if (app.includes('<XDriveWorkspaceSurface presentation="page" title="文件">')) {
  throw new Error('Web files workspace must not render a duplicate page header')
}
if (app.includes('LocalStoragePage') || app.includes('localStorageSource')) {
  throw new Error('Web must not expose Desktop-only Local Storage')
}
for (const primitive of ['<XDriveSidebarSurface', '<XDriveSidebarNavList', '<XDriveCoreWorkspaceNavItems', '<XDriveSidebarSection', '<XDriveSidebarStorageSummary']) {
  if (app.includes(primitive)) throw new Error(`Web must not assemble sidebar primitive directly: ${primitive}`)
}

for (const legacy of ['.app-shell', '.topbar', '.file-manager-shell', '.files-workspace-surface']) {
  if (styles.includes(legacy)) throw new Error(`Web shell layout must live in MUI: ${legacy}`)
}

if (styles.includes('.content-wrap')) {
  throw new Error('Web workspace content layout must live in shared MUI')
}

if (styles.includes('.files-workspace-surface [data-xdrive-file-explorer]')) {
  throw new Error('Web must not override shared FileExplorer workspace chrome')
}
if (/background\s*:\s*#fff\b/.test(workspaceContent)) {
  throw new Error('Shared Files workspace content must not hard-code a light-only background')
}
if (/\.cloud-explorer-panel > \[data-xdrive-file-explorer\]\s*\{[^}]*\b(border|border-radius)\s*:/.test(desktopStyles)) {
  throw new Error('Desktop must not override shared FileExplorer workspace chrome')
}

requireText(app, [
  '<XDriveSourceManager',
  'adapter={sourceManagerAdapter}',
  'createXDriveSourceManagerAdapter(api)',
], 'Web Source manager mount')

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

requireText(cloudStorage, [
  'export function XDriveCloudStoragePage',
  'XDriveWorkspaceSurface',
  'presentation="page"',
  'title="云端存储"',
  'title="范围：当前账号"',
  'title="账号容量"',
  'title="文件大小分布"',
], 'Shared CloudStorage')

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
