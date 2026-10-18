const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const shared = read('ui/shared/src/mui/FileExplorer.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const column = read('ui/shared/src/mui/FileExplorerColumnView.tsx')

test('FileExplorer Search result status never adds a fast in-flow progress caption or changes summary width',()=>{
  const start=shared.indexOf('data-xdrive-file-explorer-search-summary')
  const end=shared.indexOf('      {compactViewport ?',start)
  assert.ok(start>0 && end>start)
  const pane=shared.slice(start,end)
  assert.ok(pane.includes('data-xdrive-file-explorer-search-count-slot'))
  assert.ok(pane.includes('component="span"'))
  assert.ok(pane.includes("minWidth: '12ch'"))
  assert.ok(pane.includes("whiteSpace: 'nowrap'"))
  assert.ok(pane.includes('resultCount === null'))
  assert.ok(pane.includes('结果待确认'))
  assert.ok(pane.includes('搜索未完成'))
  assert.equal(pane.includes('正在搜索…'),false,
    'sub-second search should not flash an ephemeral status label in the rail')
  assert.ok(pane.includes('aria-busy={Boolean(searchSummary.loading && searchSummary.resultCount === null) || undefined}'))
  assert.ok(pane.includes('searchSummary.onClear'))
  assert.ok(pane.includes('searchSummary.onRetry'))
  assert.ok(pane.includes('searchSummary.conditions.join'))
  assert.ok(pane.includes('minHeight: 44'))
})

test('both Web and Desktop retain the same authenticated shared Search/Range and real delayed content feedback',()=>{
  for(const [name,src] of [['Web',web],['Desktop',desktop]]) {
    assert.ok(src.includes('<XDriveFileExplorer'), name+' shared MUI explorer')
    assert.ok(src.includes('searchSummary={!trashActive && searchState.results !== null ? {'),name)
    assert.ok(src.includes('resultCount: searchReady ? searchVirtualCollection?.itemCount ?? 0 : null'),name)
    assert.ok(src.includes('loading: searchLoading'),name)
    assert.ok(src.includes('onRetry: () => { void retrySearch() }'),name)
    assert.ok(src.includes('api.searchRange') || src.includes('cloudSearch'),name)
  }
  assert.ok(shared.includes("globalThis.setTimeout(() => setDelayedLoadingScope(interactionScopeKey), 300)"))
  assert.ok(shared.includes('refreshFeedbackPending = loading && logicalItemCount > 0'),
    'only populated-list refresh may schedule decorative progress')
  assert.ok(shared.includes('showDelayedLoading = refreshFeedbackPending &&'),
    'the existing 2px true refresh overlay remains available')
  assert.ok(shared.includes('XDriveFileExplorerThumbnail'), 'actual thumbnail bytes/progress not replaced')
  assert.ok(column.includes('aria-busy={state.loading || undefined}'),
    'Column exposes actual pending Range without a decorative navigation overlay')
  assert.ok(column.includes('controller.signal.aborted || generationRef.current.get(key) !== generation'),
    'Column preserves request generation cancellation')
  assert.equal(column.includes('ColumnNetworkFeedback'), false,
    'P70 intentionally removed the cosmetic delayed Column spinner')
})
