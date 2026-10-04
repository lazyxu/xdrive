const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const model = read('ui', 'shared', 'src', 'upload-conflicts.ts')
const dialog = read('ui', 'shared', 'src', 'mui', 'UploadConflictDialog.tsx')
const uploadController = read('ui', 'shared', 'src', 'mui', 'FileExplorerUploadController.ts')
const muiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')

test('shared upload conflict resolver owns dialog choice and apply-to-remaining state', () => {
  for (const token of [
    'XDriveUploadConflictDecision',
    'xDriveUploadBatchSummary',
    'useXDriveUploadConflictResolver',
    'stickyPolicyRef',
    'batchActiveRef',
    'if (batchActiveRef.current) return false',
    "if (pendingRef.current) return Promise.resolve<XDriveUploadConflictDecision>('cancel')",
    'applyToRemaining',
    "pendingRef.current?.resolve('cancel')",
    '对本次剩余同名文件执行相同操作',
    '跳过',
    '保留两者',
    '取消本次上传',
  ]) {
    assert.ok((model + dialog).includes(token), `missing shared upload conflict behavior: ${token}`)
  }
  assert.ok(muiIndex.includes("export * from './UploadConflictDialog'"), 'shared upload conflict dialog is not exported')
  for (const token of [
    'useXDriveFileExplorerUploadController',
    'useXDriveUploadConflictResolver()',
    'if (!conflicts.beginBatch())',
    'conflicts.resolveConflict(name',
    'xDriveUploadConflictCanOverwrite(conflict)',
    "if (conflictPolicy === 'skip')",
    'continueOnUploadError',
    'xDriveUploadBatchSummary(result)',
    'dialogProps: conflicts.dialogProps',
  ]) {
    assert.ok(uploadController.includes(token), `shared upload batch controller missing: ${token}`)
  }
  assert.ok(muiIndex.includes("export * from './FileExplorerUploadController'"), 'shared upload batch controller is not exported')
})

test('Desktop policy-aware upload keeps one protected bridge and the old fallback', () => {
  for (const [label, source, tokens] of [
    ['preload', preload, ['cloudUploadFile:', 'webUtils.getPathForFile', 'agent:cloud-upload-file']],
    ['Electron main', main, ['agent:cloud-upload-file', "upload-conflict-policy", 'cloudUploadWithConflictPolicy']],
    ['Agent client', agentClient, ['cloudUploadWithConflictPolicy', '/v1/cloud/upload/conflict', 'conflict_policy']],
    ['Agent controller', agentCloud, ['CloudUploadWithConflictPolicy', 'UploadFileResumableWithConflictPolicyResult', 'CompleteSkipped']],
    ['Agent IPC', agentIPC, ['upload-conflict-policy', '/v1/cloud/upload/conflict', 'CloudUploadWithConflictPolicy']],
  ]) {
    for (const token of tokens) {
      assert.ok(source.includes(token), `${label} missing upload conflict bridge: ${token}`)
    }
  }
  assert.ok(main.includes("ipcMain.handle('agent:cloud-upload-files'"), 'legacy native batch upload fallback must remain')
})


test('preflight skip stays inside the shared upload controller before platform upload bridges', () => {
  const webApp = read('web', 'src', 'App.tsx')
  const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const skip = uploadController.indexOf("if (conflictPolicy === 'skip')")
  const upload = uploadController.indexOf('const result = await upload(', skip)
  assert.ok(skip >= 0, 'shared upload controller skip guard is missing')
  assert.ok(upload > skip, 'shared upload transport call must remain after the skip guard')
  assert.ok(uploadController.slice(skip, upload).includes('continue'), 'skip must short-circuit before upload/hash work')
  assert.ok(webApp.includes('api.uploadWithConflictPolicy(parentID, file, conflictPolicy, onProgress)'), 'Web must keep its upload transport adapter local')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudUploadFile('), 'Desktop must keep its upload transport adapter local')
})

