'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const ast = ts.createSourceFile('FileExplorer.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

function statusBarNode() {
  const found = []
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.attributes.properties.some(property =>
        ts.isJsxAttribute(property) && property.name.getText(ast) === 'data-xdrive-file-explorer-status-bar'
      )) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, 'one original Web/Desktop status bar must own feedback')
  return found[0]
}

test('P120: shared Files status bar has a constant one-row footprint at both breakpoints', () => {
  const bar = statusBarNode()
  const code = bar.parent.getText(ast)
  for (const rule of [
    'height: compactViewport ? 36 : 28',
    'minHeight: compactViewport ? 36 : 28',
    "flexWrap: 'nowrap'", "whiteSpace: 'nowrap'",
    "overflowX: 'auto'", "overflowY: 'hidden'",
    "scrollbarWidth: 'none'", "overscrollBehaviorX: 'contain'",
    "'&::-webkit-scrollbar'",
  ]) assert.ok(code.includes(rule), rule)
  assert.equal(code.includes("flexWrap: 'wrap'"), false,
    'transient selection and durable upload state must not add a footer row')
  assert.ok(code.includes('noWrap title={arrangementStatusText}'))
  assert.ok(code.includes("sx={{ flexShrink: 0, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}"),
    'the trailing sortable status cluster is single-line')
  assert.ok(code.includes("sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}"),
    'the leading status cluster must not wrap either')
})

test('P120: real action/progress and original virtualized FileExplorer remain enabled', () => {
  const bar = statusBarNode()
  const code = bar.parent.getText(ast)
  for (const token of [
    'selectionLoad.loaded', 'selectionLoad.total', 'cancelSelectionLoad',
    'selectionLoadFeedback', 'statusText', 'viewStatusText',
    'logicalItemCount', 'arrangementStatusText',
  ]) assert.ok(code.includes(token), token)
  assert.ok(source.includes('data-xdrive-file-explorer-scroll-host'))
  assert.ok(source.includes('data-xdrive-file-explorer-floating-feedback'))
  assert.ok(source.includes('XDriveFileExplorerThumbnail'))
  assert.ok(web.includes('statusText={trashActive'))
  assert.ok(desktop.includes('statusText={trashActive'))
  assert.equal(agents.split('## P120 · Fixed one-row FileExplorer status bar across async updates').length, 2)
})
