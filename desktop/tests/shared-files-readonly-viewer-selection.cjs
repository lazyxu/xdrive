'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/FileExplorerReadOnlyViewerSelection.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const js = ts.transpileModule(source, {
  fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
}).outputText
const ref = { exports: {} }
new Function('exports', 'module', js)(ref.exports, ref)
const select = ref.exports.xDriveFileExplorerReadOnlyViewerSelection
const host = {}
const first = { id: 1, name: 'photo.jpg', revision: 3, size: 123 }
const second = { id: 2, name: 'movie.mp4', revision: 4, size: 456 }
const hidden = { id: 3, name: 'unsupported.bin', revision: 5, size: 20 }
const rows = [first, second, hidden]
const allowed = item => item.id !== 3
const base = {
  items: rows,
  isPreviewable: allowed,
  host,
  scopeKey: 'owner:root:10',
  rootRevision: 9,
  verified: true,
  preview: {
    host, scopeKey: 'owner:root:10', rootRevision: 9,
    item: first,
  },
}

test('same validated, readonly QuickLook wall keeps order, position and active source', () => {
  const result = select(base)
  assert.deepEqual(result.items, [first, second])
  assert.equal(result.index, 0)
  assert.strictEqual(result.item, first)
  assert.equal(result.positionLabel, '1 / 2 已加载')
})

test('session selection admits only existing supported file identities, once', () => {
  const result = select({
    ...base, preview: {
      ...base.preview, item: second, sessionIDs: [2, 2, '2', 999, 3, 1],
    },
  })
  assert.deepEqual(result.items, [second, first])
  assert.equal(result.index, 0)
  assert.strictEqual(result.item, second)
  assert.equal(result.positionLabel, '1 / 2 已选择')
})

test('replaced Owner, root revision or changed row cannot reuse an old Viewer ticket', () => {
  for (const altered of [
    { host: {} },
    { scopeKey: 'new-owner:root:10' },
    { rootRevision: 10 },
    { verified: false },
    { preview: { ...base.preview, item: { ...first, revision: 100 } } },
    { preview: { ...base.preview, item: { ...first, size: 125 } } },
  ]) {
    const result = select({ ...base, ...altered })
    assert.equal(result.item, null, JSON.stringify(Object.keys(altered)))
    assert.equal(result.index, -1)
    assert.equal(result.positionLabel, '')
  }
  assert.deepEqual(select({ ...base, verified: false }).items, [])
})

test('actual DSM Viewer reuses shared Owner/Node projection, not a second UI or editing tool', () => {
  const dsm = fs.readFileSync(path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
  assert.match(dsm, /xDriveFileExplorerReadOnlyViewerSelection\(\{/)
  assert.match(dsm, /<XDriveFileQuickLookDialog/)
  assert.match(dsm, /currentScopeVerified/)
  assert.match(dsm, /isCurrentOwner\(\)/)
  assert.match(dsm, /preview\.client/)
  assert.match(dsm, /rootRevision/)
  assert.match(dsm, /xDriveFindVerifiedOwnerSelection/)
  assert.doesNotMatch(source, /fetch\s*\(|window\.|ipcRenderer|upload|rename|delete|setFileAvailability/)
  const exports = fs.readFileSync(path.join(root, 'ui/shared/src/mui/index.tsx'), 'utf8')
  assert.match(exports, /export \* from '\.\/FileExplorerReadOnlyViewerSelection'/)
})
