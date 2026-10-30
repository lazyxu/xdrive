'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const filename = 'ui/shared/src/mui/OverviewFileProjection.ts'
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const compiled = ts.transpileModule(read(filename), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => { throw new Error('Runtime import is not allowed: ' + name) },
)
const project = mod.exports.xDriveOverviewProjectFileItem

test('Home keeps exact verified Node/revision/size and normalizes path without mutation', () => {
  const source = Object.freeze({
    node: Object.freeze({
      id: 41, name: 'photo.jpg', type: 'file', size: 902, revision: 7,
      updated_at: '2026-10-29T01:02:03Z', parent_id: 6,
    }),
    path: '///Photos/2026/photo.jpg',
    accessed_at: '2026-10-29T01:04:05Z',
  })
  assert.deepEqual(project(source), {
    id: 41, name: 'photo.jpg', kind: 'file', size: 902, revision: 7,
    updatedAt: '2026-10-29T01:02:03Z', path: 'Photos/2026/photo.jpg',
  })
  assert.equal(source.path, '///Photos/2026/photo.jpg')
})
test('directories remain directories and Web/Desktop invoke the same model', () => {
  const entry = { node: {
    id: 8, type: 'dir', name: 'Trips', size: 0, revision: 12,
    updated_at: '2026-10-29T01:00:00Z',
  }, path: '/Trips' }
  assert.equal(project(entry).kind, 'dir')
  assert.equal(project(entry).path, 'Trips')
  const web = read('web/src/WebOverviewPage.tsx')
  const desktop = read('ui/shared/src/mui/OverviewPage.tsx')
  assert.match(web, /const project = xDriveOverviewProjectFileItem/)
  assert.match(desktop, /const explorerItem = xDriveOverviewProjectFileItem/)
  assert.doesNotMatch(read(filename), /fetch\s*\(|ipcRenderer|window\.|localStorage/)
  assert.match(web, /xDriveCreateOverviewDisposableReadScope/)
  assert.match(desktop, /fileAvailabilitySupported/)
})
