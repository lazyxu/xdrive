const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')
const localStorage = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopLocalStoragePage.tsx'), 'utf8')
const filesPage = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFilesPage.tsx'), 'utf8')

test('Desktop removes dead storage and cloud subpanel CSS after MUI migrations', () => {
  for (const selector of [
    '.storage-panel {',
    '.cache-card {',
    '.cache-actions {',
    '.storage-tree-header {',
    '.storage-tree {',
    '.storage-node',
    '.storage-row {',
    '.tree-toggle',
    '.storage-folder',
    '.storage-modes',
    '.cloud-subpanel',
    '.cloud-row-actions',
    '.cloud-compact-list',
    '.cloud-compact-row',
  ]) {
    assert.equal(styles.includes(selector), false, `dead Desktop CSS remains: ${selector}`)
  }

  assert.ok(styles.includes('.setting-link-row {'), 'settings link layout must remain')
  assert.ok(styles.includes('.cloud-explorer-panel {'), 'Desktop Files workspace shell must remain')
  assert.ok(localStorage.includes('<XDriveMetricGrid>'), 'Local Storage should stay on shared MUI metrics')
  assert.ok(localStorage.includes("borderColor: 'divider'"), 'Local Storage tree should stay on MUI surface styling')
  assert.ok(filesPage.includes('className="cloud-explorer-panel"'), 'Desktop Files should still use the active Explorer host class')
})
