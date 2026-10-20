'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const ast = ts.createSourceFile('FileExplorer.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')

function attr(node, name) {
  if (!node || !node.attributes) return null
  return node.attributes.properties.find(entry =>
    ts.isJsxAttribute(entry) && entry.name.getText(ast) === name) ?? null
}
function tagged(name) {
  const found = []
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && attr(node, name)) {
      found.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, name + ' must have exactly one real JSX owner')
  return found[0]
}
function beneath(node, marker) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && attr(parent.openingElement, marker)) return true
  }
  return false
}
test('P110: real Web/Desktop shared JSX keeps asynchronous receipts outside the flex context panel', () => {
  const overlay = tagged('data-xdrive-file-explorer-floating-feedback')
  const context = tagged('data-xdrive-file-explorer-context-panel')
  const host = tagged('data-xdrive-file-explorer-scroll-host')
  assert.ok(!beneath(overlay, 'data-xdrive-file-explorer-context-panel'))
  assert.ok(!beneath(host, 'data-xdrive-file-explorer-context-panel'))
  assert.ok(!beneath(host, 'data-xdrive-file-explorer-floating-feedback'))
  for (const key of [
    'data-xdrive-file-explorer-selection-action-reasons',
    'data-xdrive-file-explorer-unavailable-selection',
    'data-xdrive-file-explorer-selection-load-feedback',
    'data-xdrive-file-explorer-action-feedback-slot',
    'data-xdrive-file-explorer-restore-feedback',
    'data-xdrive-file-explorer-search-error-feedback',
  ]) {
    const node = tagged(key)
    assert.ok(beneath(node, 'data-xdrive-file-explorer-floating-feedback'),
      key + ' cannot change virtual scroll host geometry')
    assert.equal(beneath(node, 'data-xdrive-file-explorer-context-panel'), false)
  }
  const shell = tagged('data-xdrive-file-explorer')
  assert.match(shell.getText(ast), /data-xdrive-file-explorer/)
  assert.match(overlay.parent.getText(ast).slice(0, 520), /position: 'absolute'/)
  assert.match(overlay.parent.getText(ast).slice(0, 650), /pointerEvents: 'none'/)
  assert.match(source, /height: '100%',\s*position: 'relative',\s*flex: presentation/)
  assert.equal(shell.parent.getText(ast).includes('data-xdrive-file-explorer-scroll-host'), true,
    'the original shared Paper must still own the same scroll host')
})
test('P110: no useful status or cancel/retry is silenced to hide reflow', () => {
  const start = source.indexOf('<Box data-xdrive-file-explorer-floating-feedback')
  const end = source.indexOf('</Box>\n\n      <Drawer', start)
  assert.ok(start >= 0 && end > start)
  const block = source.slice(start, end)
  for (const marker of [
    "pointerEvents: 'auto'", 'selectionDisabledReasons.join',
    'unavailableSelectedCount', 'selectionLoadFeedback', '{actionFeedback}',
    '{viewRestoreFeedback}', '重试恢复位置',
    '{searchSummary.error}', '重试搜索', 'role="alert"',
    'env(safe-area-inset-bottom)',
  ]) assert.ok(block.includes(marker), marker)
  assert.ok(source.includes('正在选择 {selectionLoad.loaded} / {selectionLoad.total} 项'))
  assert.ok(source.includes('cancelSelectionLoad'))
  assert.ok(source.includes('XDriveFileExplorerThumbnail'))
  assert.ok(source.includes('data-xdrive-file-explorer-cold-first-range'))
  assert.ok(source.includes('data-xdrive-file-explorer-search-summary'))
  assert.ok(source.includes('data-xdrive-file-explorer-scroll-host'))
  assert.equal(agents.split('## P110 · Wide FileExplorer transient receipts outside the flex viewport').length, 2)
})
