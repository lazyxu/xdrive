const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')

const dialog = read('ui', 'shared', 'src', 'mui', 'FileNameDialog.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webApp = read('web', 'src', 'App.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileNameDialog owns create/rename/saved-search validation and loading UI', () => {
  for (const token of [
    "export type XDriveFileNameDialogMode = 'create-folder' | 'rename' | 'saved-search'",
    'export function XDriveFileNameDialog({',
    "mode === 'saved-search' ? '保存搜索'",
    "'智能文件夹名称'",
    "'智能文件夹名称不能超过 128 个字符'",
    '请填写文件夹名称',
    '请填写名称',
    '不能超过 255 个字符',
    'const [submitting, setSubmitting] = useState(false)',
    'loading={submitting}',
    'closeDisabled={submitting}',
    'await onSubmit(normalized)',
    'onError?.(submitError)',
  ]) {
    assert.ok(dialog.includes(token), `shared FileNameDialog missing: ${token}`)
  }
  assert.ok(index.includes("export * from './FileNameDialog'"), 'shared MUI index must export FileNameDialog')
})

test('Web keeps only create-folder in shared FileNameDialog after rename moves inline', () => {
  assert.equal((webApp.match(/<XDriveFileNameDialog\b/g) || []).length, 1, 'Web should keep one shared create-folder dialog')
  assert.ok(webApp.includes('onSubmit={createFolder}'), 'Web create-folder dialog must call createFolder')
  assert.equal(webApp.includes('mode="rename"'), false, 'Web rename must no longer use FileNameDialog')
  assert.equal(webApp.includes('folderNameError'), false, 'Web must not keep local create-folder validation state')
  assert.equal(webApp.includes('renameNameError'), false, 'Web must not keep local rename validation state')
  assert.equal(/<Dialog open=\{folderOpen\}/.test(webApp), false, 'Web must not keep its local create-folder Dialog')
})

test('Desktop uses shared FileNameDialog for create-folder and Smart Folder naming while rename stays inline', () => {
  assert.equal((desktopExplorer.match(/<XDriveFileNameDialog\b/g) || []).length, 3, 'Desktop should use shared dialogs for create-folder, Smart Folder create and Smart Folder rename')
  assert.ok(desktopExplorer.includes('onSubmit={createFolder}'), 'Desktop create-folder dialog must call createFolder')
  assert.equal((desktopExplorer.match(/mode="saved-search"/g) || []).length, 2, 'Desktop Smart Folder create/rename must reuse the shared name dialog')
  assert.equal(desktopExplorer.includes('mode="rename"'), false, 'Desktop file rename must remain inline')
  assert.equal(desktopExplorer.includes('createError'), false, 'Desktop must not keep local create-folder validation state')
  assert.equal(desktopExplorer.includes('renameNode'), false, 'Desktop must not keep rename-dialog state')
  assert.equal(/<Dialog\b/.test(desktopExplorer), false, 'Desktop FileExplorer must not keep raw local Dialog shells')
})
