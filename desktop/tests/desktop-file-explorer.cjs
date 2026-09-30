const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop files workspace consumes the shared FileExplorer', () => {
  assert.ok(app.includes("import DesktopFileExplorer from './DesktopFileExplorer'"), 'Desktop Explorer adapter import is missing')
  assert.ok(app.includes('<DesktopFileExplorer'), 'Desktop files workspace did not migrate to the Explorer adapter')
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
    'canGoBack={historyIndex > 0}',
    'canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}',
    'canGoUp={crumbs.length > 1}',
    'onPathSubmit',
    'onCrumbClick',
    'cloudSearch(normalized)',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer navigation/search contract: ${token}`)
  }
  assert.ok(explorer.includes("replace(/\\\\/g, '/')"), 'typed paths should accept Windows separators')
  assert.ok(explorer.includes('localStorage.setItem(DESKTOP_FILE_VIEW_KEY, viewMode)'), 'Desktop Explorer should remember Details/Grid mode')
})

test('Desktop cloud capacity and CAS intelligence live on Storage, not Files', () => {
  const cloudStart = app.indexOf("{view === 'cloud' && (")
  const transfersStart = app.indexOf("{view === 'transfers' && (", cloudStart)
  const storageStart = app.indexOf("{view === 'files' && (")
  const conflictsStart = app.indexOf("{view === 'conflicts' && (", storageStart)
  assert.ok(cloudStart >= 0 && transfersStart > cloudStart, 'Desktop Files section boundaries are missing')
  assert.ok(storageStart >= 0 && conflictsStart > storageStart, 'Desktop Storage section boundaries are missing')

  const cloudSection = app.slice(cloudStart, transfersStart)
  const storageSection = app.slice(storageStart, conflictsStart)
  assert.equal(cloudSection.includes('CAS 存储情报'), false, 'CAS intelligence must not occupy the Files workspace')
  assert.equal(cloudSection.includes('className="cloud-quota-grid"'), false, 'quota metric grid must not occupy the Files workspace')
  assert.ok(storageSection.includes('云端容量'), 'Storage workspace is missing cloud capacity metrics')
  assert.ok(storageSection.includes('CAS 存储情报'), 'Storage workspace is missing CAS intelligence')
})

test('Desktop Storage refresh owns cloud quota and storage intelligence refresh', () => {
  assert.ok(app.includes("window.xdriveDesktop.agent.cloudQuota()"), 'Storage refresh should retrieve cloud quota')
  assert.ok(app.includes("storageStatsSupported ? window.xdriveDesktop.agent.cloudStorageStats()"), 'Storage refresh should retrieve CAS storage intelligence when supported')
})

test('Desktop Files home load does not fetch CAS storage intelligence', () => {
  const start = app.indexOf('const loadCloudHome = async () => {')
  const end = app.indexOf('const loadCloudTrash = async () => {', start)
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
  assert.ok(
    app.includes("{view !== 'cloud' ? <XDrivePageHeader title={viewLabel(view)} eyebrow=\"xDrive\" size=\"large\" /> : null}"),
    'Desktop Files should suppress the generic page header while other views retain it',
  )

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
  assert.ok(app.includes('<XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>'), 'over-quota warning should remain an inset workspace strip')
})

test('Desktop FileExplorer wires copy/cut/paste through Agent copy and move primitives', () => {
  assert.ok(explorer.includes("type DesktopExplorerClipboard = { mode: 'copy' | 'cut'; nodes: AgentCloudNode[] }"), 'Desktop clipboard state is missing')
  assert.ok(explorer.includes('await window.xdriveDesktop.agent.cloudCopy(node.id, current.id)'), 'Desktop copy paste must use cloudCopy')
  assert.ok(explorer.includes('await window.xdriveDesktop.agent.cloudMove(node.id, node.revision, current.id)'), 'Desktop cut paste must use revision-safe cloudMove')
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
  assert.ok(app.includes('for (const node of nodes) {'), 'Desktop bulk delete should process every selected node')
})

test('Desktop FileExplorer supports internal and external drag and drop', () => {
  assert.ok(explorer.includes('const dropItemsToFolder = async ('), 'Desktop internal drag/drop helper is missing')
  assert.ok(explorer.includes("operation === 'copy'"), 'Desktop drag/drop operation selection is missing')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCopy(node.id, targetNode.id)'), 'Desktop Ctrl/Cmd drag should copy')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudMove(node.id, node.revision, targetNode.id)'), 'Desktop normal drag should move')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)'), 'Desktop external drop upload bridge is missing')
  assert.ok(explorer.includes('onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}'), 'Desktop external drop is not wired to shared FileExplorer')
})

test('Desktop uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'"), 'Desktop details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}'), 'Desktop details layout key is not passed to shared FileExplorer')
})
