const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const recent = read('ui/shared/src/mui/FileExplorerRecentController.ts')
const favorite = read('ui/shared/src/mui/FileExplorerFavoriteController.ts')
const mobile = read('web/src/MobileFiles.tsx')
const web = read('web/src/WebFileExplorer.tsx')

test('Current account Recent and Favorites never mistake pending or failed for an accepted empty collection', () => {
  for (const source of [recent, favorite]) {
    assert.ok(source.includes("useState<'unverified' | 'ready' | 'error'>('unverified')"))
    assert.ok(source.includes("setReadState('ready')"))
    assert.ok(source.includes("setReadState('error')"))
    assert.ok(source.includes("setReadState('unverified')"))
    assert.ok(source.includes("readState: scopeVisible ? readState : 'unverified'"))
    assert.ok(source.includes('requestID === loadRequestRef.current'))
    assert.ok(source.includes('visibleScopeRef.current.lifecycleKey === lifecycleKey'))
  }
  assert.ok(recent.includes('rawItemsRef.current.clear()'))
  assert.ok(favorite.includes('onErrorRef.current(error)'))
})
test('Compact Web receives live read receipts without diverging from the shared owner REST controllers', () => {
  for (const token of [
    'recentLoading={recent.loading}', 'recentReadState={recent.readState}',
    'favoritesLoading={favorites.loading}', 'favoritesReadState={favorites.readState}',
    'onRefreshRecent={() => { void recent.refresh() }}',
    'onRefreshFavorites={() => { void favorites.refresh() }}',
    'useXDriveFileExplorerWorkspace<Node, WebSearchResult>',
  ]) assert.ok(web.includes(token), token)
  assert.ok(mobile.includes("const collectionFirstRead = section !== 'browse' && sectionItems.length === 0"))
  assert.ok(mobile.includes("collectionReadState === 'unverified'"))
  assert.ok(mobile.includes("collectionReadState === 'error' && collectionLoading"))
  assert.ok(mobile.includes("useXDriveDeferredPendingLoading(section === 'recent' && collectionFirstRead)"))
  assert.ok(mobile.includes("useXDriveDeferredPendingLoading(section === 'favorites' && collectionFirstRead)"))
  assert.ok(mobile.includes('data-mobile-files-collection-state'))
  assert.ok(mobile.includes('data-mobile-files-collection-error'))
  assert.ok(mobile.includes('data-mobile-files-collection-first-read'))
  assert.ok(mobile.includes("collectionReadState === 'ready' ? ("))
  assert.ok(mobile.includes('props.onRefreshRecent : props.onRefreshFavorites'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'))
  assert.ok(mobile.includes('const totalCount = props.virtualCollection?.itemCount ?? props.items.length'))
})
