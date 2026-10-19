const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(repo,p),'utf8')
const mobile = read('web/src/MobileFiles.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const hook = read('ui/shared/src/mui/useDeferredLoading.ts')
test('real compact Search summary has one fixed 44px rail and no immediate query spinner/phrase',()=>{
  const start = mobile.indexOf('{(props.searchActive || props.searchSummary) &&')
  const end = mobile.indexOf('{props.searchSummary?.error ? (',start)
  assert.ok(start>0 && end>start)
  const jsx=mobile.slice(start,end)
  assert.ok(jsx.includes('!pendingGlobalSearchPresentation ? ('),
    'unconfirmed Home/Recent/Favorites Search must not insert a 44px summary row')
  for(const token of [
    'data-mobile-files-search-summary','data-mobile-files-search-count-slot',
    'component="span"', "minWidth: '12ch'", "whiteSpace: 'nowrap'",
    'noWrap', 'minHeight: 44', 'aria-busy={Boolean(props.searchActive',
    "props.searchSummary?.resultCount == null",
    '结果待确认', '搜索未完成',
    'props.searchSummary?.resultCount ?? totalCount',
    'onClick={clearGlobalSearch}', 'flexShrink: 0',
  ]) assert.ok(jsx.includes(token),token)
  assert.equal(jsx.includes('正在查询…'),false,
    'an immediate Search caption must never shift the rail')
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
})
test('Mobile Search continues using the one shared Web authenticated owner/paged virtual API',()=>{
  for(const token of ['useXDriveFileExplorerWorkspace<Node, WebSearchResult>',
    'searchSummary={!trashActive && searchState.results !== null ? {',
    'resultCount: searchReady ? searchVirtualCollection?.itemCount ?? 0 : null',
    'loading: searchLoading', 'onRetry: () => { void retrySearch() }',
    'onSearch={query => { if (trashActive) onCloseTrash(); void submitSearch(query) }',
  ]) assert.ok(web.includes(token),token)
  assert.ok(mobile.includes('data-mobile-files-search-region'))
  assert.ok(mobile.includes('data-mobile-files-zero-state'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'))
  assert.ok(mobile.includes('const totalCount = props.virtualCollection?.itemCount ?? props.items.length'))
  assert.equal(mobile.includes('api.searchRange('),false)
})
