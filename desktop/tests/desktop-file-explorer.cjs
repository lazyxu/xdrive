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


test('Desktop FileExplorer occupies a stable full-height workspace', () => {
  assert.ok(styles.includes('.cloud-explorer-panel {'), 'Desktop Explorer workspace sizing rule is missing')
  assert.ok(styles.includes('height: calc(100vh - 170px);'), 'Desktop Explorer should fill the available window height')
  assert.ok(styles.includes('.cloud-explorer-panel > [data-xdrive-file-explorer]'), 'shared Explorer must flex inside the Desktop workspace')
})
