const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
const explorerCore = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const sharedIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer actions own common menu labels, icons and ordering', () => {
  for (const token of [
    'xDriveFileExplorerStandardItemMenuItems',
    'xDriveFileExplorerBackgroundMenuItems',
    'XDriveFileExplorerTrashCommandButton',
    "id: 'open'",
    "label: '打开'",
    "id: 'download'",
    "label: '分享'",
    "label: '历史版本'",
    "label: '重命名'",
    "label: '删除'",
    "label: '新建文件夹'",
    "label: '上传文件'",
    "label: '刷新'",
    '回收站',
    'FolderOpenRoundedIcon',
    'OpenInNewRoundedIcon',
    'DownloadRoundedIcon',
    'ShareRoundedIcon',
    'HistoryRoundedIcon',
    'EditRoundedIcon',
    'DeleteOutlineRoundedIcon',
    'CreateNewFolderRoundedIcon',
    'UploadRoundedIcon',
    'RefreshRoundedIcon',
    'RestoreFromTrashRoundedIcon',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer actions missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './FileExplorerActions'"), 'shared FileExplorer actions must be exported')
})

test('Web and Desktop consume shared FileExplorer menu/action presentation', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerStandardItemMenuItems({'), `${label} must use shared item-menu presentation`)
    assert.ok(source.includes('xDriveFileExplorerBackgroundMenuItems({'), `${label} must use shared background-menu presentation`)
    assert.equal(source.includes('<XDriveFileExplorerTrashCommandButton'), false, `${label} must not keep the old Trash command button`)
    assert.ok(source.includes('onNavigateTrash={() => {\n              beginNavigationIntent()\n              onOpenTrash()\n            }}'), `${label} must expose Trash through the shared navigation pane`)
    assert.equal(source.includes('RestoreFromTrashRoundedIcon'), false, `${label} must not own the Trash icon`)
    assert.equal(source.includes('CreateNewFolderRoundedIcon'), false, `${label} must not own the common background-menu icons`)
    assert.equal(source.includes('DeleteOutlineRoundedIcon'), false, `${label} must not own the common destructive menu icon`)
  }
  assert.ok(web.includes('onDownload: () => { void downloadSelected([item]) }'), 'Web must keep its file/folder download adapter')
  assert.ok(web.includes("onShare: node.type === 'file'"), 'Web must keep its share adapter')
  assert.ok(desktop.includes("downloadLabel: node.type === 'file' ? '另存为…' : '下载到…'"), 'Desktop must preserve Save As for files and destination download wording for folders')
  assert.ok(desktop.includes('onReveal: () => { void openLocalNode(node, true) }'), 'Desktop must preserve native reveal action')
  assert.ok(desktop.includes('primaryDisabled: explorerActionBusy'), 'Desktop must preserve native and queued-operation busy gating')
})

test('shared FileExplorer keeps a stable selection-aware command bar', () => {
  const start = explorerCore.indexOf('data-xdrive-file-explorer-command-bar')
  const end = explorerCore.indexOf('anchorEl={commandBarOverflowAnchor}', start)
  assert.ok(start >= 0 && end > start, 'stable Command Bar markers are missing')
  const commandBar = explorerCore.slice(start, end)

  for (const token of [
    'startIcon={<ContentCutRoundedIcon />}',
    'startIcon={<ContentCopyRoundedIcon />}',
    'startIcon={<ContentPasteRoundedIcon />}',
    'startIcon={<DownloadRoundedIcon />}',
    'startIcon={<DeleteOutlineRoundedIcon />}',
    'disabled={selectedItems.length === 0}',
    'disabled={!canPaste}',
    '新建文件夹',
    '上传文件',
  ]) {
    assert.ok(commandBar.includes(token), `stable command bar missing: ${token}`)
  }

  assert.equal(commandBar.includes('selectedItems.length > 0 ? ('), false, 'selection must not replace the whole Command Bar')
  assert.equal(commandBar.includes('取消选择'), false, 'selection summary/clear affordance belongs outside the stable Command Bar')
})
