'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const trash = read('ui/shared/src/mui/FileExplorerTrashController.tsx')
const source = ts.createSourceFile('FileExplorer.tsx',explorer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)

function findFirstReadElement() {
  const matches = []
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(source) === 'Box' &&
        node.attributes.properties.some(attr =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(source) === 'data-xdrive-file-explorer-unverified-first-read')) {
      matches.push(node)
    }
    ts.forEachChild(node,visit)
  }
  visit(source)
  assert.equal(matches.length,1,
    'the original shared wide first-read surface is exactly one self-closing, silent Box')
  return matches[0]
}

test('P77 real FileExplorer JSX: first unverified Trash is a silent 180px semantic slot', () => {
  const node = findFirstReadElement()
  const raw = node.getText(source)
  assert.ok(raw.includes('aria-busy={loading || emptyReadState === \'unverified\' || undefined}'))
  assert.ok(raw.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(!raw.includes('XDriveStatePanel'))
  assert.ok(!raw.includes('CircularProgress'))
  assert.ok(!raw.includes('showDelayedLoading'))
  assert.equal(explorer.includes('正在读取回收站…'),false,
    'no timer-driven visual intermediary can flash after 300ms')
  assert.ok(explorer.includes("emptyReadState === 'error' && !loading"))
  assert.ok(explorer.includes('data-xdrive-file-explorer-empty-read-error'))
  assert.ok(explorer.includes('回收站读取失败，请重试。'))
  assert.ok(explorer.includes('onClick={onRefresh}'),
    'a genuine terminal failure must still have its original retry action')
  assert.ok(explorer.includes('data-xdrive-file-explorer-verified-empty'))
})

test('P77 first reads schedule no decorative timer; populated refresh keeps true 2px status', () => {
  const start = explorer.indexOf('const refreshFeedbackPending =')
  const end = explorer.indexOf('const groupIndex =',start)
  assert.ok(start > 0 && end > start)
  const logic = explorer.slice(start,end)
  assert.ok(logic.includes('refreshFeedbackPending = loading && logicalItemCount > 0'))
  assert.ok(logic.includes('refreshFeedbackCycleRef.current.pending !== refreshFeedbackPending'))
  assert.ok(logic.includes('refreshFeedbackCycleRef.current.scope !== interactionScopeKey'))
  assert.ok(logic.includes('generation: refreshFeedbackCycleRef.current.generation + 1'))
  assert.ok(logic.includes('showDelayedLoading = useXDriveDeferredLoading('))
  assert.ok(logic.includes('refreshFeedbackPending, refreshFeedbackCycleRef.current.generation'))
  assert.equal(logic.includes('setDelayedLoadingScope'), false,
    'P77 cold first read must not depend on an effect-only spinner reset')
  assert.ok(explorer.includes('showDelayedLoading && logicalItemCount > 0 ? ('))
  assert.ok(explorer.includes('aria-label="正在刷新文件"'))
  assert.ok(explorer.includes('height: 2,'))
  assert.ok(explorer.includes('XDriveFileExplorerThumbnail'),
    'network thumbnails have their own original feedback')
})

test('P77 Web and Desktop still use original Owner-scoped Trash state, retry, and bounded ranges', () => {
  for (const [name,adapter] of [['Web',web],['Desktop',desktop]]) {
    assert.ok(adapter.includes('XDriveFileExplorer'),name)
    assert.ok(adapter.includes("emptyReadState={trashActive ? trash.readState : 'ready'}"),name)
    assert.ok(adapter.includes("onRefresh={trashActive ? () => { void trash.refresh() } : refresh}"),name)
    assert.ok(adapter.includes('virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}'),name)
    assert.ok(adapter.includes('trashActive ? trash.loading : loading'),name)
  }
  for (const token of [
    "state: 'unverified' | 'ready' | 'error'",
    'readReceipt.queryKey === rangeQueryKey',
    'rangeCollection.primePage',
    'adapter.listTrashRange',
  ]) assert.ok(trash.includes(token),token)
})
