'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ServiceDependenciesPage.tsx'), 'utf8')
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const ast = ts.createSourceFile('ServiceDependenciesPage.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
function attr(open, marker) {
  return Boolean(open?.attributes?.properties?.some(p =>
    ts.isJsxAttribute(p) && p.name.getText(ast) === marker))
}
function find(marker) {
  const nodes=[]
  function visit(node) {
    if ((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) && attr(node,marker)) nodes.push(node)
    ts.forEachChild(node,visit)
  }
  visit(ast);assert.equal(nodes.length,1,'exact original owner '+marker)
  return nodes[0]
}
function inside(node, marker) {
  for(let p=node.parent;p;p=p.parent)
    if(ts.isJsxElement(p)&&attr(p.openingElement,marker)) return true
  return false
}
test('P123: actual late Server refresh error is outside the spaced Dependencies workspace',()=>{
  const workspace=find('data-xdrive-admin-service-dependencies')
  const owner=find('data-xdrive-system-dependencies-feedback-owner')
  const error=find('data-xdrive-system-dependencies-refresh-error')
  assert.equal(inside(owner,'data-xdrive-admin-service-dependencies'),false)
  assert.ok(inside(error,'data-xdrive-system-dependencies-feedback-owner'))
  const code=owner.parent.getText(ast)
  for (const rule of ["position: 'fixed'", "pointerEvents: 'none'",
    "pointerEvents: 'auto'", 'safe-area-inset-bottom', 'snapshot && visibleError',
    '刷新失败，当前显示上次成功检测的快照']) assert.ok(code.includes(rule),rule)
  const content=workspace.parent.getText(ast)
  assert.equal(content.includes('{visibleError && <XDriveStatusAlert'),false,
    'late error must not be inserted between the permanent status line and the original cards')
  assert.ok(source.includes('cachedSnapshotRef.current = next'))
  assert.ok(source.includes('setRefreshing(true)'))
  assert.ok(source.includes('source.load().then((next)'))
})
test('P123: failed cold read keeps the silent 180px geometry with the real source error',()=>{
  const cold=find('data-xdrive-system-dependencies-cold-slot')
  const error=find('data-xdrive-system-dependencies-first-read-error')
  assert.ok(inside(error,'data-xdrive-system-dependencies-cold-slot'))
  const code=cold.parent.getText(ast)
  for (const rule of ['minHeight: 180', 'aria-busy={coldReadPending || undefined}',
    'visibleError ? (', '<XDriveStatusAlert tone="bad">{visibleError}</XDriveStatusAlert>'])
    assert.ok(code.includes(rule),rule)
  assert.ok(source.includes("const coldReadPending = !snapshot && !visibleError"))
  assert.ok(source.includes('data-xdrive-system-dependencies-quiet-status'))
  assert.equal(agents.split('## P123 · System Dependencies late read errors must never displace a verified workspace').length,2)
})
