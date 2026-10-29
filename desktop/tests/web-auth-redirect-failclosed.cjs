const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const api = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
const safeRead = fs.readFileSync(path.join(root, 'web/src/pwaSafeReadRetry.ts'), 'utf8')

function section(start, end) {
  const from = api.indexOf(start)
  const to = api.indexOf(end, from + start.length)
  assert.ok(from !== -1 && to > from, 'missing auth operation ' + start)
  return api.slice(from, to)
}

test('Web/Mobile/PWA login sends no password to HTTP redirect destinations', () => {
  const login = section('  async login(username: string, password: string, rememberLogin = false)', '  async logout()')
  assert.match(login, /redirect:\s*'error'/)
  assert.match(login, /return this\.request<AuthResult>\('\/api\/v1\/auth\/login'/)
})

test('refresh and logout never forward refresh tokens through redirects', () => {
  const refresh = section('  private async refresh(', '  private async ensureFresh(')
  const logout = section('  async logout()', '  me(signal?: AbortSignal)')
  for (const operation of [refresh, logout]) {
    assert.match(operation, /redirect:\s*'error'/)
    assert.match(operation, /refresh_token:/)
  }
})

test('Web sensitive authentication requests do not enable PWA read retry or redirect overrides', () => {
  assert.match(safeRead, /return send\(url, init\)/)
  assert.match(safeRead, /\(init\.method \?\? 'GET'\)\.toUpperCase\(\) === 'GET'/)
  const request = section('  private async request<T>(', '  async serverVersion()')
  assert.match(request, /xDriveFetchPwaSafeRead\(\x60\$\{API_BASE\}\$\{path\}\x60, path, \{ \.\.\.init, headers \}\)/)
  assert.match(request, /fetch\(\x60\$\{API_BASE\}\$\{path\}\x60, \{ \.\.\.init, headers: retryHeaders \}\)/)
})

test('Web sign-out settles locally even if remote logout is rejected by redirect policy', () => {
  const app = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
  assert.match(app, /clearSession\(\) \/\/ Owner UI is immediately hidden/)
  assert.match(app, /void api\.logout\(\)\.then\(\(\) => \{/)
  assert.match(app, /\.catch\(\(\) => \{/)
  assert.match(app, /\.finally\(\(\) => setLogoutInProgress\(false\)\)/)
})

test('Web/Mobile/PWA password change also blocks redirects of old and new passwords', () => {
  // Match the method boundary independently of optional GET parameters.
  // Redirect security assertions below remain unchanged.
  const change = section('  async changePassword(currentPassword: string, newPassword: string)', '  adminUsers(')
  assert.match(change, /redirect:\s*'error'/)
  assert.match(change, /current_password: currentPassword, new_password: newPassword/)
})
