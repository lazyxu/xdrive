'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const cases = [
  ['ui/shared/src/mui/CloudStoragePage.tsx', 'data-xdrive-cloud-storage-refresh-error'],
  ['ui/shared/src/mui/GlobalStorageStatsPage.tsx', 'data-xdrive-global-storage-floating-feedback'],
  ['ui/shared/src/mui/AdminUsersPage.tsx', 'data-xdrive-admin-users-refresh-error'],
]
test('P117 original Cloud/Global/Admin async status is fixed and outside MUI spacing flow', () => {
  for (const [path, marker] of cases) {
    const source = read(path)
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    const attr = (tag, name) => tag?.attributes?.properties?.find(p =>
      ts.isJsxAttribute(p) && p.name.getText(ast) === name)
    const nodes = []
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        attr(node, marker)) nodes.push(node)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.equal(nodes.length, 1, path + ': one real original status owner')
    const node = nodes[0]
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) &&
          parent.openingElement.tagName.getText(ast) === 'Stack' &&
          attr(parent.openingElement, 'spacing')) {
        assert.fail(path + ': a positioned child of MUI Stack can still shift following rows')
      }
    }
    const block = node.getText(ast)
    assert.match(block, /position:\s*'fixed'/)
    assert.match(block, /pointerEvents:\s*'none'/)
    assert.match(block, /safe-area-inset-bottom/)
    assert.ok(source.includes('minHeight: 180'), path + ': genuine cold/error geometry preserved')
    assert.ok(source.includes('XDriveStatusAlert'), path + ': errors must not be hidden')
    assert.ok(source.includes('disabled={loading}'), path + ': duplicate refresh remains disabled')
  }
})
test('P117 real status and Owner semantics survive without a decorative intermediate page', () => {
  const cloud = read(cases[0][0]), global = read(cases[1][0]), admin = read(cases[2][0])
  assert.ok(cloud.includes('data-xdrive-cloud-storage-first-read-error'))
  assert.ok(cloud.includes('{snapshot ? ('))
  assert.equal(cloud.includes(') : <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}'), false)
  assert.ok(global.includes('data-xdrive-storage-first-read-error'))
  assert.ok(global.includes('stats && showDeferredLoading'))
  assert.ok(global.includes('data-xdrive-global-storage-staging-notice'))
  assert.equal(global.includes('{stagingNotice && <XDriveStatusAlert'), false)
  assert.ok(admin.includes('data-xdrive-admin-users-first-read'))
  assert.ok(admin.includes('data-xdrive-admin-users-content'))
  assert.ok(admin.includes('readComplete && users.length > 0 && loadError'))
  assert.equal(admin.includes('{loadError && <XDriveStatusAlert'), false)
})
