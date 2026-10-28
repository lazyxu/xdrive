'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerOwnerSourceOptions.ts'), 'utf8')

test('Web FileExplorer routes Owner/source errors through the real common lifecycle', () => {
  assert.match(web, /useXDriveFileExplorerOwnerSourceOptions\(\{/)
  assert.match(web, /host: api,\s*ownerKey: navigationSessionStorageKey \?\? '',\s*read: loadSourceOptions,\s*onError,/)
  assert.match(web, /await api\.sources\(\)/)
  assert.match(shared, /if \(!active \|\| !isCurrent\(\)\) return/)
  assert.match(shared, /onErrorRef\.current\?\.\(error\)/)
  assert.match(shared, /setSnapshot\(\{ host, ownerKey, status: 'error', options: EMPTY_SOURCE_OPTIONS \}\)/)
  assert.doesNotMatch(web, /setSearchSourceOptions\(/)
})
