const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8')

const ios = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const iosDraft = read('ios/XDriveIOS/NativeLoginDraftStore.swift')
const android = read('android/app/src/main/java/com/tfluid/xdrive/DriveController.kt')
const androidHost = read('android/app/src/main/java/com/tfluid/xdrive/MainActivity.kt')

test('iOS keeps password editable on failed sign-in, not after verified success', () => {
  const signIn = ios.split('func signIn() async {')[1].split('func signOut() async -> Bool')[0]
  assert.ok(signIn.includes('XDriveIOSNativeLoginDraftStore.save('))
  assert.match(signIn, /owner = verified\s+password = ""/)
  assert.doesNotMatch(signIn, /catch is CancellationError \{\s*password = ""/)
  assert.doesNotMatch(signIn, /\} catch \{\s*password = ""/)
  assert.ok(ios.includes('matchesRestoredEndpoint'))
  assert.ok(ios.includes('lanIPText = draft.lanIP'))
  assert.ok(ios.includes('username = draft.username'))
})

test('iOS draft stores only bounded non-secret fields, never session credentials', () => {
  assert.match(iosDraft, /let server: String/)
  assert.match(iosDraft, /let lanIP: String/)
  assert.match(iosDraft, /let username: String/)
  assert.equal(/password|refreshToken|accessToken/i.test(iosDraft), true, 'security comment should document boundary')
  assert.doesNotMatch(iosDraft, /let (?:password|refreshToken|accessToken):/)
  assert.ok(iosDraft.includes('UserDefaults.standard.set(bytes, forKey: key)'))
})

test('Android upgrades a legacy remembered session without losing the username on 401', () => {
  const restore = android.split('fun restoreSession() {')[1].split('fun connectAndLogin(')[0]
  assert.ok(restore.includes('state.value.username.isBlank()'))
  assert.ok(restore.includes('state.value.server == server.url'))
  assert.ok(restore.includes('saveLoginDraft(server.url, route.lanIp, saved.username)'))
  assert.ok(restore.indexOf('saveLoginDraft(server.url') < restore.indexOf('vault.coordinatedRefresh('))
})

test('Android saves a non-secret draft before network login and keeps username after 401', () => {
  assert.ok(android.includes('initialUsername: String = ""'))
  assert.ok(android.includes('saveLoginDraft(next.url, route.lanIp, username.trim())'))
  assert.ok(android.indexOf('saveLoginDraft(next.url') < android.indexOf('val candidate = if (ip == null)'))
  assert.ok(android.includes('route = state.value.route, username = state.value.username,'))
  assert.ok(android.includes('username = if (changeServer) "" else state.value.username'))
  for (const key of ['login.draft.server', 'login.draft.lan-ip', 'login.draft.username']) {
    assert.ok(androidHost.includes(key), 'Missing independent Android login field: ' + key)
  }
  assert.doesNotMatch(androidHost, /putString\("login\.draft\.password"/)
})
