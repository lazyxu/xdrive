'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Desktop and Web own no separate saved-search mutation dialog implementation', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const shared = read('ui/shared/src/mui/FileExplorerSavedSearchDialogs.tsx')
  const barrel = read('ui/shared/src/mui/index.tsx')

  for (const source of [web, desktop]) {
    assert.match(source, /<XDriveFileExplorerSavedSearchDialogs\b/)
    assert.match(source, /lifecycleKeyRef=\{organizationLifecycleKeyRef\}/)
    assert.match(source, /createSavedSearch=\{organization\.createSavedSearch\}/)
    assert.match(source, /updateSavedSearch=\{organization\.updateSavedSearch\}/)
    assert.match(source, /availabilityFilterActive=\{Boolean\(searchFilters\.availability\)\}/)
    assert.doesNotMatch(source, /open=\{saveSearchOpen\}\s+mode="saved-search"/)
    assert.match(source, /<XDriveFileExplorerTrashDeleteDialog\b/)
  }
  assert.match(barrel, /export \* from '\.\/FileExplorerSavedSearchDialogs'/)
  assert.match(shared, /await createSavedSearch\(/)
  assert.match(shared, /await updateSavedSearch\(/)
  assert.equal((shared.match(/lifecycleKeyRef\.current !== lifecycleKey/g) || []).length, 2)
  assert.match(shared, /availabilityFilterActive \? 'warning' : 'good'/)
})

test('saved-search presentation does not import platform I/O or hide stale Owner feedback', () => {
  const shared = read('ui/shared/src/mui/FileExplorerSavedSearchDialogs.tsx')
  assert.doesNotMatch(shared, /window\.|xdriveDesktop|fetch\s*\(|localStorage|sessionStorage|cloudCreateFileSavedSearch/)
  assert.match(shared, /renameSearch\?\.name/)
  assert.match(shared, /renameSearch\.query/)
  assert.match(shared, /renameSearch\.filters/)
  assert.match(shared, /onError=\{onError\}/)
})
