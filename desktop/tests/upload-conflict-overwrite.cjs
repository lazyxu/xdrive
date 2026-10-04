const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const model = read('ui', 'shared', 'src', 'upload-conflicts.ts')
const dialog = read('ui', 'shared', 'src', 'mui', 'UploadConflictDialog.tsx')
const uploadController = read('ui', 'shared', 'src', 'mui', 'FileExplorerUploadController.ts')
const webApp = read('web', 'src', 'App.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')

test('upload overwrite is file-only and shared across Web and Desktop', () => {
  for (const token of [
    "XDriveUploadConflictPolicy = 'fail' | 'skip' | 'keep_both' | 'overwrite'",
    "target_type?: 'file' | 'dir'",
    'can_overwrite?: boolean',
    'xDriveUploadConflictCanOverwrite',
  ]) {
    assert.ok(model.includes(token), `shared overwrite model missing: ${token}`)
  }
  for (const token of [
    'canOverwrite ? (',
    '旧版本会保留',
    '>替换</XDriveActionButton>',
    "onOverwrite: () => choose('overwrite')",
    "sticky !== 'overwrite' || nextCanOverwrite",
  ]) {
    assert.ok(dialog.includes(token), `shared overwrite dialog/resolver missing: ${token}`)
  }
  assert.ok(
    uploadController.includes('canOverwrite: xDriveUploadConflictCanOverwrite(conflict)'),
    'shared upload controller must derive file-only overwrite availability',
  )
  assert.equal(
    webApp.includes('xDriveUploadConflictCanOverwrite('),
    false,
    'Web must not duplicate overwrite eligibility',
  )
  assert.equal(
    desktopExplorer.includes('xDriveUploadConflictCanOverwrite('),
    false,
    'Desktop must not duplicate overwrite eligibility',
  )
})

test('Desktop overwrite policy crosses protected bridge', () => {
  for (const [label, source, tokens] of [
    ['preload', preload, ["'skip' | 'keep_both' | 'overwrite'"]],
    ['Electron main', desktopMain, ["policy !== 'overwrite'"]],
    ['Agent client', agentClient, ["can_overwrite?: boolean", "'skip' | 'keep_both' | 'overwrite'"]],
    ['Agent cloud adapter', agentCloud, ['UploadConflictPolicyOverwrite']],
    ['Agent IPC', agentIPC, ['input.ConflictPolicy != "overwrite"']],
  ]) {
    for (const token of tokens) {
      assert.ok(source.includes(token), `${label} overwrite bridge missing: ${token}`)
    }
  }
})
