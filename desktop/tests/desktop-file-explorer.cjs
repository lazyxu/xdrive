const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const cloudPage = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopCloudPage.tsx'), 'utf8')
const storagePage = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopStoragePage.tsx'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const projection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const navigation = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts'), 'utf8')
const styles = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop files workspace consumes the shared FileExplorer', () => {
  assert.ok(cloudPage.includes("import DesktopFileExplorer from './DesktopFileExplorer'"), 'Desktop Cloud page must import the Explorer adapter')
  assert.ok(cloudPage.includes('<DesktopFileExplorer'), 'Desktop Cloud page did not render the Explorer adapter')
  assert.ok(explorer.includes('<XDriveFileExplorer'), 'Desktop adapter does not consume the shared FileExplorer')
  assert.equal(app.includes('className="cloud-search-row"'), false, 'legacy Desktop cloud search row remains')
  assert.equal(app.includes('className="cloud-list"'), false, 'legacy Desktop cloud list remains')
  assert.equal(app.includes('className="cloud-list-header"'), false, 'legacy Desktop cloud list header remains')
})

test('Desktop FileExplorer wires real cloud mutations and native transfers', () => {
  for (const token of [
    'cloudCreateDirectory(current.id, name)',
    'cloudUploadFiles(current.id)',
    'cloudRename(renameNode.id, renameNode.revision, name)',
    'cloudDownload(node.id, node.name)',
    'getItemMenuItems={getItemMenuItems}',
    'backgroundMenuItems={backgroundMenuItems}',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer operation: ${token}`)
  }
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudDelete(node.id, node.revision)'), 'Desktop delete action is not wired to real cloud delete')
  assert.ok(app.includes("'已移到回收站。'"), 'Desktop delete action should preserve recycle-bin semantics')
})

test('Desktop FileExplorer provides system-style navigation, search, and persistent view mode', () => {
  for (const token of [
    'useXDriveFileExplorerNavigation({',
    'canGoBack={canGoBack}',
    'canGoForward={canGoForward}',
    'canGoUp={canGoUp}',
    'onPathSubmit',
    'onCrumbClick',
    'cloudSearch(normalized)',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer navigation/search contract: ${token}`)
  }
  assert.ok(explorer.includes("replace(/\\\\/g, '/')"), 'typed paths should accept Windows separators')
  assert.ok(explorer.includes('viewModeStorageKey: DESKTOP_FILE_VIEW_KEY'), 'Desktop Explorer should pass its view-mode storage key to the shared controller')
  assert.ok(navigation.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)'), 'shared Explorer controller should persist Details/Grid mode')
})

test('Desktop cloud capacity and CAS intelligence live on Storage, not Files', () => {
  assert.equal(cloudPage.includes('CAS 存储情报'), false, 'CAS intelligence must not occupy the Files workspace')
  assert.equal(cloudPage.includes('className="cloud-quota-grid"'), false, 'quota metric grid must not occupy the Files workspace')
  assert.ok(storagePage.includes('云端容量'), 'Storage workspace is missing cloud capacity metrics')
  assert.ok(storagePage.includes('CAS 存储情报'), 'Storage workspace is missing CAS intelligence')
})

test('Desktop Storage refresh owns cloud quota and storage intelligence refresh', () => {
  assert.ok(app.includes("window.xdriveDesktop.agent.cloudQuota()"), 'Storage refresh should retrieve cloud quota')
  assert.ok(app.includes("storageStatsSupported ? window.xdriveDesktop.agent.cloudStorageStats()"), 'Storage refresh should retrieve CAS storage intelligence when supported')
})

test('Desktop Files home load does not fetch CAS storage intelligence', () => {
  const start = app.indexOf('const loadCloudHome = async () => {')
  const end = app.indexOf('const openCloudTrash = () =>', start)
  assert.ok(start >= 0 && end > start, 'loadCloudHome boundaries are missing')
  const body = app.slice(start, end)
  assert.ok(body.includes('cloudRoot()'), 'Files home should still load the cloud root')
  assert.ok(body.includes('cloudQuota()'), 'Files home should still load quota for sidebar/over-quota status')
  assert.equal(body.includes('cloudStorageStats()'), false, 'Files home must not fetch storage intelligence')
})


test('Desktop Files is a full-bleed Explorer workspace without duplicate page chrome', () => {
  assert.ok(
    app.includes("className={view === 'cloud' ? 'content content-files-workspace' : 'content'}"),
    'Desktop Files should switch the main content into full-workspace mode',
  )
  assert.equal(
    app.includes('<XDrivePageHeader'),
    false,
    'Desktop App should not own a generic page header; extracted pages own shared workspace chrome',
  )
  assert.ok(app.includes('<DesktopCloudPage'), 'Desktop Files should render through the extracted full-bleed cloud page')

  const workspaceStart = styles.indexOf('.content-files-workspace {')
  const storageStart = styles.indexOf('.storage-panel > .cloud-subpanel', workspaceStart)
  assert.ok(workspaceStart >= 0 && storageStart > workspaceStart, 'Desktop Files workspace CSS boundaries are missing')
  const workspaceStyles = styles.slice(workspaceStart, storageStart)

  for (const token of [
    'padding: 0;',
    'overflow: hidden;',
    '.cloud-explorer-panel {',
    'flex: 1;',
    'min-height: 0;',
    'margin-top: 0;',
    'border: 0;',
    'border-radius: 0;',
    '.cloud-explorer-panel > [data-xdrive-file-explorer]',
  ]) {
    assert.ok(workspaceStyles.includes(token), `missing full-workspace Explorer rule: ${token}`)
  }
  assert.equal(workspaceStyles.includes('calc(100vh - 170px)'), false, 'Desktop Files should not use a hard-coded viewport subtraction')
  assert.ok(cloudPage.includes('<XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>'), 'over-quota warning should remain an inset workspace strip')
})

test('Desktop FileExplorer queues copy/cut/paste through persistent Agent file operations', () => {
  assert.ok(explorer.includes("type DesktopExplorerClipboard = { mode: 'copy' | 'cut'; nodes: AgentCloudNode[] }"), 'Desktop clipboard state is missing')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop paste must use the persistent file-operation bridge')
  assert.ok(explorer.includes("clipboard.mode === 'cut' ? 'move' : 'copy'"), 'Desktop paste must preserve copy/cut semantics')
  assert.ok(explorer.includes('onOperationQueued(result.data)'), 'Desktop Explorer must surface the newly queued operation immediately')
  assert.ok(explorer.includes('onCopyItems={(selected) => {'), 'Desktop shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={(selected) => {'), 'Desktop shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={() => { void pasteClipboard() }}'), 'Desktop shared paste adapter is missing')
})

test('Desktop FileExplorer supports bulk download and delete', () => {
  assert.ok(explorer.includes('const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {'), 'Desktop bulk download helper is missing')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudDownloadFiles('), 'Desktop bulk download bridge is missing')
  assert.ok(explorer.includes('onDownloadItems={(selected) => { void downloadSelected(selected) }}'), 'Desktop shared bulk download adapter is missing')
  assert.ok(explorer.includes('onDeleteMany(nodes)'), 'Desktop shared bulk delete adapter is missing')
  assert.ok(app.includes('const removeCloudNodes = (nodes: AgentCloudNode[]) => {'), 'Desktop bulk delete confirmation flow is missing')
  assert.ok(app.includes("window.xdriveDesktop.agent.cloudCreateFileOperation("), 'Desktop bulk delete must enqueue one persistent file operation')
  assert.ok(app.includes("'delete',"), 'Desktop bulk delete must preserve delete semantics')
  assert.ok(app.includes('rememberCloudFileOperation(result.data)'), 'Desktop bulk delete must seed task state immediately')
  assert.ok(app.includes('nodes.map((node) => ({ id: node.id, revision: node.revision }))'), 'Desktop bulk delete must preserve revision refs')
})

test('Desktop FileExplorer supports internal and external drag and drop', () => {
  assert.ok(explorer.includes('const dropItemsToFolder = async ('), 'Desktop internal drag/drop helper is missing')
  assert.ok(explorer.includes("operation === 'copy'"), 'Desktop drag/drop operation selection is missing')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation(operation, refs, targetNode.id)'), 'Desktop internal drag must enqueue copy/move as one persistent operation')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)'), 'Desktop external drop upload bridge is missing')
  assert.ok(explorer.includes('onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}'), 'Desktop external drop is not wired to shared FileExplorer')
})

test('Desktop uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'"), 'Desktop details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}'), 'Desktop details layout key is not passed to shared FileExplorer')
})

test('Desktop FileExplorer supplies preview/properties metadata through existing protected thumbnail APIs', () => {
  assert.ok(projection.includes("path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/')"), 'shared Explorer projection path metadata is missing')
  assert.ok(projection.includes('revision: node.revision'), 'shared Explorer projection revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Desktop inspector should reuse the protected media thumbnail bridge')
  assert.equal(explorer.includes('localPath:'), false, 'Desktop preview/properties must not expose managed local paths')
})

test('Desktop Files no longer inherits the legacy dashboard panel or dead pre-shared Explorer CSS', () => {
  assert.ok(cloudPage.includes('<section className="cloud-explorer-panel">'), 'Desktop Files should use only its workspace container')
  assert.equal(cloudPage.includes('panel cloud-panel cloud-explorer-panel'), false, 'Desktop Files must not inherit generic dashboard panel chrome')

  for (const selector of [
    '.cloud-panel {',
    '.cloud-note {',
    '.cloud-heading-actions {',
    '.cloud-search-row {',
    '.cloud-search-input {',
    '.cloud-breadcrumbs {',
    '.cloud-list {',
    '.cloud-list-header',
    '.cloud-row {',
    '.cloud-name {',
  ]) {
    assert.equal(styles.includes(selector), false, `dead legacy Desktop Explorer CSS remains: ${selector}`)
  }

  assert.ok(styles.includes('.cloud-row-actions {'), 'shared dialog/list row actions are still required')
  assert.ok(styles.includes('.cloud-compact-row {'), 'trash/version compact rows are still required')
})

test('Desktop Files no longer inherits the legacy dashboard panel or dead pre-shared Explorer CSS', () => {
  assert.ok(cloudPage.includes('<section className="cloud-explorer-panel">'), 'Desktop Files should use only its workspace container')
  assert.equal(cloudPage.includes('panel cloud-panel cloud-explorer-panel'), false, 'Desktop Files must not inherit generic dashboard panel chrome')

  for (const selector of [
    '.cloud-panel {',
    '.cloud-note {',
    '.cloud-heading-actions {',
    '.cloud-search-row {',
    '.cloud-search-input {',
    '.cloud-breadcrumbs {',
    '.cloud-list {',
    '.cloud-list-header',
    '.cloud-row {',
    '.cloud-name {',
  ]) {
    assert.equal(styles.includes(selector), false, `dead legacy Desktop Explorer CSS remains: ${selector}`)
  }

  assert.ok(styles.includes('.cloud-row-actions {'), 'shared dialog/list row actions are still required')
  assert.ok(styles.includes('.cloud-compact-row {'), 'trash/version compact rows are still required')
})

test('Desktop FileExplorer uses cursor-paged server sorting for cloud directories', () => {
  assert.ok(app.includes('const DESKTOP_FILE_PAGE_SIZE = 200'), 'Desktop page-size contract is missing')
  assert.ok(app.includes('const loadMoreCloudDirectory = async (id: number, sort: XDriveFileExplorerSort) => {'), 'Desktop incremental directory loader is missing')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudChildrenPage(id, {'), 'Desktop directory browsing should use the paged Agent API')
  assert.ok(app.includes('cursor: result.data.next_cursor ??'), 'Desktop directory cursor state is missing')
  assert.ok(explorer.includes('externallySorted={!searchResults}'), 'Desktop directory pages should preserve server ordering')
  assert.ok(explorer.includes('onSortChange={changeSort}'), 'Desktop sort changes should reload server-sorted pages')
  assert.ok(explorer.includes('onLoadMore(current.id, sort)'), 'Desktop Explorer must request more items near the scroll boundary')
})

test('Desktop multi-select mutations use persistent operations instead of renderer-side batch execution', () => {
  assert.ok(app.includes("window.xdriveDesktop.agent.cloudCreateFileOperation("), 'Desktop bulk delete must queue one operation')
  assert.ok(explorer.includes("window.xdriveDesktop.agent.cloudCreateFileOperation("), 'Desktop paste/drop must queue one operation')
  assert.ok(explorer.includes("clipboard.mode === 'cut' ? 'move' : 'copy'"), 'Desktop paste must preserve copy/move operation type')
  assert.ok(explorer.includes('cloudCreateFileOperation(operation, refs, targetNode.id)'), 'Desktop drag/drop must preserve copy/move operation type')
  assert.equal(app.includes('for (const node of nodes) {\n            const result = await window.xdriveDesktop.agent.cloudDelete'), false, 'Desktop bulk delete must not regress to N requests')
})
