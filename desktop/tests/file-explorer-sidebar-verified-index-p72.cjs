'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const pinned = read('ui/shared/src/mui/FileExplorerQuickAccessController.ts')
const recent = read('ui/shared/src/mui/FileExplorerRecentController.ts')
const favorites = read('ui/shared/src/mui/FileExplorerFavoriteController.ts')
const sidebar = read('ui/shared/src/mui/FileExplorerNavigationPane.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')

test('P72 Quick Access confirms empty only after current Owner successful read and fails explicitly', () => {
  assert.ok(pinned.includes("useState<'unverified' | 'ready' | 'error'>('unverified')"))
  const read = pinned.slice(pinned.indexOf('const loadFresh = useCallback'),pinned.indexOf('const enqueueMutation'))
  assert.ok(read.includes('requestID === loadRequestRef.current'))
  assert.ok(read.includes('reorderGeneration === reorderGenerationRef.current'))
  assert.ok(read.includes("setReadState('ready')"))
  assert.ok(read.includes("setReadState('error')"))
  assert.ok(read.includes("setReadState('unverified')"))
  assert.ok(pinned.includes("readState: scopeVisible ? readState : 'unverified'"),
    'session changes must hide old account receipt even before passive effects')
  assert.ok(recent.includes("readState: scopeVisible ? readState : 'unverified'"))
  assert.ok(favorites.includes("readState: scopeVisible ? readState : 'unverified'"))
})
test('P72 single shared sidebar gates unknown/error/empty on three independent current read receipts', () => {
  for (const [id, state] of [
    ['quick-access','quickAccessReadState'],
    ['favorites','favoritesReadState'],
    ['recent','recentReadState'],
  ]) {
    assert.ok(sidebar.includes(state + " === 'unverified'"))
    assert.ok(sidebar.includes(state + " === 'error'"))
    assert.ok(sidebar.includes('data-xdrive-sidebar-'+id+'-first-read'))
    assert.ok(sidebar.includes('data-xdrive-sidebar-'+id+'-error'))
    assert.ok(sidebar.includes('data-xdrive-sidebar-'+id+'-empty'))
  }
  assert.ok(sidebar.includes('aria-busy={quickAccessLoading || quickAccessReadState'))
  assert.ok(sidebar.includes('aria-busy={favoritesLoading || favoritesReadState'))
  assert.ok(sidebar.includes('aria-busy={recentLoading || recentReadState'))
  assert.equal(sidebar.includes('XDriveNavigationQuietSpinner'), false)
  assert.equal(sidebar.includes('CircularProgress'), false)
  assert.ok(sidebar.includes('onRetryQuickAccess'))
  assert.ok(sidebar.includes('onRetryFavorites'))
  assert.ok(sidebar.includes('onRetryRecent'))
})
test('P72 shared Web and Desktop use the original owner-scoped controllers, no UI-only duplicated API', () => {
  for (const [name, ui] of [['Web', web], ['Desktop', desktop]]) {
    for (const term of [
      'quickAccessReadState={quickAccess.readState}',
      'favoritesReadState={favorites.readState}',
      'recentReadState={recent.readState}',
      'onRetryQuickAccess={() => { void quickAccess.refresh() }}',
      'onRetryFavorites={() => { void favorites.refresh() }}',
      'onRetryRecent={() => { void recent.refresh() }}',
      'quickAccessItems={quickAccess.items}',
      'favoriteItems={favorites.items}',
      'recentItems={recent.items}',
      'loadDirectoryPage={loadTreeDirectoryPage}',
    ])assert.ok(ui.includes(term),name+' missing: '+term)
  }
})
