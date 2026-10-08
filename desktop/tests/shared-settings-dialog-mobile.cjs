const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const settings = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx'), 'utf8')

test('shared Settings uses full dynamic viewport only on compact touch', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'fullScreen={compactTouch}',
    "height: '100dvh'",
    "minHeight: '100vh'",
    "pt: 'env(safe-area-inset-top)'",
    "pb: 'env(safe-area-inset-bottom)'",
    'width: 44',
    'height: 44',
  ]) {
    assert.ok(settings.includes(token), 'mobile Settings contract missing: ' + token)
  }
})

test('desktop Settings keeps the existing shared dialog paper and maxWidth contract', () => {
  assert.ok(settings.includes(': xDriveDialogPaperProps'))
  assert.ok(settings.includes('maxWidth={maxWidth}'))
  assert.ok(settings.includes("maxWidth = 'md'"))
  assert.ok(settings.includes('scroll="paper"'))
})
