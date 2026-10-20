'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const files = {
  Web: read('web/src/WebFileExplorer.tsx'),
  Desktop: read('desktop/src/renderer/DesktopFileExplorer.tsx'),
}
const shared = read('ui/shared/src/mui/FileExplorer.tsx')

// Execute the exact ORIGINAL shared FileExplorer JSX "loading" expression for
// each real client, not a duplicate test implementation of the busy policy.
function originalLoadingExpression(code, name) {
  const ast = ts.createSourceFile(name, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const matches = []
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(ast) === 'XDriveFileExplorer') {
      const attr = node.attributes.properties.find(x =>
        ts.isJsxAttribute(x) && x.name.getText(ast) === 'loading')
      if (attr && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
        matches.push(attr.initializer.expression.getText(ast))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, name + ': exactly one original shared Wide Explorer')
  return matches[0]
}
const expressions = Object.fromEntries(
  Object.entries(files).map(([key,code]) => [key,originalLoadingExpression(code, key)]),
)
function evaluate(name, {
  trashActive = false, trashLoading = false, directoryLoading = false,
  searchActive = false, searchLoading = false,
  fileOperationBusy = false, explorerActionBusy = false,
} = {}) {
  const original = expressions[name]
  const fn = new Function(
    'trashActive', 'trash', 'searchState', 'searchLoading', 'loading',
    'fileOperationBusy', 'explorerActionBusy', 'return (' + original + ')',
  )
  return fn(trashActive, { loading: trashLoading },
    { results: searchActive ? { query: 'current' } : null },
    searchLoading, directoryLoading, fileOperationBusy, explorerActionBusy)
}
function actualSharedFeedback(loading, logicalItemCount) {
  const ast = ts.createSourceFile('FileExplorer.tsx', shared, ts.ScriptTarget.ES2022,
    true, ts.ScriptKind.TSX)
  let expression = ''
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'refreshFeedbackPending') {
      expression = node.initializer.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression.includes('loading && logicalItemCount > 0'))
  return new Function('loading','logicalItemCount','return ('+expression+')')(
    loading, logicalItemCount)
}

test('P106 original Web and Desktop Wide Explorer never paint fake refresh during durable Copy/Upload', () => {
  for(const client of ['Web','Desktop']) {
    assert.equal(evaluate(client),false,client+' idle')
    assert.equal(evaluate(client,{fileOperationBusy:true,explorerActionBusy:true}),
      false,client+' background operation cannot own directory read state')
    assert.equal(actualSharedFeedback(
      evaluate(client,{fileOperationBusy:true,explorerActionBusy:true}),3250),
      false,client+' populated folder cannot schedule decorative delayed 2px refresh')
    assert.equal(evaluate(client,{directoryLoading:true, fileOperationBusy:true,
      explorerActionBusy:true}),true,client+' genuine directory refresh survives')
    assert.equal(evaluate(client,{searchActive:true,searchLoading:true}),true,
      client+' real Search pending remains')
    assert.equal(evaluate(client,{searchActive:true,searchLoading:false,
      directoryLoading:true, fileOperationBusy:true, explorerActionBusy:true}),
      false,client+' accepted Search is not blocked by unrelated CloudFiles')
    assert.equal(evaluate(client,{trashActive:true,trashLoading:true}),true,
      client+' real Trash refresh remains')
    assert.equal(evaluate(client,{trashActive:true,trashLoading:false,
      fileOperationBusy:true, explorerActionBusy:true}),false,
      client+' verified Trash cannot blank on unrelated operation')
    assert.equal(evaluate(client,{fileOperationBusy:true, explorerActionBusy:true}),
      false,client+' zero-item folder stays accepted during durable work')
  }
})

test('P106 wide Web/Desktop share one original read-bound policy, preserve explicit action busy and Mobile parity', () => {
  assert.equal(expressions.Web, expressions.Desktop)
  assert.equal(expressions.Web,
    'trashActive ? trash.loading : searchState.results !== null ? searchLoading : loading')
  const web = files.Web, desktop = files.Desktop
  assert.ok(web.includes('loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}'),
    'Mobile keeps composite busy for genuine action-control gates, but P104/P105 own its visible directory')
  assert.ok(web.includes('directoryLoading={loading}'))
  assert.ok(web.includes('renameDisabled={trashActive || fileOperationBusy}'))
  assert.ok(web.includes('dropDisabled={fileOperationBusy}'))
  assert.ok(desktop.includes('const explorerActionBusy = Boolean(actionBusy) || fileOperationBusy || uploadBusy'))
  assert.ok(desktop.includes('dropDisabled={trashActive || explorerActionBusy}'))
  assert.ok(desktop.includes('renameDisabled={trashActive || explorerActionBusy}'))
  for (const marker of [
    'const refreshFeedbackPending = loading && logicalItemCount > 0',
    'const keepAcceptedEmpty =',
    'useXDriveDeferredLoading(',
    'data-xdrive-file-explorer-cold-first-range',
    'data-xdrive-file-explorer-verified-empty',
    'data-xdrive-file-explorer-scroll-host',
    'XDriveFileExplorerThumbnail',
  ]) assert.ok(shared.includes(marker),marker)
  const agents = read('AGENTS.md')
  assert.equal(agents.split('## P106 · Shared Wide Explorer display loading belongs only to its read Owner').length, 2)
})
