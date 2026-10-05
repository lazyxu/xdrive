const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'PasswordChangeForm.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')

test('shared password-change form owns the common MUI fields and validation contract', () => {
  for (const token of [
    'XDrivePasswordChangeForm',
    'xDrivePasswordChangeValidationError',
    '当前密码',
    '新密码',
    '确认新密码',
    '请填写当前密码',
    '新密码至少需要 8 个字符',
    '两次输入的新密码不一致',
    'minLength={8}',
    'XDriveActionButton',
  ]) {
    assert.ok(shared.includes(token), `shared password-change form missing: ${token}`)
  }
})

test('Web and Desktop both use the shared password-change form', () => {
  assert.equal((web.match(/<XDrivePasswordChangeForm\b/g) || []).length, 1, 'Web must use the shared password-change form')
  assert.equal((desktop.match(/<XDrivePasswordChangeForm\b/g) || []).length, 1, 'Desktop must use the shared password-change form')
  assert.ok(web.includes('xDrivePasswordChangeValidationError(passwordValues)'), 'Web must use the shared password validation')
  assert.ok(desktop.includes('xDrivePasswordChangeValidationError({'), 'Desktop must use the shared password validation')
  assert.equal(web.includes('label="当前密码"'), false, 'Web must not keep a local current-password field')
  assert.equal(desktop.includes('label="当前密码"'), false, 'Desktop must not keep a local current-password field')
})
