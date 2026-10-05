const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'auth.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('shared auth helpers own common username/password validation and readiness', () => {
  for (const token of [
    'xDriveUsernameValidationError',
    "'请填写用户名'",
    "'用户名长度需要 3–64 个字符'",
    'xDrivePasswordValidationError',
    "'密码长度需要 8–128 个字符'",
    'xDriveLoginCredentialsReady',
    'requireServer = false',
    'passwordAvailable = false',
    "if (requireServer && !server?.trim()) return false",
    'Boolean(username.trim() && (password || passwordAvailable))',
  ]) {
    assert.ok(shared.includes(token), `shared auth helper missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './auth'"), 'shared auth helpers must be exported')
})

test('Web consumes shared login field validation instead of duplicating length rules', () => {
  assert.ok(web.includes('xDriveUsernameValidationError(loginUsername)'))
  assert.ok(web.includes('xDrivePasswordValidationError(password)'))
  assert.equal(web.includes("username.length < 3 || username.length > 64"), false)
  assert.equal(web.includes("password.length < 8 || password.length > 128"), false)
})

test('Desktop reuses shared readiness while preserving server and saved-password behavior', () => {
  assert.ok(desktop.includes('xDriveLoginCredentialsReady({'))
  assert.ok(desktop.includes('server,'))
  assert.ok(desktop.includes('passwordAvailable: savedPasswordAvailable'))
  assert.ok(desktop.includes('requireServer: true'))
  assert.ok(desktop.includes("setError('请输入服务器地址。')"), 'Desktop must keep its server-specific submit error')
  assert.ok(desktop.includes("setError('请输入用户名。')"), 'Desktop must keep its login-form submit error')
  assert.ok(desktop.includes("setError('请输入密码。')"), 'Desktop must keep saved-password-aware submit behavior')
  assert.ok(desktop.includes('use_saved_password: savedPasswordAvailable'), 'Desktop must keep secure credential reuse local')
  assert.ok(desktop.includes('remember_password: remember'), 'Desktop must keep secure credential persistence local')
  assert.ok(desktop.includes('auto_login: remember && autoLogin'), 'Desktop must keep auto-login policy local')
})
