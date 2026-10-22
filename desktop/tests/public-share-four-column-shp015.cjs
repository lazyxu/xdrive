'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')


test('SH-P015 four-column Share Details follows Owner default, without a fifth operation column', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  assert.ok(owner.includes("defaultDetailsColumnKeys: XDriveFileExplorerDetailsColumnKey[] = ["))
  for (const token of ["  'name',", "  'updated',", "  'type',", "  'size',"])
    assert.ok(owner.includes(token))
  for (const token of ["updated: { label: '修改时间', defaultWidth: 190",
    "type: { label: '类型', defaultWidth: 150", "size: { label: '大小', defaultWidth: 120"])
    assert.ok(owner.includes(token))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.equal(facade.includes('shareDetailsColumns'), false)
  assert.equal(bridge.includes('shareDetailsColumns'), false)
  assert.equal(facade.includes('columnKey="name"'), false)
  assert.equal(bridge.includes('columnKey="name"'), false)
})


test('SH-P015 selection actions stay in Core toolbar and cannot double-trigger inline Share requests', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  for(const token of [
    'getItemMenuItems={contextActions}', 'onDownloadItems={caps.download',
    'getSelectionActionDisabledReason=', 'targets.length !== 1',
    'onOpenItem={openItem}', 'onDownloadItem?.(entry)', 'onOpenFolder?.(entry)',
    'items.slice(0, fileLink ? 1 : sharePageLimit)', 'fileLink ? 1 : sharePageLimit',
  ]) assert.ok(bridge.includes(token), 'missing read-only Core behavior: ' + token)
  assert.equal(facade.includes('visibleItems.map('), false)
  assert.equal(bridge.includes('<XDriveFileExplorerItemSurface'), false)
  for(const forbidden of ['XDriveApi', 'OwnerJWT', 'ownerToken', 'onUpload=', 'onDeleteItems=',
    'onMoveItemsTo=', 'onDropItemsToFolder=', 'onPaste=', 'onRename='])
    assert.ok(!bridge.includes(forbidden), 'public Core cannot borrow Owner actions: ' + forbidden)
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
