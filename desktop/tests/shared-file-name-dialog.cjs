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

test('shared FileNameDialog owns create/rename validation and loading UI', () => {
  for (const token of [
    "export type XDriveFileNameDialogMode = 'create-folder' | 'rename'",
    'export function XDriveFileNameDialog({',
    "mode === 'create-folder' ? '新建文件夹' : '重命名'",
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

test('Web delegates create-folder and rename dialogs to shared FileNameDialog', () => {
  assert.ok((webApp.match(/<XDriveFileNameDialog\b/g) || []).length === 2, 'Web should render two shared name dialogs')
  assert.ok(webApp.includes('onSubmit={createFolder}'), 'Web create-folder dialog must call createFolder')
  assert.ok(webApp.includes('onSubmit={rename}'), 'Web rename dialog must call rename')
  assert.equal(webApp.includes('folderNameError'), false, 'Web must not keep local create-folder validation state')
  assert.equal(webApp.includes('renameNameError'), false, 'Web must not keep local rename validation state')
  assert.equal(/<Dialog open=\{folderOpen\}/.test(webApp), false, 'Web must not keep its local create-folder Dialog')
})

test('Desktop delegates create-folder and rename dialogs to shared FileNameDialog', () => {
  assert.ok((desktopExplorer.match(/<XDriveFileNameDialog\b/g) || []).length === 2, 'Desktop should render two shared name dialogs')
  assert.ok(desktopExplorer.includes('onSubmit={createFolder}'), 'Desktop create-folder dialog must call createFolder')
  assert.ok(desktopExplorer.includes('onSubmit={rename}'), 'Desktop rename dialog must call rename')
  assert.equal(desktopExplorer.includes('createError'), false, 'Desktop must not keep local create-folder validation state')
  assert.equal(desktopExplorer.includes('renameError'), false, 'Desktop must not keep local rename validation state')
  assert.equal(/<Dialog\b/.test(desktopExplorer), false, 'Desktop FileExplorer must not keep raw local Dialog shells')
})
