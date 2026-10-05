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
const desktopCloud = read('desktop', 'src', 'renderer', 'DesktopFilesPage.tsx')
const desktopAdapters = read('desktop', 'src', 'renderer', 'fileDialogAdapters.ts')
const sharedAdapters = read('ui', 'shared', 'src', 'mui', 'FileDialogAdapters.ts')

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
    'createXDriveTrashDialogAdapter({',
    'listTrash: () => api.trash()',
    'restoreTrash: (nodeID, revision) => api.restoreTrash(nodeID, revision)',
    'deleteTrash: (nodeID, revision) => api.permanentlyDeleteTrash(nodeID, revision)',
    'createXDriveVersionHistoryDialogAdapter({',
    'listVersions: (nodeID) => api.versions(nodeID)',
    'api.restoreVersion(nodeID, revision, versionID)',
    'downloadVersion: (node, version) => api.downloadVersion(node, version)',
  ]) {
    assert.ok(webAdapters.includes(token), `Web file-dialog port mapping missing: ${token}`)
  }
})

test('Desktop delegates Trash and Version History to shared dialogs and IPC adapters', () => {
  assert.ok(desktopCloud.includes('<XDriveTrashDialog'), 'Desktop must render shared Trash dialog')
  assert.ok(desktopCloud.includes('<XDriveVersionHistoryDialog'), 'Desktop must render shared Version History dialog')
  assert.equal(desktopApp.includes('setCloudTrash('), false, 'Desktop must not keep local Trash list state')
  assert.equal(desktopApp.includes('setCloudVersions('), false, 'Desktop must not keep local Version list state')
  for (const token of [
    'createXDriveTrashDialogAdapter({',
    'agent().cloudTrash()',
    'agent().cloudRestoreTrash(nodeID, revision)',
    'agent().cloudDeleteTrash(nodeID, revision)',
    'createXDriveVersionHistoryDialogAdapter({',
    'agent().cloudVersions(nodeID)',
    'agent().cloudRestoreVersion(nodeID, revision, versionID)',
    'createXDriveShareDialogAdapter({',
    'agent().cloudShares(nodeID)',
    'agent().cloudCreateShare(nodeID, input)',
    'agent().cloudRevokeShare(shareID)',
  ]) {
    assert.ok(desktopAdapters.includes(token), `Desktop file-dialog port mapping missing: ${token}`)
  }
  assert.equal(
    fs.existsSync(path.join(repo, 'desktop', 'src', 'renderer', 'shareDialogAdapter.ts')),
    false,
    'Desktop must not keep a second standalone share adapter',
  )
})

test('shared file-dialog adapter factories own transport normalization', () => {
  for (const token of [
    'XDriveFileDialogTransportResult',
    'resolveXDriveFileDialogTransport',
    'error.code = result.error.code',
    'error.detail = result.error.detail',
    'createXDriveTrashDialogAdapter',
    'port.restoreTrash(node.id, node.revision)',
    'port.deleteTrash(node.id, node.revision)',
    'createXDriveVersionHistoryDialogAdapter',
    'port.restoreVersion(node.id, node.revision, version.id)',
    'createXDriveShareDialogAdapter',
    'port.createShare(nodeID, input)',
    'created.url || shareURL?.(created)',
  ]) {
    assert.ok(sharedAdapters.includes(token), `shared file-dialog factory missing: ${token}`)
  }
})

test('Web share adapter keeps only public URL specialization local', () => {
  assert.ok(webAdapters.includes('createXDriveShareDialogAdapter({'))
  assert.ok(webAdapters.includes('listShares: (nodeID) => api.shares(nodeID)'))
  assert.ok(webAdapters.includes('createShare: (nodeID, input) => api.createShare(nodeID, input)'))
  assert.ok(webAdapters.includes('revokeShare: (shareID) => api.revokeShare(shareID)'))
  assert.ok(webAdapters.includes('window.location.origin'))
  assert.ok(webAdapters.includes('created.token'))
})
