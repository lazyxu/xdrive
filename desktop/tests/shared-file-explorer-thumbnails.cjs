const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const thumbnail = read('ui', 'shared', 'src', 'mui', 'FileExplorerThumbnail.tsx')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
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
  assert.ok((pane.match(/<XDriveFileExplorerThumbnail/g) || []).length >= 3)
  assert.ok(pane.includes('quickAccessItems.map'))
  assert.ok(pane.includes('recentItems.slice(0, 8).map'))
  assert.ok(pane.includes("xDriveFileSupportsThumbnail(item.name, 'file')"))
})

test('Recent preserves thumbnail identity and only supported image media is eligible', () => {
  for (const token of ['revision?: string | number', 'updatedAt?: string', 'size?: number']) {
    assert.ok(recent.includes(token), 'Recent thumbnail identity missing: ' + token)
  }
  assert.ok(explorer.includes("fileKind === 'image' || fileKind === 'live_photo'"))
  assert.ok(explorer.includes("if (extension === 'livp') return 'live_photo'"))
  assert.equal(
    explorer.includes("fileKind === 'image' || fileKind === 'video'"),
    false,
    'FileExplorer must not claim ordinary video poster thumbnails before the Server supports them',
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
