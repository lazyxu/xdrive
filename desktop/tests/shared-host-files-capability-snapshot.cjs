'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'ui/shared/src/mui/FileExplorerHostCapabilities.ts'
const source = read(file)
const js = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleRef = { exports: {} }
new Function('exports', 'module', js)(moduleRef.exports, moduleRef)
const capabilities = moduleRef.exports.xDriveFileExplorerHostCapabilities

const known = [
  'upload-conflict-preflight', 'upload-conflict-policy', 'archive-download',
  'folder-download-tree', 'file-text-preview', 'file-preview-stream',
  'media-item-properties', 'node-location', 'cloud-child-position',
  'transfer-lifecycle', 'transfer-lifecycle-child-batch',
  'transfer-upload-group-cancel', 'local-disk-space',
]

test('all native Files features fail closed without a verified Agent handshake', () => {
  const baseline = capabilities(undefined)
  for (const value of Object.values(baseline)) assert.equal(value, false)
  assert.deepEqual(capabilities(null), baseline)
  assert.deepEqual(capabilities([]), baseline)
  assert.deepEqual(capabilities(['unknown', 'synology-admin', 'desktop']), baseline)
})

test('partial native upload handshake cannot enable folder writes', () => {
  for (const only of ['upload-conflict-preflight', 'upload-conflict-policy']) {
    assert.equal(capabilities([only]).uploadConflictSupported, false)
  }
  const both = capabilities(['upload-conflict-policy', 'upload-conflict-preflight'])
  assert.equal(both.uploadConflictSupported, true)
  assert.equal(both.folderTreeDownloadSupported, false)
  assert.equal(both.archiveDownloadSupported, false)
})

test('Host capability set maps exactly to the full Files feature contract', () => {
  const full = capabilities(known)
  const expected = [
    'uploadConflictSupported', 'archiveDownloadSupported',
    'folderTreeDownloadSupported', 'textPreviewSupported',
    'previewStreamSupported', 'mediaPropertiesSupported',
    'nodeLocationSupported', 'childPositionSupported',
    'transferLifecycleSupported', 'transferLifecycleBatchSupported',
    'transferGroupUploadCancelSupported', 'localDiskSpaceSupported',
  ]
  assert.deepEqual(Object.keys(full), expected)
  assert.ok(Object.values(full).every(value => value === true))
  assert.deepEqual(capabilities([...known, 'arbitrary-RPC']), full)
})

test('Desktop Host injects the pure feature snapshot into both Files and Overview', () => {
  const app = read('desktop/src/renderer/App.tsx')
  assert.match(app, /const filesHostCapabilities = xDriveFileExplorerHostCapabilities\(agent\.hello\?\.capabilities\)/)
  for (const name of [
    'uploadConflictSupported', 'archiveDownloadSupported',
    'folderTreeDownloadSupported', 'textPreviewSupported',
    'previewStreamSupported', 'mediaPropertiesSupported',
    'nodeLocationSupported', 'childPositionSupported',
    'transferLifecycleSupported', 'transferLifecycleBatchSupported',
    'transferGroupUploadCancelSupported',
  ]) assert.match(app, new RegExp(name + ': filesHostCapabilities\\.' + name))
  assert.match(app, /localDiskSpaceSupported: filesHostCapabilities\.localDiskSpaceSupported/)
  assert.match(app, /folderUploadSupported: filesHostCapabilities\.uploadConflictSupported/)
  const dsm = read('web/src/synologyHost.ts')
  assert.match(dsm, /unavailableActions: \{/)
  assert.doesNotMatch(dsm, /xDriveFileExplorerHostCapabilities/)
  assert.doesNotMatch(source, /window\.|fetch\s*\(|ipcRenderer|localStorage|\bProxy\b/)
  assert.match(read('ui/shared/src/mui/index.tsx'), /export \* from '\.\/FileExplorerHostCapabilities'/)
})
