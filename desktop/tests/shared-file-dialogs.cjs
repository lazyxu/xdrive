const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const trash = read('ui', 'shared', 'src', 'mui', 'TrashDialog.tsx')
const versions = read('ui', 'shared', 'src', 'mui', 'VersionHistoryDialog.tsx')
const webApp = read('web', 'src', 'App.tsx')
const webAdapters = read('web', 'src', 'fileDialogAdapters.ts')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopCloud = read('desktop', 'src', 'renderer', 'DesktopCloudPage.tsx')
const desktopAdapters = read('desktop', 'src', 'renderer', 'fileDialogAdapters.ts')

test('Trash dialog owns loading, restore and permanent-delete UI', () => {
  for (const token of [
    'XDriveTrashDialog',
    'adapter.listTrash()',
    'adapter.restoreTrash(node)',
    'adapter.deleteTrash(target)',
    '<XDriveConfirmDialog',
    '<XDriveTableSurface>',
    '正在加载回收站',
    '回收站为空',
    '永久删除',
  ]) {
    assert.ok(trash.includes(token), `shared Trash dialog missing: ${token}`)
  }
})

test('Version History dialog owns loading, download and restore UI', () => {
  for (const token of [
    'XDriveVersionHistoryDialog',
    'adapter.listVersions(nodeID)',
    'adapter.restoreVersion(currentNode, target)',
    'adapter.downloadVersion(currentNode, version)',
    '<XDriveConfirmDialog',
    '<XDriveTableSurface>',
    '正在加载历史版本',
    '暂无历史版本',
    '恢复版本',
  ]) {
    assert.ok(versions.includes(token), `shared Version History dialog missing: ${token}`)
  }
})

test('Web delegates Trash and Version History to shared dialogs', () => {
  assert.ok(webApp.includes('<XDriveTrashDialog'), 'Web must render shared Trash dialog')
  assert.ok(webApp.includes('<XDriveVersionHistoryDialog'), 'Web must render shared Version History dialog')
  assert.equal(webApp.includes('setTrashItems('), false, 'Web must not keep local Trash list state')
  assert.equal(webApp.includes('setVersions('), false, 'Web must not keep local Version list state')
  for (const token of [
    'api.trash()',
    'api.restoreTrash(node.id, node.revision)',
    'api.permanentlyDeleteTrash(node.id, node.revision)',
    'api.versions(nodeID)',
    'api.restoreVersion(node.id, node.revision, version.id)',
    'api.downloadVersion(node, version)',
  ]) {
    assert.ok(webAdapters.includes(token), `Web file-dialog adapter missing: ${token}`)
  }
})

test('Desktop delegates Trash and Version History to shared dialogs and IPC adapters', () => {
  assert.ok(desktopCloud.includes('<XDriveTrashDialog'), 'Desktop must render shared Trash dialog')
  assert.ok(desktopCloud.includes('<XDriveVersionHistoryDialog'), 'Desktop must render shared Version History dialog')
  assert.equal(desktopApp.includes('setCloudTrash('), false, 'Desktop must not keep local Trash list state')
  assert.equal(desktopApp.includes('setCloudVersions('), false, 'Desktop must not keep local Version list state')
  for (const token of [
    'cloudTrash()',
    'cloudRestoreTrash(node.id, node.revision)',
    'cloudDeleteTrash(node.id, node.revision)',
    'cloudVersions(nodeID)',
    'cloudRestoreVersion(node.id, node.revision, version.id)',
  ]) {
    assert.ok(desktopAdapters.includes(token), `Desktop file-dialog adapter missing: ${token}`)
  }
})
