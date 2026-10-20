'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/GlobalStorageStatsPage.tsx'), 'utf8')
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/StorageStatsPanel.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')
const ast = ts.createSourceFile('GlobalStorageStatsPage.tsx', page, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
function hasAttr(open, marker) {
  return Boolean(open?.attributes?.properties?.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)===marker))
}
function one(marker) {
  const found=[]
  function visit(node) {
    if ((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&hasAttr(node,marker)) found.push(node)
    ts.forEachChild(node,visit)
  }
  visit(ast)
  assert.equal(found.length,1,'one original '+marker+' owner')
  return found[0]
}
test('P122: history progress stays inside the same always-mounted control row, not a new Stack sibling',()=>{
  const owner=one('data-xdrive-storage-history-control-owner')
  const progress=one('data-xdrive-storage-history-progress-slot')
  const code=owner.parent.getText(ast)
  assert.ok(code.includes("position: 'relative'"),'original controls anchor')
  assert.equal(progress.parent.parent,owner.parent,'the actual progress Box must be inside the original controls Box')
  assert.ok(owner.parent.parent.getText(ast).includes('data-xdrive-storage-section="history"'),
    'the same accepted history section still owns its controls')
  for (const rule of ['aria-busy={historyLoading || undefined}', "position: 'absolute'",
      "top: 'calc(100% + 2px)'", 'height: 4', "pointerEvents: 'none'",
      'historyLoading ? <LinearProgress aria-label="正在加载存储历史" /> : null'])
    assert.ok(code.includes(rule),rule)
  assert.equal(page.includes('  {historyLoading ? <LinearProgress aria-label="正在加载存储历史" /> : null}\n                  <Stack spacing={1}>'),false,
    'never insert a loading child between original outer Stack children')
})
test('P122: live history filter, accepted results and shared transport remain unchanged',()=>{
  for (const s of ['api.adminStorageHistory(historyDays)','value={historyDays}',
    '<ToggleButton value={30}>30 天</ToggleButton>','<ToggleButton value={90}>90 天</ToggleButton>',
    '<ToggleButton value={180}>180 天</ToggleButton>','history.samples.slice(-12).reverse()',
    'XDriveMetricCard title="历史样本"', 'data-xdrive-storage-history-mobile-list'])
    assert.ok(page.includes(s),s)
  assert.ok(web.includes('XDriveGlobalStorageStatsPage as default'))
  assert.ok(desktop.includes('<XDriveGlobalStorageStatsPage'))
  assert.equal(agents.split('## P122 · History window progress cannot add a normal-flow Gallery/Storage row').length,2)
})
