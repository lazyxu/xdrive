'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')

// Evaluate the real, original MobileFiles TSX state initializers. Do not keep
// a second copy of its feedback algorithm in test fixtures.
const ast = ts.createSourceFile('MobileFiles.tsx', mobile,
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const names = [
  'searchCountPending', 'ownerDirectoryLoading', 'searchOwnerLoading',
  'showRangeLoading', 'zeroStateOwnerLoading', 'zeroStatePending',
  'showArrangementLoading', 'zeroStateLoading', 'showZeroState', 'zeroStateMessage',
]
const expressions = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      names.includes(node.name.text)) {
    const key = node.name.text
    assert.equal(expressions.has(key), false, 'multiple ' + key + ' declarations')
    assert.ok(node.initializer, 'missing real initializer: ' + key)
    expressions.set(key, node.initializer.getText(ast))
  }
  ts.forEachChild(node, visit)
}
visit(ast)
for (const name of names) assert.ok(expressions.has(name), 'missing original MobileFiles: ' + name)

function actual(name, scope) {
  const args = Object.keys(scope)
  return new Function(...args, '"use strict"; return (' + expressions.get(name) + ');')(
    ...args.map(key => scope[key]))
}
function evaluateState(rawProps, totalCount, delayed = false) {
  const props = {
    searchActive: false, trashActive: false, loading: false,
    directoryLoading: false, searchSummary: undefined, ...rawProps,
  }
  const scope = {
    props, totalCount, keepAcceptedEmptyDirectory: false,
    savedResumePending: false, verifiedTrashEmpty: Boolean(
      props.trashActive && props.trashReadState === 'ready' && totalCount === 0),
    coldUnconfirmedBrowse: false, coldDirectoryFirstRead: false,
    coldDirectoryReadUnconfirmed: false, coldDirectoryReadFailed: false,
    unverifiedTrashEmpty: false, failedTrashEmpty: false,
  }
  for (const name of ['searchCountPending', 'ownerDirectoryLoading', 'searchOwnerLoading',
    'showRangeLoading', 'zeroStateOwnerLoading', 'zeroStatePending']) {
    scope[name] = actual(name, scope)
  }
  scope.loadFeedbackGeneration = 3
  scope.delayedLoadGeneration = delayed ? 3 : null
  for (const name of ['showArrangementLoading', 'zeroStateLoading',
    'showZeroState', 'zeroStateMessage']) scope[name] = actual(name, scope)
  return scope
}

test('P81: accepted 48-row Search never takes an unrelated 360ms file-operation busy as its read owner', () => {
  const state = evaluateState({
    searchActive: true, loading: true, directoryLoading: false,
    searchSummary: { query: 'document', resultCount: 48, loading: false, error: null },
  }, 48, true)
  assert.equal(state.searchCountPending, false)
  assert.equal(state.searchOwnerLoading, false)
  assert.equal(state.showRangeLoading, false)
  assert.equal(state.showArrangementLoading, false)
  assert.equal(state.zeroStatePending, false)
  assert.equal(state.showZeroState, false)
})

test('P81: verified empty Search stays a truthful 180px zero-state while Copy/Upload/Delete is busy', () => {
  const state = evaluateState({
    searchActive: true, loading: true,
    searchSummary: { query: 'not-found', resultCount: 0, loading: false, error: null },
  }, 0, true)
  assert.equal(state.showRangeLoading, false)
  assert.equal(state.showArrangementLoading, false)
  assert.equal(state.zeroStatePending, false)
  assert.equal(state.showZeroState, true)
  assert.equal(state.zeroStateMessage, '未找到匹配的文件或文件夹')
})

test('P81: genuine unconfirmed Search COUNT/Range retains delayed progress, not false empty', () => {
  const props = {
    searchActive: true, loading: true,
    searchSummary: { query: 'new-query', resultCount: null, loading: true, error: null },
  }
  const before = evaluateState(props, 0, false)
  const after = evaluateState(props, 0, true)
  assert.equal(before.searchCountPending, true)
  assert.equal(before.showRangeLoading, true)
  assert.equal(before.zeroStatePending, true)
  assert.equal(before.zeroStateLoading, false)
  assert.equal(before.showZeroState, true)
  assert.equal(after.showArrangementLoading, true)
  assert.equal(after.zeroStateLoading, true)
  assert.equal(after.zeroStateMessage, '正在查询…')
})

test('P81: canceled/unverified and failed Search never masquerade as verified empty', () => {
  const unresolved = evaluateState({
    searchActive: true, loading: false,
    searchSummary: { query: 'new-query', resultCount: null, loading: false, error: null },
  }, 0, false)
  assert.equal(unresolved.searchCountPending, true)
  assert.equal(unresolved.zeroStatePending, true)
  assert.equal(unresolved.zeroStateLoading, false)
  const failed = evaluateState({
    searchActive: true, loading: false,
    searchSummary: { query: 'broken', resultCount: null, loading: false, error: '503' },
  }, 0, true)
  assert.equal(failed.searchCountPending, false)
  assert.equal(failed.showRangeLoading, false)
  assert.equal(failed.zeroStatePending, false)
  assert.equal(failed.zeroStateMessage, '搜索失败，请重试')
})

test('P81: populated Trash and cold CloudFiles stay owned by their original read states', () => {
  const trash = evaluateState({ trashActive: true, loading: true }, 8, true)
  assert.equal(trash.showRangeLoading, true)
  assert.equal(trash.showArrangementLoading, true)
  const verifiedEmptyTrash = evaluateState({
    trashActive: true, trashReadState: 'ready', loading: true,
  }, 0, true)
  assert.equal(verifiedEmptyTrash.showRangeLoading, false)
  assert.equal(verifiedEmptyTrash.zeroStatePending, false)
  const browse = evaluateState({
    loading: true, directoryLoading: true,
  }, 0, true)
  assert.equal(browse.ownerDirectoryLoading, true)
  assert.equal(browse.zeroStateOwnerLoading, true)
  assert.equal(browse.showRangeLoading, false)
})

test('P81: only real Search owner can start 300ms feedback; shared Range and fixed geometry survive', () => {
  assert.ok(web.includes('loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}'),
    'retain composite action-busy for disabling unsafe user commands')
  assert.ok(web.includes('loading: searchLoading'))
  assert.ok(web.includes('resultCount: searchReady ? searchVirtualCollection?.itemCount ?? 0 : null'))
  assert.ok(mobile.includes('if (!showRangeLoading) return'))
  assert.ok(mobile.includes('setDelayedLoadGeneration(loadFeedbackGeneration), 300'))
  assert.ok(mobile.includes('loadFeedbackCycleRef.current.generation + 1'))
  assert.ok(mobile.includes('data-mobile-files-arrangement-status'))
  const emptyStart = mobile.indexOf('data-mobile-files-zero-state')
  assert.ok(emptyStart > 0)
  assert.ok(mobile.slice(emptyStart, emptyStart + 420).includes('minHeight: 180'))
  const summaryStart = mobile.indexOf('data-mobile-files-search-summary')
  assert.ok(summaryStart > 0)
  assert.ok(mobile.slice(summaryStart, summaryStart + 450).includes('minHeight: 44'))
  assert.equal(mobile.split('data-xdrive-file-explorer-scroll-host').length - 1, 1)
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'))
  assert.ok(mobile.includes('onClick={props.searchSummary.onRetry}'))
})
