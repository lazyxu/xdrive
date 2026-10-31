'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const model = fs.readFileSync(path.join(root, 'web/src/loginProfiles.ts'), 'utf8')
const login = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')

function harness() {
  const stored = new Map()
  let denyWrites = false
  const storage = {
    xDriveBrowserStorageRead: key => stored.get(key) ?? null,
    xDriveBrowserStorageWrite: (key, value) => {
      if (denyWrites) return false
      stored.set(key, value)
      return true
    },
    xDriveBrowserStorageRemove: key => {
      if (denyWrites) return false
      stored.delete(key)
      return true
    },
  }
  const code = ts.transpileModule(model, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exposed = {}
  const requireStorage = id => {
    assert.equal(id, './browserSafeStorage')
    return storage
  }
  new Function('exports', 'require', code)(exposed, requireStorage)
  return { stored, profile: exposed, setDenied: value => { denyWrites = value } }
}

test('names stay bounded and isolated to this Origin, with newest first', () => {
  const { profile } = harness()
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), [])
  for (let i = 0; i < 12; i++) {
    assert.equal(profile.xDriveRememberWebLoginUsername('owner-' + i), true)
  }
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(),
    Array.from({ length: 8 }, (_, i) => 'owner-' + (11 - i)))
  profile.xDriveRememberWebLoginUsername('owner-7')
  assert.equal(profile.xDriveReadWebLoginUsernames()[0], 'owner-7')
  assert.equal(profile.xDriveReadWebLoginUsernames().filter(n => n === 'owner-7').length, 1)
})

test('reject secret-bearing or corrupt/oversized usernames before rendering', () => {
  const { profile, stored } = harness()
  for (const item of ['', ' bad', 'bad ', 'a\\nb', 'a\\u0000b', 'x'.repeat(129)]) {
    const username = item.replace('\\n', '\n').replace('\\u0000', '\u0000')
    assert.equal(profile.xDriveRememberWebLoginUsername(username), false)
  }
  stored.set('xdrive.login_usernames.v1', JSON.stringify([
    'safe', 'safe', 'bad\nline', 'x'.repeat(130), 1, {}, null, 'safe2',
  ]))
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), ['safe', 'safe2'])
  stored.set('xdrive.login_usernames.v1', '[bad')
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), [])
  stored.set('xdrive.login_usernames.v1', '[]'.repeat(4000))
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), [])
})

test('forget single username, preserving cookies, Owner and other suggestions', () => {
  const { profile, stored, setDenied } = harness()
  stored.set('xdrive.auth_cookie_mode', 'cookie')
  stored.set('xdrive.username', 'owner-a')
  stored.set('xdrive.auth_cookie_logout_pending', '1:opaque')
  profile.xDriveRememberWebLoginUsername('owner-a')
  profile.xDriveRememberWebLoginUsername('owner-b')
  assert.equal(profile.xDriveForgetWebLoginUsername('owner-a'), true)
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), ['owner-b'])
  assert.equal(stored.get('xdrive.username'), 'owner-a')
  assert.equal(stored.get('xdrive.auth_cookie_mode'), 'cookie')
  assert.equal(stored.get('xdrive.auth_cookie_logout_pending'), '1:opaque')
  setDenied(true)
  assert.equal(profile.xDriveForgetWebLoginUsername('owner-b'), false)
  assert.deepEqual(profile.xDriveReadWebLoginUsernames(), ['owner-b'])
})

test('login suggestions are never durable passwords and do not migrate between Origins', () => {
  assert.match(login, /xDriveRememberWebLoginUsername\(result\.username\)/)
  assert.match(login, /xDriveForgetWebLoginUsername\(selected\)/)
  assert.match(login, /data-xdrive-login-forget-username/)
  assert.match(login, /options=\{rememberedUsernames\}/)
  // Autocomplete owns the actual textbox ID. Putting it only on TextField
  // can leave a generated Mui ID and break the real Chromium login contract.
  assert.match(login, /<Autocomplete\s+id="web-login-username"/)
  assert.match(login, /if \(reason !== 'reset'\) editLoginUsername\(value\)/)
  assert.match(login, /setPassword\(''\)/)
  assert.match(login, /xDriveBrowserStorageRemove\(LOGIN_DRAFT_USERNAME_KEY\)/)
  assert.doesNotMatch(model, /localStorage/)
  assert.doesNotMatch(model, /refreshToken:|accessToken:|password:/)
  assert.match(login, /if \(session\.username\) xDriveBrowserStorageWrite\(COOKIE_LOGOUT_OWNER_KEY, session\.username\)/)
})
