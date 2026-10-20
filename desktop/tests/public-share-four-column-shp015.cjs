'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('SH-P015 four-column Share Details follows Owner default, without a fifth operation column', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const shared = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  assert.ok(owner.includes("defaultDetailsColumnKeys: XDriveFileExplorerDetailsColumnKey[] = ["))
  for (const token of ["  'name',", "  'updated',", "  'type',", "  'size',"]) assert.ok(owner.includes(token))
  assert.ok(owner.includes("updated: { label: '修改时间', defaultWidth: 190"))
  assert.ok(owner.includes("type: { label: '类型', defaultWidth: 150"))
  assert.ok(owner.includes("size: { label: '大小', defaultWidth: 120"))
  assert.match(publicView, /shareDetailsColumns = 'minmax\(0,1fr\) 190px 150px 120px'/)
  assert.match(publicView, /xDriveFileExplorerDetailsHeaderGeometry\(shareDetailsColumns\)/)
  assert.ok(publicView.includes("? shareDetailsColumns : undefined"))
  assert.ok(publicView.includes("gridTemplateColumns: 'minmax(0,1fr)'"))
  assert.ok(publicView.includes("'& > [role=\"cell\"]:not(:first-child)'"), 'compact viewport must hide entire extra columns, not just their text')
  assert.doesNotMatch(publicView, />操作<\/Typography>/)
  assert.doesNotMatch(publicView, /minmax\(0,1fr\) 92px/)
  assert.match(shared, /export function XDriveFileExplorerDetailsRowCell\(/)
  for (const col of ['name', 'updated', 'type', 'size'])
    assert.ok(publicView.includes('columnKey="' + col + '"'))
})

test('SH-P015 selection actions stay in reserved toolbar and cannot double-trigger inline Share requests', () => {
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const start = publicView.indexOf('{visibleItems.map(entry => (')
  const end = publicView.indexOf('      ))}', start)
  assert.ok(start >= 0 && end > start, 'bounded Share page should render its own rows')
  const row = publicView.slice(start, end)
  assert.ok(!row.includes('<Button'), 'read-only Explorer file rows cannot contain always-visible command buttons')
  assert.ok(!row.includes('<MenuItem'), 'Share row context items belong to the separate menu')
  for(const token of [
    'data-xdrive-public-share-selection-slot',
    "flex: '0 0 238px'", 'height: 36',
    'data-xdrive-public-share-selected-open',
    'data-xdrive-public-share-selected-preview',
    'data-xdrive-public-share-selected-download',
    'data-xdrive-public-share-selected-properties',
    'visibleItems.find(entry => entry.id === selectedID)',
    "if (compactShareViewport) openEntry(entry)",
    "if (!compactShareViewport) openEntry(entry)",
    'onDownloadItem?.(selectedEntry)',
    'setPropertiesEntry(selectedEntry)',
    'onContextMenu={(event) => openContextMenu(event, entry)}',
    'items.slice(0, 100)',
  ]) assert.ok(publicView.includes(token), 'missing bounded read-only behavior: ' + token)
  for(const forbidden of [
    'XDriveApi', 'OwnerJWT', 'ownerToken', 'onUpload', 'onDelete', 'onMove',
    'onDropItemsToFolder', 'onPaste', 'onRename',
  ]) assert.ok(!publicView.includes(forbidden), 'public link cannot borrow Owner account actions: ' + forbidden)
})

test('SH-P015 real 100k JWT-free Chromium download uses authorized Share context menu', () => {
  const driver = read('desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs')
  const paths = [
    '.github/workflows/folder-share-100k-metadata.yml',
    '.github/workflows/sh-p005-browser-physical-jpeg-share-100k.yml',
  ]
  for(const path of paths) {
    const workflow = read(path)
    assert.ok(workflow.includes('feat/public-share-four-column-readonly-shp015-20261021'), path)
    assert.ok(workflow.includes('github.event.pull_request.head.sha'), path)
    assert.ok(workflow.includes('postgres:17-alpine'), path)
  }
  for(const token of [
    'contextmenu', '[role=menuitem]', '下载文件', 'will-download',
    'getFilename()', 'createHash(', 'clickFirstDownload', 'SH_P005_REAL_BROWSER_PHYSICAL_100K',
  ]) assert.ok(driver.includes(token), 'source-exact browser missing actual Share-only download: ' + token)
  assert.ok(!driver.includes('row.querySelectorAll("button")'), 'do not reintroduce legacy fifth-column download')
  assert.ok(!driver.includes('route.fulfill(') && !driver.includes('mockFetch('), 'real native browser may not use fake responses')
})
