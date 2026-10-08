const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'LocalStoragePage.tsx'), 'utf8')

test('local storage folder policies move below the folder row on narrow screens', () => {
  for (const token of [
    "display: { xs: 'grid', sm: 'flex' }",
    "gridTemplateColumns: { xs: 'auto auto minmax(0, 1fr)', sm: undefined }",
    "gridColumn: { xs: '1 / -1', sm: 'auto' }",
    'useFlexGap',
    'flexWrap="wrap"',
  ]) {
    assert.ok(source.includes(token), 'mobile local-storage row contract missing: ' + token)
  }
})

test('local storage expand target is touch-sized only on narrow screens', () => {
  assert.ok(source.includes("width: { xs: 44, sm: 28 }"))
  assert.ok(source.includes("height: { xs: 44, sm: 28 }"))
})

test('local storage policy semantics remain unchanged', () => {
  for (const token of [
    "(['default', 'exclude', 'always-local'] as XDriveLocalStorageMode[])",
    'onModeChange(node.path, mode)',
    "node.mode === mode ? 'primary' : 'secondary'",
    "继承：' + modeLabel(node.effective_mode)",
  ]) {
    assert.ok(source.includes(token), 'local-storage policy contract missing: ' + token)
  }
})
