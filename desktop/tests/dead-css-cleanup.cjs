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

  assert.equal(styles.includes('.setting-link-row {'), false, 'settings link layout should stay in MUI')
  assert.equal(styles.includes('.cloud-explorer-panel {'), false, 'Desktop Files host layout should stay in MUI')
  assert.ok(localStorage.includes('<XDriveMetricGrid>'), 'Local Storage should stay on shared MUI metrics')
  assert.ok(localStorage.includes("borderColor: 'divider'"), 'Local Storage tree should stay on MUI surface styling')
  assert.ok(filesPage.includes('component="section"'), 'Desktop Files should preserve section semantics through MUI')
  assert.ok(filesPage.includes("'& > [data-xdrive-file-explorer]'"), 'Desktop Files MUI host must keep the Explorer flex contract')
})
