'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')


test('SH-P014 Owner and public read-only Explorer actually mount the same neutral Details cell', () => {
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const start = leaf.indexOf('export function XDriveFileExplorerDetailsRowCell(')
  const end = leaf.indexOf('export function xDriveFileExplorerDetailsHeaderGeometry(', start)
  assert.ok(start > 0 && end > start)
  const cell = leaf.slice(start, end)
  for(const token of ['role="cell"', "columnKey === 'name' ? 'relative'", "overflow: 'hidden'",
    "textAlign: rightAligned ? 'right' : 'left'", '{children}'])
    assert.ok(cell.includes(token), 'missing original Details cell geometry: ' + token)
  assert.ok(owner.includes('<XDriveFileExplorerDetailsRowCell'))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.equal(facade.includes('<XDriveFileExplorerDetailsRowCell'), false)
  assert.equal(bridge.includes('<XDriveFileExplorerDetailsRowCell'), false)
})


test('SH-P014 Owner and Public use same pure Details header geometry, preserving interactive ownership', () => {
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const region = leaf.slice(leaf.indexOf('export function xDriveFileExplorerDetailsHeaderGeometry('),
    leaf.indexOf('// Owner and public Share use one neutral Grid visual/title layout.'))
  for(const token of ["position: 'sticky' as const", "display: 'grid' as const",
    'gridTemplateColumns,', 'minHeight: headerHeight', "alignItems: 'center' as const",
    "bgcolor: 'background.default'", 'borderBottom: 1'])
    assert.ok(region.includes(token), 'pure header layout missing ' + token)
  assert.match(owner, /xDriveFileExplorerDetailsHeaderGeometry\(detailsGridTemplate, detailsHeaderHeight\)/)
  assert.ok(owner.includes("onDragOver={(event) => dragOverDetailsColumn(event, key)}"))
  assert.ok(owner.includes("onPointerDown={(event) => startDetailsColumnResize(event, key)}"))
  assert.ok(bridge.includes('onDownloadItem?.(entry)') && bridge.includes('onOpenFolder?.(entry)'))
  assert.equal(facade.includes('xDriveFileExplorerDetailsHeaderGeometry'), false)
  for(const mutation of ['onDeleteItems=', 'onMoveItemsTo=', 'onRenameItem=', 'onUploadItems=',
    'onDropItemsToFolder=']) assert.ok(!bridge.includes(mutation))
})

test('SH-P014 enables exact-head real public 100k JPEG browser and metadata scope gates', () => {
  const branch = 'feat/public-share-details-presenter-shp014-20261021'
  for(const name of ['folder-share-100k-metadata.yml','sh-p005-browser-physical-jpeg-share-100k.yml']) {
    const workflow = read('.github/workflows/'+name)
    assert.ok(workflow.includes("github.head_ref == '"+branch+"'"), 'must execute real 100k at new PR HEAD')
    assert.ok(workflow.includes('github.event.pull_request.head.sha'), 'exact-source checkout required')
    assert.ok(workflow.includes('postgres:17-alpine'), 'genuine Postgres17 required')
    assert.ok(!workflow.includes('go test -race'), 'do not widen into Race optimization')
  }
})
