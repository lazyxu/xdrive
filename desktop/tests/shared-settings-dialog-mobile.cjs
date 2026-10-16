const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const settings = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx'), 'utf8')
const dialogTitle = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'DialogTitle.tsx'), 'utf8')

test('shared compact-touch Dialog hook owns dynamic viewport and safe-area presentation', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    "height: '100dvh'",
    "minHeight: '100dvh'",
    "pt: 'env(safe-area-inset-top)'",
    "pb: 'env(safe-area-inset-bottom)'",
    'width: 44',
    'height: 44',
    'return { compactTouch, dialogPaper }',
  ]) {
    assert.ok(dialogTitle.includes(token), 'shared compact Dialog contract missing: ' + token)
  }
})

test('shared Settings consumes the compact-touch Dialog hook', () => {
  assert.ok(settings.includes('useXDriveCompactTouchDialog()'))
  assert.ok(settings.includes('fullScreen={compactTouch}'))
  assert.ok(settings.includes('slotProps={{ paper: dialogPaper }}'))
})

test('desktop Settings keeps maxWidth and paper-scroll semantics', () => {
  assert.ok(settings.includes('maxWidth={maxWidth}'))
  assert.ok(settings.includes("maxWidth = 'md'"))
  assert.ok(settings.includes('scroll="paper"'))
  assert.ok(dialogTitle.includes(': xDriveDialogPaperProps'))
})

test('M02/M04 a shrinking dynamic viewport does not inherit a larger 100vh floor', () => {
  assert.ok(dialogTitle.includes("height: '100dvh'"))
  assert.ok(dialogTitle.includes("minHeight: '100dvh'"))
  assert.ok(!dialogTitle.includes("minHeight: '100vh'"), 'layout viewport must not force the Dialog footer offscreen')
  const dialogContent = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'DialogContent.tsx'), 'utf8')
  const dialogActions = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'DialogActions.tsx'), 'utf8')
  const destination = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerDestinationDialog.tsx'), 'utf8')
  assert.match(dialogContent, /overflowY: 'auto'/, 'long paths/errors scroll inside content')
  assert.match(dialogActions, /flexWrap: \{ xs: 'wrap'/, 'long buttons wrap within persistent actions footer')
  assert.match(destination, /<XDriveDialogContent dividers>/)
  assert.match(destination, /<XDriveDialogActions>/)
  assert.match(destination, /fullScreen=\{compactTouch\}/)
  assert.match(destination, /\{submitting \? '正在提交任务…' : `\$\{verb\}到这里`\}/)
})
