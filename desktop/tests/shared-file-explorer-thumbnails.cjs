const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const thumbnail = read('ui', 'shared', 'src', 'mui', 'FileExplorerThumbnail.tsx')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const properties = read('ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const recent = read('ui', 'shared', 'src', 'mui', 'FileExplorerRecentController.ts')
const overview = read('desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
const muiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')

test('FileExplorer thumbnail loading is one shared provider/cache/scheduler', () => {
  for (const token of [
    'XDriveFileExplorerThumbnailProvider',
    'XDriveFileExplorerThumbnail',
    'fileThumbnailConcurrency = 6',
    'fileThumbnailCacheLimit = 96',
    'scheduleFileThumbnail',
    'observeFileThumbnailVisibility',
    'URL.revokeObjectURL',
    'fileThumbnailCacheAcquire',
    'retireFileThumbnailSource',
    'cache.leases',
    'cache.retired',
    'xDriveFileExplorerMarkThumbnailScrollActivity',
  ]) assert.ok(thumbnail.includes(token), 'shared thumbnail primitive missing: ' + token)

  assert.ok(muiIndex.includes("export * from './FileExplorerThumbnail'"))
  assert.equal(explorer.includes('function XDriveLazyFileThumbnail'), false)
  assert.equal(explorer.includes('type FileThumbnailCache'), false)
})

test('Details, Grid, properties, Quick Access and Recent use the shared thumbnail visual', () => {
  assert.ok(explorer.includes('lifecycleKey={interactionScopeKey}'))
  assert.ok(
    overview.includes("const overviewLifecycleKey = \`${status?.server ?? ''}\\n${status?.username ?? ''}\`"),
    'Desktop Overview must derive one Server+username lifecycle key',
  )
  assert.ok(
    overview.includes('lifecycleKey={overviewLifecycleKey}'),
    'Desktop Overview thumbnails must reuse the account lifecycle key',
  )
  assert.ok(explorer.includes('{thumbnailForItem(item, false)}'), 'Details/list thumbnail is missing')
  assert.ok(explorer.includes('{thumbnailForItem(item)}'), 'Grid thumbnail is missing')
  assert.ok(explorer.includes('thumbnailForItem(propertiesDialogItem)'), 'properties thumbnail is missing')
  assert.ok(pane.includes('const renderItemVisual ='), 'navigation surfaces must share one thumbnail/type/badge visual helper')
  assert.ok((pane.match(/\{renderItemVisual\(/g) || []).length >= 4, 'tree, Quick Access, Favorites and Recent must reuse the shared visual helper')
  assert.ok(pane.includes('displayedQuickAccessItems.map'))
  assert.ok(pane.includes('recentItems.slice(0, 8).map'))
  assert.ok(pane.includes("xDriveFileSupportsThumbnail(item.name, 'file')"))
})

test('Recent preserves thumbnail identity and supported image/video media is eligible', () => {
  for (const token of ['revision?: string | number', 'updatedAt?: string', 'size?: number']) {
    assert.ok(recent.includes(token), 'Recent thumbnail identity missing: ' + token)
  }
  assert.ok(explorer.includes("'livp'"), 'FileExplorer image-like thumbnail allowlist must include LIVP')
  assert.ok(explorer.includes("return fileKind === 'image' || fileKind === 'video'"))
  assert.ok(thumbnail.includes('title="实况照片"'), 'LIVP thumbnails must expose a static Live Photo badge')
  assert.ok(thumbnail.includes('XDriveLivePhotoGlyph'), 'LIVP thumbnails must use the shared Live Photo glyph instead of a play button')
  assert.ok(thumbnail.includes('width: 14') && thumbnail.includes('height: 14'), 'compact LIVP badge must scale down with small thumbnails')
  assert.ok(thumbnail.includes('<XDriveLivePhotoGlyph size={10} />'), 'compact LIVP thumbnail glyph must use the 10px shared SF geometry')
  assert.ok(
    thumbnail.includes('livePhoto && !failed && Boolean(item.thumbnail || src)'),
    'LIVP badge must not claim Live Photo readiness over a failed/generic placeholder',
  )
  assert.ok(
    explorer.includes("'3g2', '3gp', 'avi', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'webm'"),
    'FileExplorer video poster eligibility must cover the shared common-video allowlist',
  )
})


test('FileExplorer file thumbnails use square frames without rounded clipping', () => {
  assert.ok(
    explorer.includes('width: 24,') &&
      explorer.includes('height: 24,') &&
      explorer.includes("flex: '0 0 24px'") &&
      explorer.includes("overflow: 'hidden'") &&
      explorer.includes('borderRadius: 0,'),
    'Details thumbnail frame must remain square',
  )
  assert.ok(
    explorer.includes("width: gridMetrics.thumbnailWidth,\n            height: gridMetrics.thumbnailHeight,") &&
      explorer.includes("overflow: 'hidden',\n            borderRadius: 0,\n            position: 'relative',"),
    'Grid thumbnail frame must remain square',
  )
  assert.ok(
    pane.includes("position: 'relative', overflow: 'visible', borderRadius: 0"),
    'navigation thumbnail frames must remain square while leaving availability badges visible',
  )
  assert.ok(
    properties.includes("data-xdrive-file-properties-preview") &&
      properties.includes("borderRadius: 0,"),
    'Properties thumbnail/preview frame must remain square',
  )
})

test('visible thumbnail blob URLs are leased across LRU eviction', () => {
  assert.ok(
    thumbnail.includes('(cache.leases.get(value) ?? 0) > 0') &&
      thumbnail.includes('cache.retired.add(value)'),
    'LRU eviction must retire but not revoke a blob URL that is still rendered',
  )
  assert.ok(
    thumbnail.includes('if (cache.disposed || cache.retired.has(value))') &&
      thumbnail.includes('revokeFileThumbnailSource(value)'),
    'the final thumbnail lease release must revoke retired blob URLs',
  )
  assert.equal(
    thumbnail.includes('onError='),
    false,
    'decode/URL failures must keep existing failure semantics; this fix must not add an image onError fallback',
  )
})

test('navigation thumbnail projections do not restart work on fresh item object identity', () => {
  assert.ok(thumbnail.includes('const itemRef = useRef(item)'))
  assert.ok(thumbnail.includes('itemRef.current = item'))
  assert.ok(thumbnail.includes('const requestedItem = itemRef.current'))
  assert.ok(thumbnail.includes('loadThumbnail(') && thumbnail.includes('requestedItem, signal,') && thumbnail.includes('scheduled.cancel()'))
  assert.equal(
    thumbnail.includes('\n    item,\n    item.thumbnail,'),
    false,
    'thumbnail effect must be keyed by thumbnail identity rather than projected object identity',
  )
})
