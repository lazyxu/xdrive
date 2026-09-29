const test = require('node:test')
const assert = require('node:assert/strict')

const {
  automaticLoginProfile,
  disableAutomaticLogin,
  normalizeLoginHistory,
  publicLoginHistory,
  recordSuccessfulLogin,
  replaceSavedPassword,
} = require('../dist/main/login_history.cjs')

test('login history normalizes, de-duplicates and sorts newest first', () => {
  const history = normalizeLoginHistory({
    profiles: [
      {
        server: ' https://one.example ',
        username: ' alice ',
        last_used_at: '2026-09-01T00:00:00Z',
        remember_password: true,
        auto_login: true,
        encrypted_password: 'old',
      },
      {
        server: 'https://two.example',
        username: 'bob',
        last_used_at: '2026-09-03T00:00:00Z',
        remember_password: false,
        auto_login: false,
      },
      {
        server: 'https://one.example',
        username: 'alice',
        last_used_at: '2026-09-02T00:00:00Z',
        remember_password: true,
        auto_login: true,
        encrypted_password: 'new',
      },
      { server: '', username: 'bad', last_used_at: '2026-09-04T00:00:00Z' },
    ],
  })

  assert.deepEqual(history.profiles.map((profile) => [profile.server, profile.username]), [
    ['https://two.example', 'bob'],
    ['https://one.example', 'alice'],
  ])
  assert.equal(history.profiles[1].encrypted_password, 'new')
  assert.equal(history.profiles[1].auto_login, true)
})

test('successful login moves the profile to the front and makes auto-login unique', () => {
  const initial = normalizeLoginHistory({
    profiles: [
      {
        server: 'https://old.example',
        username: 'old',
        last_used_at: '2026-09-01T00:00:00Z',
        remember_password: true,
        auto_login: true,
        encrypted_password: 'old-secret',
      },
    ],
  })

  const updated = recordSuccessfulLogin(initial, {
    server: 'https://new.example',
    username: 'new',
    mount_path: '/data/xdrive',
    last_used_at: '2026-09-05T00:00:00Z',
    remember_password: true,
    auto_login: true,
    encrypted_password: 'new-secret',
  })

  assert.equal(updated.profiles[0].server, 'https://new.example')
  assert.equal(updated.profiles[0].mount_path, '/data/xdrive')
  assert.equal(updated.profiles[0].auto_login, true)
  assert.equal(updated.profiles[1].auto_login, false)
  assert.equal(automaticLoginProfile(updated)?.username, 'new')
})

test('public history never exposes encrypted passwords and hides unavailable secure credentials', () => {
  const history = normalizeLoginHistory({
    profiles: [{
      server: 'https://one.example',
      username: 'alice',
      last_used_at: '2026-09-02T00:00:00Z',
      remember_password: true,
      auto_login: true,
      encrypted_password: 'ciphertext',
    }],
  })

  const secure = publicLoginHistory(history, true)
  assert.equal(secure.profiles[0].password_available, true)
  assert.equal(Object.prototype.hasOwnProperty.call(secure.profiles[0], 'encrypted_password'), false)

  const insecure = publicLoginHistory(history, false)
  assert.equal(insecure.profiles[0].password_available, false)
  assert.equal(insecure.profiles[0].remember_password, false)
  assert.equal(insecure.profiles[0].auto_login, false)
})

test('saved password replacement preserves remember and auto-login preferences', () => {
  const history = normalizeLoginHistory({
    profiles: [{
      server: 'https://one.example',
      username: 'alice',
      last_used_at: '2026-09-02T00:00:00Z',
      remember_password: true,
      auto_login: true,
      encrypted_password: 'old',
    }],
  })

  const replaced = replaceSavedPassword(history, 'https://one.example', 'alice', 'new')
  assert.equal(replaced.profiles[0].encrypted_password, 'new')
  assert.equal(replaced.profiles[0].auto_login, true)

  const disabled = disableAutomaticLogin(replaced)
  assert.equal(automaticLoginProfile(disabled), undefined)
  assert.equal(disabled.profiles[0].remember_password, true)
})
