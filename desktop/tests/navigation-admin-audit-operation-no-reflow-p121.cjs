'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const audit = read('ui/shared/src/mui/AdminAuditPage.tsx')
const operations = read('ui/shared/src/mui/FileOperationCenter.tsx')
const taskCenter = read('ui/shared/src/mui/TaskCenterPage.tsx')
const agents = read('AGENTS.md')
const ast = ts.createSourceFile('AdminAuditPage.tsx', audit, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
function hasAttribute(open, marker) {
  return Boolean(open.attributes?.properties?.some(prop =>
    ts.isJsxAttribute(prop) && prop.name.getText(ast) === marker))
}
function one(marker) {
  const found = []
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && hasAttribute(node, marker)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, 'one original audit owner '+marker)
  return found[0]
}
function inside(node, marker) {
  for (let parent=node.parent; parent; parent=parent.parent)
    if (ts.isJsxElement(parent) && hasAttribute(parent.openingElement, marker)) return true
  return false
}
test('P121: late audit error is not an ordinary Stack sibling above accepted virtual rows', () => {
  const notice=one('data-xdrive-admin-audit-refresh-error')
  assert.equal(inside(notice,'data-xdrive-admin-audit-content'),false)
  assert.ok(audit.includes('error && totalCount !== null ? ('),
    'only accepted audit rows may publish a late floating failure')
  const code=notice.parent.getText(ast)
  for (const rule of [
    "position: 'fixed'",
    "pointerEvents: 'none'",
    "pointerEvents: 'auto'",
    'safe-area-inset-bottom',
    "role=\"alert\"",
  ]) assert.ok(code.includes(rule),rule)
  const main=one('data-xdrive-admin-audit-content')
  const owner=main.parent.getText(ast)
  assert.equal(owner.includes('{error ? <XDriveStatusAlert tone="bad">'),false,
    'no late error row between filters and original virtual table')
  assert.ok(audit.includes('useLayoutEffect(() => {'))
  assert.ok(audit.includes('virtualCollection.loadedItems.get(index)'))
  assert.ok(audit.includes('pendingFilterRef.current?.abort()'))
})
test('P121: failed cold audit read occupies its original 180px slot with a true error', () => {
  const first=one('data-xdrive-admin-audit-first-read')
  const cold=one('data-xdrive-admin-audit-first-read-error')
  assert.ok(inside(cold,'data-xdrive-admin-audit-first-read'),
    'cold actual error cannot add a second row outside the reserved first-read owner')
  assert.ok(first.parent.getText(ast).includes('minHeight: 180'))
  assert.ok(cold.parent.getText(ast).includes('<XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>'))
  assert.ok(cold.parent.getText(ast).includes('审计日志读取失败，请重试。'))
  assert.ok(audit.includes('acceptedSource === api ? virtualCollection.totalCount : null'))
})
test('P121: file-operation first history read is silent; actual operation controls remain', () => {
  assert.ok(operations.includes('data-xdrive-file-operation-first-read aria-busy="true"'))
  assert.ok(operations.includes('minHeight: 180'))
  assert.equal(operations.includes('正在加载文件操作…'),false)
  assert.ok(operations.includes('if (loading && operations.length === 0)'))
  assert.ok(operations.includes('XDriveStatePanel variant="plain" compact message={`暂无${label}文件操作。`}'))
  for(const token of ['LinearProgress', 'onCancel', 'onRetry', 'onUndo', 'onRedo',
    'xDriveFileOperationEtaMs', 'xDriveFileOperationAverageBytesPerSecond', 'XDriveFileOperationCenter'])
    assert.ok(operations.includes(token),token)
  assert.ok(taskCenter.includes('<XDriveFileOperationCenter'))
  assert.equal(agents.split('## P121 · Audit and FileOperation asynchronous navigation has no transient reflow').length,2)
})
