const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const web = fs.readFileSync(path.join(__dirname, '../../web/src/App.tsx'), 'utf8')
const android = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/com/tfluid/xdrive/AuthScreens.kt'), 'utf8')

test('Browser keep-login does not persist tokens after user opt-out', () => {
  assert.ok(web.includes("const REMEMBER_LOGIN_KEY = 'xdrive.remember_login'"))
  assert.ok(web.includes("if (xDriveBrowserStorageRead(REMEMBER_LOGIN_KEY) === 'false')"))
  assert.ok(web.includes('if (!persist) {'))
  assert.ok(web.includes('xDriveBrowserStorageRemove(AUTH_STORAGE_KEYS)'))
  assert.ok(web.includes('label="保持登录"'))
})

test('Existing Web/PWA connection and offline-history entry points stay unchanged', () => {
  assert.ok(web.includes('data-xdrive-manual-connection-login'))
  assert.ok(web.includes('data-xdrive-manual-connection-menu'))
  assert.ok(web.includes('data-xdrive-pwa-offline-login-entry'))
  assert.ok(web.includes("window.location.hash === '#/offline/files'"))
})

test('Android login now matches Desktop connection inputs and uses system password autofill', () => {
  assert.ok(android.includes('internal fun UnifiedLoginForm('))
  assert.ok(android.includes('AuthField("服务器",'))
  assert.ok(android.includes('AuthField("内网 IP（可选）"'))
  assert.ok(android.includes('Text("保持登录"'))
  assert.ok(android.includes('ContentType.Username'))
  assert.ok(android.includes('ContentType.Password'))
  assert.equal(android.includes('内网 IP（仅内网必填）'), false)
  assert.equal(android.includes('公网 IP（可选）'), false)
})
