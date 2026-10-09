const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const repoRoot = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')

const dialog = read('ui', 'shared', 'src', 'mui', 'FileNameDialog.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webApp = read('web', 'src', 'App.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const moduleOutput = { exports: {} }
const bundled = buildSync({
  entryPoints: [path.join(repoRoot, 'ui/shared/src/mui/FileNameDialog.tsx')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
})
const requireShared = (name) => name.startsWith('@mui/icons-material/') ? require(name).default : require(name)
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(moduleOutput, moduleOutput.exports, requireShared)
const validateName = moduleOutput.exports.xDriveFileNameValidationError

test('shared FileNameDialog owns create/rename/saved-search validation and loading UI', () => {
  for (const token of [
    "export type XDriveFileNameDialogMode = 'create-folder' | 'rename' | 'saved-search'",
    'export function XDriveFileNameDialog({',
    "mode === 'saved-search' ? '保存搜索'",
    "'智能文件夹名称'",
    '请填写文件夹名称',
    '请填写名称',
    'xDriveFileNameValidationError(normalized, mode)',
    'XDriveFileNameDialogView',
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

test('file names follow the Server 255 UTF-8 byte boundary without truncating Unicode', () => {
  assert.equal(validateName('a'.repeat(255), 'rename'), '')
  assert.match(validateName('a'.repeat(256), 'rename'), /255.*字节/)
  assert.equal(validateName('图'.repeat(85), 'rename'), '')
  assert.match(validateName('图'.repeat(84) + '.txt', 'rename'), /255.*字节/)
  assert.equal(validateName('📷'.repeat(63) + '.js', 'create-folder'), '')
  assert.match(validateName('📷'.repeat(64), 'create-folder'), /255.*字节/)
})

test('saved-search names use their own 128 UTF-8 byte limit', () => {
  assert.equal(validateName('相'.repeat(42) + '片1', 'rename'), '')
  assert.match(validateName('相'.repeat(42) + '片1', 'saved-search'), /128.*字节/)
  assert.equal(validateName('相'.repeat(42) + 'ab', 'saved-search'), '')
})

test('name validation preserves existing trim and required-name semantics', () => {
  assert.equal(validateName('  报告.txt  ', 'rename'), '')
  assert.equal(validateName(' \n ', 'rename'), '请填写名称')
  assert.equal(validateName(' \t ', 'create-folder'), '请填写文件夹名称')
  assert.equal(validateName('', 'saved-search'), '请填写名称')
})

test('Web keeps create-folder in FileNameDialog while shared FileExplorer owns responsive rename', () => {
  assert.equal((webApp.match(/<XDriveFileNameDialog\b/g) || []).length, 1, 'Web should keep one shared create-folder dialog')
  assert.ok(webApp.includes('onSubmit={createFolder}'), 'Web create-folder dialog must call createFolder')
  assert.equal(webApp.includes('mode="rename"'), false, 'Web App must not duplicate FileExplorer rename state')
  assert.equal(webApp.includes('folderNameError'), false, 'Web must not keep local create-folder validation state')
  assert.equal(webApp.includes('renameNameError'), false, 'Web must not keep local rename validation state')
  assert.equal(/<Dialog open=\{folderOpen\}/.test(webApp), false, 'Web must not keep its local create-folder Dialog')
})

test('Desktop uses shared name dialogs while FileExplorer owns responsive rename', () => {
  assert.equal((desktopExplorer.match(/<XDriveFileNameDialog\b/g) || []).length, 3, 'Desktop should use shared dialogs for create-folder, Smart Folder create and Smart Folder rename')
  assert.ok(desktopExplorer.includes('onSubmit={createFolder}'), 'Desktop create-folder dialog must call createFolder')
  assert.equal((desktopExplorer.match(/mode="saved-search"/g) || []).length, 2, 'Desktop Smart Folder create/rename must reuse the shared name dialog')
  assert.equal(desktopExplorer.includes('mode="rename"'), false, 'Desktop adapter must not duplicate FileExplorer rename state')
  assert.equal(desktopExplorer.includes('createError'), false, 'Desktop must not keep local create-folder validation state')
  assert.equal(desktopExplorer.includes('renameNode'), false, 'Desktop must not keep rename-dialog state')
  assert.equal(/<Dialog\b/.test(desktopExplorer), false, 'Desktop FileExplorer must not keep raw local Dialog shells')
})
