'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
function mustContain(text, snippets, label) {
  for (const snippet of snippets) assert.ok(text.includes(snippet), label + ': ' + snippet)
}
function mustOmit(text, snippets, label) {
  for (const snippet of snippets) assert.equal(text.includes(snippet), false,
    label + ': forbidden transient navigation UI: ' + snippet)
}
function stableHeight(text, marker) {
  const i = text.indexOf(marker)
  assert.ok(i > 0, 'missing original visible UI surface: ' + marker)
  const match = text.slice(i, i + 440).match(/minHeight:\s*(\d+)/)
  assert.ok(match, 'no stable geometry on ' + marker)
  return Number(match[1])
}

test('P78 evergreen AGENTS policy forbids every new navigation-only intermediate frame', () => {
  const agents = read('AGENTS.md')
  const doc = read('docs/mobile-navigation-stability.md')
  const marker = 'Permanent no-jitter contract / P78'
  assert.equal(agents.split(marker).length, 2, 'the policy must be canonical, not copied into progress notes')
  mustContain(agents, [
    'ONE authorized visual commit per navigation',
    'Never create an ephemeral intermediate UI',
    'Verified data, not Boolean busy',
    'Geometry and scroll must be stable',
    'Explicit real-progress exceptions',
    'Mandatory tests and evidence',
    'Mandatory PR / release gate',
    '52px', '44px', '300ms', 'aria-busy', 'Owner', 'session',
    'first counted Range', 'NOT RUN', '1 CSS px',
    'desktop/tests/navigation-no-jitter-contract-p78.cjs',
  ], 'mandatory policy')
  mustContain(doc, [
    '永久防回归门禁', 'P78', '未发起请求', '请求进行中',
    '一次性', '已验证的零结果', '失败、取消', '缩略图',
    '375', '390', '899', '真实浏览器', 'NOT RUN',
  ], 'platform acceptance and first-frame evidence')
  const ci = read('.github/workflows/ci.yml')
  const desktop = read('desktop/package.json')
  mustContain(ci, ['desktop-tests:', 'npm run test:main', 'final-gate:', 'go-linux-api:'],
    'source-exact CI must run source and original mounted tests')
  assert.ok(desktop.includes('node --test tests/*.cjs'),
    'new original-source regression must be included by the actual desktop-tests command')
})

test('P78 Mobile Files: verified first Range owns ONE destination/scroll commit, no directory spinner', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  mustContain(mobile, [
    'const authorizedCommit = routedCommit || pathCommit || homeRootCommit || externalDirectoryCommit',
    'pendingExternalDirectoryRef.current',
    'const coldReadScope = [',
    'const ownerDirectoryLoading = props.directoryLoading ?? props.loading',
    'coldReadAttemptRef.current.began',
    'const coldDirectoryReadUnconfirmed =',
    'const keepAcceptedEmptyDirectory =',
    'data-xdrive-file-explorer-scroll-host',
    'data-mobile-files-collection-first-read',
    'data-mobile-files-organization-loading',
    'const showRangeLoading = (props.loading || searchCountPending) &&\n    (props.searchActive || (props.trashActive && totalCount > 0))',
  ], 'original mobile navigation')
  mustOmit(mobile, [
    'beginBrowse(entry.id)', 'beginBrowse(selectedEntry.id)',
    'showOrganizationLoading', 'showRecentFirstRead', 'showFavoriteFirstRead',
    'useXDriveDeferredPendingLoading', '正在加载文件…', '正在读取最近删除…',
  ], 'normal folder, rail and collection navigation')
  assert.equal(stableHeight(mobile, 'data-mobile-files-zero-state'), 180)
  assert.equal(stableHeight(mobile, 'data-mobile-files-collection-state'), 180)
  mustContain(web, ['directoryLoading={loading}', 'virtualCollection=', '<MobileFiles'],
    'actual Web Owner GET must not be confused with Search/Operation busy')
  mustContain(mobile, ['XDriveFileExplorerThumbnail', 'showRangeLoading'],
    'real thumbnail + deliberate Search/Trash feedback must remain')
})

test('P78 shared Files: cold/verified/error geometry and reusable virtualization do not flicker', () => {
  const files = read('ui/shared/src/mui/FileExplorer.tsx')
  const pane = read('ui/shared/src/mui/FileExplorerNavigationPane.tsx')
  const columns = read('ui/shared/src/mui/FileExplorerColumnView.tsx')
  for (const marker of [
    'data-xdrive-file-explorer-cold-first-range',
    'data-xdrive-file-explorer-verified-empty',
    'data-xdrive-file-explorer-unverified-first-read',
    'data-xdrive-file-explorer-empty-read-error',
  ]) assert.equal(stableHeight(files, marker), 180,
    'all first-read / verified-zero / failed states must use the same geometry')
  mustContain(files, ['data-xdrive-file-explorer-scroll-host', 'XDriveFileExplorerThumbnail'],
    'original sparse Explorer and media thumbnails')
  mustOmit(files, ['正在加载文件…'], 'FileExplorer normal directory navigation')
  mustOmit(pane, ['XDriveNavigationQuietSpinner', '正在加载智能文件夹和标签…'],
    'original shared Web/Desktop sidebar')
  mustContain(pane, ['data-xdrive-sidebar-quick-access-first-read',
    'data-xdrive-sidebar-favorites-first-read', 'data-xdrive-sidebar-recent-first-read',
    'aria-busy={quickAccessLoading || quickAccessReadState === \'unverified\' || undefined}'],
    'sidebar first index must be quiet and semantic')
  mustOmit(columns, ['ColumnNetworkFeedback'], 'shared Files Column navigation')
  mustContain(columns, ['aria-busy={state.loading || undefined}',
    'controller.signal.aborted || generationRef.current.get(key) !== generation',
    'XDriveAutoLoadSentinel', 'data-xdrive-column-error'],
    'real column cancellation, pagination and retry survive')
})

test('P78 shared Gallery: authorized-zero index and fixed quiet geometry preserve real media progress', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const memories = read('ui/shared/src/mui/MediaGalleryMemories.tsx')
  const cleanup = read('ui/shared/src/mui/MediaGalleryCleanup.tsx')
  const albums = read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
  for (const marker of [
    'data-xdrive-gallery-cold-pending', 'data-xdrive-gallery-empty',
    'data-xdrive-gallery-load-error',
  ]) assert.equal(stableHeight(gallery, marker), 220,
    'first virtualized Gallery Range and accepted/error outcomes cannot shift height')
  mustContain(gallery, [
    'memoriesReadState', 'cleanupReadState',
    'data-xdrive-gallery-places-first-read',
    'data-xdrive-gallery-unverified-facet-index',
    'XDriveMediaAsyncThumbnail', 'XDriveMediaAsyncVideoPoster',
    'showDelayedPlacesPage',
  ], 'original shared Gallery current-Owner semantics and real media loading')
  mustOmit(gallery, [
    'showDelayedColdPhotoLoad', 'showDelayedPlacesInitial',
    'showDelayedColdFacetRead', '正在加载图库…', '正在读取人物…', '正在加载地点…',
  ], 'Gallery first-index-only decorations')
  mustContain(memories, ["memories.length === 0 && readState !== 'ready'"],
    'Memories first cold [] cannot claim empty')
  mustContain(cleanup, ["firstReadPending = bursts === null && readState === 'unverified'"],
    'Cleanup first cold null cannot claim error')
  mustContain(albums, ['data-xdrive-gallery-album-index-read-state',
    'aria-busy={currentFolderLoading || undefined}'],
    'Album first index and folder navigation')
  assert.equal(stableHeight(albums, 'data-xdrive-gallery-album-index-read-state'), 160)
  mustOmit(albums, ['showDelayedIndexRead', '正在读取相册…'],
    'Album first read is silent, not artificially delayed')
})
