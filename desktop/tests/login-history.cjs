const test = require('node:test')
const assert = require('node:assert/strict')

const {
  automaticLoginProfile,
  clearSavedPassword,
  clearSavedPasswordsForOrigin,
  disableAutomaticLogin,
  normalizeLoginHistory,
  publicLoginHistory,
  recordSuccessfulLogin,
  replaceSavedPassword,
} = require('../dist/main/login_history.cjs')

test('route preferences remain scoped to a profile through password clearing and reject corrupt auto-login routes', () => {
  const route = { mode: 'auto', lan_ip: '192.168.2.4', public_ip: '' }
  let history = recordSuccessfulLogin({ version: 1, profiles: [] }, {
    server: 'https://drive.example', username: 'alice', last_used_at: '2026-10-25T00:00:00Z',
    remember_password: true, auto_login: true, encrypted_password: 'synthetic-ciphertext', connection_route: route,
  })
  assert.deepEqual(publicLoginHistory(history, true).profiles[0].connection_route, route)
  history = clearSavedPassword(history, 'https://drive.example', 'alice')
  assert.deepEqual(history.profiles[0].connection_route, route)
  assert.equal(automaticLoginProfile(history), undefined)
  const invalid = normalizeLoginHistory({ profiles: [{ ...history.profiles[0], connection_route: { mode: 'invalid' }, remember_password: true, auto_login: true, encrypted_password: 'synthetic' }] })
  assert.equal(automaticLoginProfile(invalid), undefined)
})

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

test('saved password can be cleared without deleting the login profile or mount path', () => {
  const history = normalizeLoginHistory({
    profiles: [{
      server: 'https://one.example',
      username: 'alice',
      mount_path: '/data/xdrive',
      last_used_at: '2026-09-02T00:00:00Z',
      remember_password: true,
      auto_login: true,
      encrypted_password: 'ciphertext',
    }],
  })

  const cleared = clearSavedPassword(history, 'https://one.example', 'alice')
  assert.equal(cleared.profiles.length, 1)
  assert.equal(cleared.profiles[0].server, 'https://one.example')
  assert.equal(cleared.profiles[0].username, 'alice')
  assert.equal(cleared.profiles[0].mount_path, '/data/xdrive')
  assert.equal(cleared.profiles[0].remember_password, false)
  assert.equal(cleared.profiles[0].auto_login, false)
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.profiles[0], 'encrypted_password'), false)
})

test('revoking exact LAN HTTPS origin clears all saved credentials without touching adjacent hosts', () => {
  const now = '2026-10-24T00:00:00Z'
  const profiles = [
    { server: 'https://192.168.2.4:8443', username: 'alice', mount_path: '/alice', auto_login: true },
    { server: 'https://192.168.2.4:8443/', username: 'bob', mount_path: '/bob' },
    { server: 'https://192.168.2.4:9443', username: 'carol' },
    { server: 'https://192.168.2.5:8443', username: 'dave' },
    { server: 'https://drive.example.test', username: 'erin' },
  ].map((item, i) => ({
    ...item, last_used_at: new Date(Date.parse(now) + i * 1000).toISOString(),
    remember_password: true,
    auto_login: item.auto_login === true,
    encrypted_password: 'ciphertext-for-' + item.username,
  }))
  const initial = normalizeLoginHistory({ profiles })
  const next = clearSavedPasswordsForOrigin(initial, 'https://192.168.2.4:8443')
  assert.equal(next.profiles.length, 5)
  for (const profile of next.profiles) {
    if (new URL(profile.server).origin === 'https://192.168.2.4:8443') {
      assert.equal(profile.remember_password, false)
      assert.equal(profile.auto_login, false)
      assert.equal(profile.encrypted_password, undefined)
      assert.ok(profile.mount_path)
    } else {
      assert.equal(profile.remember_password, true)
      assert.match(profile.encrypted_password, /^ciphertext-for-/)
    }
  }
  assert.equal(automaticLoginProfile(next), undefined)
})
