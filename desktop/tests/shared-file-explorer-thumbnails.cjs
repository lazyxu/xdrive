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
    'xDriveFileExplorerMarkThumbnailScrollActivity',
  ]) assert.ok(thumbnail.includes(token), 'shared thumbnail primitive missing: ' + token)

  assert.ok(muiIndex.includes("export * from './FileExplorerThumbnail'"))
  assert.equal(explorer.includes('function XDriveLazyFileThumbnail'), false)
  assert.equal(explorer.includes('type FileThumbnailCache'), false)
})

test('Details, Grid, properties, Quick Access and Recent use the shared thumbnail visual', () => {
  assert.ok(explorer.includes('<XDriveFileExplorerThumbnailProvider loadThumbnail={loadThumbnail}>'))
  assert.ok(explorer.includes('{thumbnailForItem(item, false)}'), 'Details/list thumbnail is missing')
  assert.ok(explorer.includes('{thumbnailForItem(item)}'), 'Grid thumbnail is missing')
  assert.ok(explorer.includes('thumbnailForItem(propertiesDialogItem)'), 'properties thumbnail is missing')
  assert.ok(pane.includes('const renderItemVisual ='), 'navigation surfaces must share one thumbnail/type/badge visual helper')
  assert.ok((pane.match(/\{renderItemVisual\(/g) || []).length >= 4, 'tree, Quick Access, Favorites and Recent must reuse the shared visual helper')
  assert.ok(pane.includes('quickAccessItems.map'))
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

test('navigation thumbnail projections do not restart work on fresh item object identity', () => {
  assert.ok(thumbnail.includes('const itemRef = useRef(item)'))
  assert.ok(thumbnail.includes('itemRef.current = item'))
  assert.ok(thumbnail.includes('const requestedItem = itemRef.current'))
  assert.ok(thumbnail.includes('loadThumbnail(requestedItem)'))
  assert.equal(
    thumbnail.includes('\n    item,\n    item.thumbnail,'),
    false,
    'thumbnail effect must be keyed by thumbnail identity rather than projected object identity',
  )
})
