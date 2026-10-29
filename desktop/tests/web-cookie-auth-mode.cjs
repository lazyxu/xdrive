'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const apiSrc = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
const appSrc = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')

function extractedFunction(source, name, jsx = false) {
  const ast = ts.createSourceFile(jsx ? 'App.tsx' : 'api.ts', source, ts.ScriptTarget.Latest, true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(node, 'missing original function ' + name)
  return node.getText(ast).replace(/^export /, '')
}

test('Browser AuthResult becomes a memory-only Access token with Owner identity', () => {
  const code = ts.transpileModule(extractedFunction(apiSrc, 'sessionFromAuth') +
    '\nexports.run = sessionFromAuth;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  const output = {}
  new Function('exports', code)(output)
  const data = {
    token: 'access', access_token: 'access', refresh_token: '',
    expires_in: 900, username: 'owner', browser_session: true,
  }
  const session = output.run(data)
  assert.equal(session.accessToken, 'access')
  assert.equal(session.refreshToken, '')
  assert.equal(session.browserSession, true)
  assert.equal(session.username, 'owner')
  assert.ok(session.accessExpiresAt > Date.now())
  assert.deepEqual(Object.keys(output.run({ ...data, browser_session: false,
    refresh_token: 'native-refresh' })).sort(),
    ['accessExpiresAt', 'accessToken', 'refreshToken'].sort())
})

test('Browser refresh uses a same-origin Web Lock, not an unsafe cross-tab replay', async () => {
  const code = ts.transpileModule(extractedFunction(apiSrc, 'xDriveBrowserCookieExclusive') +
    '\nexports.run = xDriveBrowserCookieExclusive;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  const events = []
  let queue = Promise.resolve()
  const navigator = { locks: { request(name, options, callback) {
    assert.equal(name, 'xdrive-refresh-cookie')
    assert.deepEqual(options, { mode: 'exclusive' })
    const running = queue.then(callback)
    queue = running.catch(() => {})
    return running
  } } }
  const output = {}
  new Function('exports', 'navigator', code)(output, navigator)
  const first = output.run(async () => {
    events.push('first-start')
    await Promise.resolve()
    events.push('first-end')
    return 1
  })
  const second = output.run(async () => { events.push('second'); return 2 })
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(events, ['first-start', 'first-end', 'second'])
})

test('HTTPS browser endpoints never expose a refresh token or change native/HTTP compatibility', () => {
  for (const fragment of [
    "window.location.protocol === 'https:'",
    '/api/v1/auth/browser/login',
    '/api/v1/auth/browser/refresh',
    '/api/v1/auth/browser/logout',
    '/api/v1/me/change-password/browser',
    "redirect: 'error', credentials: 'same-origin'",
    'if (response.status !== 404)',
    "if (!result.browser_session || result.refresh_token)",
    "session.username && result.username !== this.session.username",
    "'X-XDrive-Browser-Owner': this.session.username",
    "const response = await xDriveBrowserCookieExclusive(async () => {",
    "hasBrowserOwner(): boolean",
  ]) assert.ok(apiSrc.includes(fragment), fragment)
  assert.ok(apiSrc.includes('/api/v1/auth/login'))
  assert.ok(apiSrc.includes('/api/v1/auth/refresh'))
  assert.ok(apiSrc.includes('/api/v1/auth/logout'))
  for (const fragment of [
    "const COOKIE_MODE_KEY = 'xdrive.auth_cookie_mode'",
    "const COOKIE_LOGOUT_PENDING_KEY = 'xdrive.auth_cookie_logout_pending'",
    'xDriveBrowserStorageRemove(AUTH_STORAGE_KEYS)',
    'persistSession(sessionFromAuth(result), true)',
    'logoutPending',
    'setCookieBootPending(false)',
    'onAuthenticated(await api.login(username, password, rememberLogin), attemptEpoch)',
    'data-xdrive-manual-connection-login',
    'data-xdrive-manual-connection-menu',
    "window.location.hash === '#/offline/files'",
  ]) assert.ok(appSrc.includes(fragment), fragment)
})

test('HTTPS cookie restoration never reads an old localStorage Access/Refresh JWT', () => {
  const transpiled = ts.transpileModule(extractedFunction(appSrc, 'initialSession', true) +
    '\nexports.run = initialSession;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  const values = new Map([
    ['xdrive.auth_cookie_mode', 'cookie'],
    ['xdrive.access_token', 'old-access'],
    ['xdrive.refresh_token', 'old-refresh'],
  ])
  const storage = {
    xDriveBrowserStorageRead: key => values.get(key) ?? null,
    xDriveBrowserStorageRemove: key => {
      (Array.isArray(key) ? key : [key]).forEach(k => values.delete(k))
      return true
    },
  }
  const keys = {
    ACCESS_KEY: 'xdrive.access_token', REFRESH_KEY: 'xdrive.refresh_token',
    EXPIRES_KEY: 'xdrive.access_expires_at', LEGACY_TOKEN_KEY: 'xdrive.token',
    USER_KEY: 'xdrive.username', REMEMBER_LOGIN_KEY: 'xdrive.remember_login',
    COOKIE_MODE_KEY: 'xdrive.auth_cookie_mode',
    AUTH_STORAGE_KEYS: ['xdrive.access_token','xdrive.token','xdrive.refresh_token',
      'xdrive.access_expires_at','xdrive.username'],
  }
  const env = { ...storage, ...keys, window: { location: { protocol: 'https:' } } }
  const exports = {}
  new Function('exports', ...Object.keys(env), transpiled)(exports, ...Object.values(env))
  assert.deepEqual(exports.run(), {
    accessToken: '', refreshToken: '', accessExpiresAt: 0, browserSession: true,
  })
  env.window.location.protocol = 'http:'
  assert.equal(exports.run().accessToken, 'old-access',
    'Legacy HTTP/local dev must remain compatible until Server is upgraded')
  values.set('xdrive.remember_login', 'false')
  assert.equal(exports.run().accessToken, '')
  assert.equal(values.has('xdrive.refresh_token'), false)
})

test('Logout and cross-tab events fence late Owner refresh callbacks', () => {
  assert.ok(appSrc.includes("xDriveBrowserStorageRead(USER_KEY) ?? undefined"))
  assert.ok(appSrc.includes("const logoutOwner = logoutPending ? xDriveBrowserStorageRead(COOKIE_LOGOUT_OWNER_KEY) : null"))
  assert.ok(appSrc.includes("logoutOwner ?? undefined"))
  assert.ok(appSrc.includes("if (session.username) xDriveBrowserStorageWrite(COOKIE_LOGOUT_OWNER_KEY, session.username)"))
  assert.ok(appSrc.includes("const AUTH_TOKEN_KEYS = [ACCESS_KEY, LEGACY_TOKEN_KEY, REFRESH_KEY, EXPIRES_KEY]"))
  assert.ok(appSrc.includes('authEpochRef.current += 1'))
  assert.ok(appSrc.includes('if (boundEpoch === authEpochRef.current) persistSession(next)'))
  assert.ok(appSrc.includes("broadcastXDriveAuthEvent('logout', username)"))
  assert.ok(appSrc.includes("broadcastXDriveAuthEvent('login', result.username)"))
  assert.ok(appSrc.includes('COOKIE_LOGOUT_PENDING_KEY'))
  assert.ok(appSrc.includes("if (result.browser_session) {"))
  assert.ok(appSrc.includes("xDriveBrowserStorageRemove(COOKIE_LOGOUT_OWNER_KEY)"))
  assert.ok(appSrc.includes('clearSession() // Owner UI is immediately hidden'))
})

test('Safari denied or absent Web Locks getters preserve browser auth fallback without double POST', async () => {
  const code = ts.transpileModule(extractedFunction(apiSrc, 'xDriveBrowserCookieExclusive') +
    '\nexports.run = xDriveBrowserCookieExclusive;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  for (const denied of ['locks', 'request', 'absent']) {
    const nav = {}
    if (denied === 'locks') {
      Object.defineProperty(nav, 'locks', {
        get() { throw new Error('Safari SecurityError: locks getter') },
      })
    } else if (denied === 'request') {
      const locks = {}
      Object.defineProperty(locks, 'request', {
        get() { throw new Error('Safari SecurityError: request getter') },
      })
      nav.locks = locks
    }
    let called = 0
    const output = {}
    new Function('exports', 'navigator', 'ApiError', code)(output, nav, Error)
    assert.equal(await output.run(async () => ++called), 1)
    assert.equal(called, 1, 'no duplicate authenticated POST on unsupported capability')
  }
})

test('browser logout has a bounded abort even when a stalled Fetch ignores cancellation', async () => {
  const ast = ts.createSourceFile('api.ts', apiSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'XDriveApi')
  assert.ok(klass, 'production XDriveApi must exist')
  const method = klass.members.find(n =>
    ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'logout')
  assert.ok(method, 'actual XDriveApi.logout must be testable')
  const source = 'class TestLogout { constructor(session) { this.session = session } ' +
    method.getText(ast) + ' }\nexports.TestLogout = TestLogout;'
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const timers = [], cleared = [], requests = []
  const fakeTimeout = (cb, ms) => { timers.push({ cb, ms }); return 7 }
  const fakeClearTimeout = id => { cleared.push(id) }
  class HTTPError extends Error { constructor(status, message) { super(message); this.status = status } }
  const pendingFetch = (_url, init) => {
    requests.push(init)
    // A deliberately noncompliant transport ignores AbortSignal and hangs.
    return new Promise(() => {})
  }
  const output = {}
  new Function('exports', 'setTimeout', 'clearTimeout', 'fetch', 'API_BASE',
    'AbortController', 'ApiError', 'xDriveBrowserCookieExclusive', js)(
      output, fakeTimeout, fakeClearTimeout, pendingFetch, '', AbortController,
      HTTPError, async (run, signal) => {
        assert.equal(signal instanceof AbortSignal, true)
        return run()
      })
  const api = new output.TestLogout({
    browserSession: true, username: 'old-owner', refreshToken: '',
  })
  const finished = api.logout()
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 8000)
  timers[0].cb()
  await assert.rejects(finished, error =>
    error.status === 408 && /timed out/.test(error.message))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].signal.aborted, true,
    'old response must not be accepted after allowing a new login')
  assert.deepEqual(cleared, [7])
  assert.match(appSrc, /clearSession\(\) \/\/ Owner UI is immediately hidden/)
  assert.match(appSrc, /setLogoutInProgress\(false\)/)
})

test('Web Locks denial from request() falls back once only before the auth callback starts', async () => {
  const code = ts.transpileModule(extractedFunction(apiSrc, 'xDriveBrowserCookieExclusive') +
    '\nexports.run = xDriveBrowserCookieExclusive;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  for (const mode of ['throw', 'reject']) {
    let called = 0
    const navigator = { locks: { request() {
      const error = new Error('Safari denied optional lock')
      error.name = 'SecurityError'
      if (mode === 'throw') throw error
      return Promise.reject(error)
    } } }
    const output = {}
    new Function('exports', 'navigator', 'ApiError', code)(output, navigator, Error)
    assert.equal(await output.run(async () => ++called), 1)
    assert.equal(called, 1, 'a denied lock must never trigger a duplicate auth POST')
  }
  let started = 0
  const failure = new Error('request already started, no safe replay')
  const output = {}
  const navigator = { locks: { request(_name, _opts, callback) { return callback() } } }
  new Function('exports', 'navigator', 'ApiError', code)(output, navigator, Error)
  await assert.rejects(output.run(async () => {
    started++
    throw failure
  }), error => error === failure)
  assert.equal(started, 1, 'an already-started request is never retried without a lock')
})

test('Cold HTTPS Cookie restore has a bounded deadline even when Fetch ignores abort', async () => {
  const ast = ts.createSourceFile('api.ts', apiSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'XDriveApi')
  assert.ok(klass)
  const method = klass.members.find(n =>
    ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'restoreBrowserSession')
  assert.ok(method)
  const source = 'class TestRestore { constructor(session) { this.session = session } ' +
    method.getText(ast) + ' }\nexports.TestRestore = TestRestore;'
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const timers = [], cleared = []
  let posted = 0, requestSignal
  class HTTPError extends Error { constructor(status, message) { super(message); this.status = status } }
  const fakeFetch = (_url, init) => {
    posted++
    requestSignal = init.signal
    assert.equal(init.headers['X-XDrive-Browser-Owner'], 'owner')
    return new Promise(() => {}) // deliberately ignores AbortController
  }
  function createAPI(exclusive) {
    const output = {}
    new Function('exports', 'window', 'setTimeout', 'clearTimeout', 'fetch',
      'AbortController', 'ApiError', 'xDriveBrowserCookieExclusive', 'API_BASE', code)(
        output, { location: { protocol: 'https:' } },
        (cb, ms) => { timers.push({ cb, ms }); return timers.length },
        id => cleared.push(id), fakeFetch, AbortController, HTTPError, exclusive, '')
    return new output.TestRestore({ browserSession: true, username: 'owner' })
  }
  const first = createAPI(async task => task()).restoreBrowserSession()
  assert.equal(timers[0].ms, 15000)
  await Promise.resolve()
  assert.equal(posted, 1)
  timers[0].cb()
  await assert.rejects(first, error => error.status === 408 && /timed out/.test(error.message))
  assert.equal(requestSignal.aborted, true)
  assert.deepEqual(cleared, [1])

  let lateGrant
  const second = createAPI((task) => {
    lateGrant = task
    return new Promise(() => {}) // a Web Lock wait that never settles
  }).restoreBrowserSession()
  assert.equal(timers[1].ms, 15000)
  timers[1].cb()
  await assert.rejects(second, error => error.status === 408)
  await assert.rejects(lateGrant(), error => error.status === 408)
  assert.equal(posted, 1, 'a late lock grant must never refresh an old session')
  assert.deepEqual(cleared, [1, 2])
})

function sourceCookieBootstrapCallback() {
  // Extract the actual mount-time cookie bootstrap effect from production App.tsx.
  // Testing a duplicate helper would miss the stale .then() Owner resurrection.
  const ast = ts.createSourceFile('App.tsx', appSrc, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TSX)
  let found = null
  const visit = node => {
    if (ts.isCallExpression(node) &&
        node.expression.getText(ast) === 'useEffect' &&
        node.arguments[0]?.getText(ast).includes('if (!cookieBootPending) return')) {
      assert.equal(found, null, 'only one Cookie bootstrap effect can own credentials')
      found = node.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, 'missing actual browser-cookie restore effect')
  return ts.transpileModule('exports.effect = ' + found + ';', {
    compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 },
  }).outputText
}

function cookieBootstrapFixture({ tombstone = false } = {}) {
  let resolve, reject
  const pending = new Promise((a, b) => { resolve = a; reject = b })
  const values = new Map([['xdrive.username', 'owner']])
  if (tombstone) {
    values.set('xdrive.auth_cookie_logout_pending', '1')
    values.set('xdrive.auth_cookie_logout_owner', 'owner')
  }
  const epoch = { current: 0 }
  const updates = { sessions: [], usernames: [], notices: [], pending: [],
    removed: [], writes: [] }
  class CookieAPI {
    constructor(session) { this.session = session }
    hasBrowserOwner() { return Boolean(this.session.username) }
    restoreBrowserSession() { return pending }
    logout() { return pending }
  }
  class FakeApiError extends Error {
    constructor(status, message) { super(message); this.status = status }
  }
  const vars = {
    cookieBootPending: true, authEpochRef: epoch,
    COOKIE_LOGOUT_PENDING_KEY: 'xdrive.auth_cookie_logout_pending',
    COOKIE_LOGOUT_OWNER_KEY: 'xdrive.auth_cookie_logout_owner',
    COOKIE_MODE_KEY: 'xdrive.auth_cookie_mode',
    AUTH_STORAGE_KEYS: ['xdrive.username', 'xdrive.access_token', 'xdrive.refresh_token'],
    USER_KEY: 'xdrive.username', browserCookieStartup: null,
    xDriveBrowserStorageRead: key => values.get(key) ?? null,
    xDriveBrowserStorageRemove: keys => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        updates.removed.push(key); values.delete(key)
      }
      return true
    },
    xDriveBrowserStorageWrite: (key, value) => {
      updates.writes.push([key, value]); values.set(key, value); return true
    },
    persistSession: (next, persistent) => updates.sessions.push([next, persistent]),
    setUsername: value => updates.usernames.push(value),
    setAuthNotice: notice => updates.notices.push(notice),
    setCookieBootPending: value => updates.pending.push(value),
    sessionFromAuth: result => ({ browserSession: true,
      accessToken: result.access_token, username: result.username }),
    XDriveApi: CookieAPI, ApiError: FakeApiError,
  }
  const exp = {}
  new Function('exports', ...Object.keys(vars), sourceCookieBootstrapCallback())(
    exp, ...Object.values(vars))
  const cleanup = exp.effect()
  return { epoch, updates, values, resolve, reject, cleanup }
}

async function settleCookieBootstrap() {
  for (let n = 0; n < 12; n++) await Promise.resolve()
}

test('Cookie restore cannot resurrect a logged-out Owner after a peer logout', async () => {
  const h = cookieBootstrapFixture()
  h.epoch.current += 1 // actual clearSession invalidates the auth generation
  h.values.delete('xdrive.username') // cross-tab logout removes durable marker
  h.resolve({ username: 'owner', access_token: 'late-owner-access' })
  await settleCookieBootstrap()
  assert.deepEqual(h.updates.sessions, [], 'late restore must not remount Owner')
  assert.deepEqual(h.updates.usernames, [])
  assert.equal(h.values.has('xdrive.username'), false)
  assert.deepEqual(h.updates.notices, [],
    'late restore must not report errors on the newly logged-out screen')
  assert.deepEqual(h.updates.pending, [false],
    'verification UI must release even if its earlier generation was revoked')
  h.cleanup()
})

test('Cookie restore rejection cannot delete credentials of a newly signed-in Owner', async () => {
  const h = cookieBootstrapFixture()
  h.epoch.current += 1 // new explicit login/account switch
  h.values.set('xdrive.username', 'new-owner')
  h.reject(new Error('old startup cookie restore rejected'))
  await settleCookieBootstrap()
  assert.equal(h.values.get('xdrive.username'), 'new-owner')
  assert.deepEqual(h.updates.removed, [],
    'stale failure must not remove new Owner storage')
  assert.deepEqual(h.updates.notices, [])
  h.cleanup()
})

test('Cookie restore requires an exact durable Owner and current session generation', async () => {
  for (const mode of ['healthy', 'wrong-owner', 'missing-owner']) {
    const h = cookieBootstrapFixture()
    if (mode === 'wrong-owner') h.values.set('xdrive.username', 'other-owner')
    if (mode === 'missing-owner') h.values.delete('xdrive.username')
    h.resolve({ username: 'owner', access_token: 'valid-access' })
    await settleCookieBootstrap()
    assert.equal(h.updates.sessions.length, mode === 'healthy' ? 1 : 0, mode)
    assert.equal(h.updates.usernames.length, mode === 'healthy' ? 1 : 0, mode)
    assert.equal(h.values.has('xdrive.access_token'), false,
      'Cookie Access token must not be stored in localStorage')
    if (mode !== 'healthy') assert.equal(h.updates.notices.length, 1)
    h.cleanup()
  }
})

test('A stale remote logout acknowledgement cannot delete a newer Cookie tombstone', async () => {
  const h = cookieBootstrapFixture({ tombstone: true })
  h.epoch.current += 1 // a new session sign-out has a different auth epoch
  h.values.set('xdrive.auth_cookie_logout_owner', 'new-owner')
  h.resolve()
  await settleCookieBootstrap()
  assert.equal(h.values.get('xdrive.auth_cookie_logout_owner'), 'new-owner')
  assert.equal(h.values.get('xdrive.auth_cookie_logout_pending'), '1')
  assert.deepEqual(h.updates.removed, [])
  h.cleanup()
})

test('Owner-less Cookie restore, refresh and logout never issue a credential-changing POST', async () => {
  // Execute the actual XDriveApi methods without a second auth implementation.
  const ast = ts.createSourceFile('api.ts', apiSrc, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TS)
  const klass = ast.statements.find(n =>
    ts.isClassDeclaration(n) && n.name?.text === 'XDriveApi')
  assert.ok(klass, 'real XDriveApi class not found')
  let calls = 0, locks = 0
  class HTTPError extends Error {
    constructor(status, msg) { super(msg); this.status = status }
  }
  const loadMethod = method => {
    const node = klass.members.find(n =>
      ts.isMethodDeclaration(n) && n.name?.getText(ast) === method)
    assert.ok(node, 'missing actual Cookie method ' + method)
    const source = 'class TestAuth { constructor(session) {' +
      'this.session = session; this.refreshPromise = null; this.transferSessionEpoch = 0' +
      '} ' + node.getText(ast) + ' }\nexports.TestAuth = TestAuth;'
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const output = {}
    new Function('exports', 'window', 'fetch', 'ApiError',
      'xDriveBrowserCookieExclusive', 'API_BASE', code)(
      output, { location: { protocol: 'https:' } },
      async () => { calls++; return { ok: true, json: async () => ({}) } },
      HTTPError, async task => { locks++; return task() }, '')
    return output.TestAuth
  }
  for (const username of [undefined, '']) {
    const session = { browserSession: true, username, refreshToken: '',
      accessExpiresAt: 0 }
    for (const method of ['restoreBrowserSession', 'refresh', 'logout']) {
      const TestAuth = loadMethod(method)
      await assert.rejects(new TestAuth(session)[method](), error =>
        error.status === 401 && /Owner|Owner identity/.test(error.message),
      method + ' must reject without an Owner')
    }
  }
  assert.equal(calls, 0, 'no owner-less cookie rotation or cookie deletion')
  assert.equal(locks, 0, 'reject before acquiring Web Locks or doing POST')
})

test('Login timeout bounds Cookie, late Web Locks and legacy JSON without replay', async () => {
  const ast = ts.createSourceFile('api.ts', apiSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'XDriveApi')
  assert.ok(klass)
  const method = klass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'login')
  assert.ok(method, 'must exercise the actual production login method')
  const source = 'class TestLogin { constructor(nativeRequest) { this.request = nativeRequest } ' +
    method.getText(ast) + ' }\nexports.TestLogin = TestLogin;'
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  class HTTPError extends Error { constructor(status, message) { super(message); this.status = status } }
  const timers = [], cleared = [], requests = [], native = []
  let lateGrant
  function makeAPI(protocol, fetchHandler, lockHandler, nativeHandler) {
    const output = {}
    new Function('exports', 'window', 'setTimeout', 'clearTimeout', 'fetch',
      'AbortController', 'ApiError', 'xDriveBrowserCookieExclusive', 'API_BASE', code)(
        output, { location: { protocol } },
        (callback, ms) => { timers.push({ callback, ms }); return timers.length },
        id => cleared.push(id),
        (url, init) => { requests.push({ url, init }); return fetchHandler(url, init) },
        AbortController, HTTPError, lockHandler, '')
    return new output.TestLogin((path, init, retry) => {
      native.push({ path, init, retry })
      return nativeHandler(path, init, retry)
    })
  }
  const never = () => new Promise(() => {})

  const cookie = makeAPI('https:', never, async task => task(), never)
  const first = cookie.login('owner', 'fixture-only', true)
  assert.equal(timers[0].ms, 15000)
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /\/auth\/browser\/login$/)
  assert.equal(requests[0].init.credentials, 'same-origin')
  timers[0].callback()
  await assert.rejects(first, error => error.status === 408 && /timed out/.test(error.message))
  assert.equal(requests[0].init.signal.aborted, true)
  assert.deepEqual(cleared, [1])
  assert.equal(native.length, 0)

  const waiting = makeAPI('https:', never, task => {
    lateGrant = task
    return never()
  }, never)
  const second = waiting.login('owner', 'fixture-only', true)
  assert.equal(timers[1].ms, 15000)
  timers[1].callback()
  await assert.rejects(second, error => error.status === 408)
  await assert.rejects(lateGrant(), error => error.status === 408)
  assert.equal(requests.length, 1, 'late lock grant cannot send stale login POST')
  assert.deepEqual(cleared, [1, 2])

  const legacy = makeAPI('http:', never, async task => task(), never)
  const third = legacy.login('owner', 'fixture-only', true)
  assert.equal(native.length, 1, 'HTTP remains on compatible native JSON path')
  assert.equal(native[0].path, '/api/v1/auth/login')
  assert.equal(native[0].retry, false)
  assert.equal(timers[2].ms, 15000)
  timers[2].callback()
  await assert.rejects(third, error => error.status === 408)
  assert.equal(native[0].init.signal.aborted, true)
  assert.deepEqual(cleared, [1, 2, 3])
  assert.equal(requests.length, 1)

  // A genuinely old HTTPS Server returns 404 and must still use the native
  // JSON endpoint; a timeout is not an invitation to perform another POST.
  const oldServer = makeAPI('https:', async () => ({ ok: false, status: 404 }),
    async task => task(), async () => ({ username: 'owner', token: 'legacy-access' }))
  const fourth = await oldServer.login('owner', 'fixture-only', true)
  assert.equal(fourth.username, 'owner')
  assert.equal(native.length, 2)
  assert.equal(native[1].path, '/api/v1/auth/login')
  assert.deepEqual(cleared, [1, 2, 3, 4])
})

test('Interactive logout acknowledgement only clears its own Cookie tombstone', async () => {
  // Execute the real App.tsx signOut handler, not a surrogate implementation.
  const ast = ts.createSourceFile('App.tsx', appSrc, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TSX)
  let source
  function walk(node) {
    if (ts.isVariableDeclaration(node) &&
        node.name.getText(ast) === 'signOut') {
      assert.equal(source, undefined, 'only one production signOut handler')
      source = node.initializer?.getText(ast)
    }
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.ok(source, 'missing production signOut handler')
  const code = ts.transpileModule('exports.signOut = ' + source + ';', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  function makeLogout() {
    const values = new Map()
    const removed = [], loading = []
    let finish
    const revoke = new Promise(resolve => { finish = resolve })
    const session = { browserSession: true, username: 'owner' }
    const vars = {
      session, username: 'owner',
      COOKIE_LOGOUT_OWNER_KEY: 'xdrive.auth_cookie_logout_owner',
      COOKIE_LOGOUT_PENDING_KEY: 'xdrive.auth_cookie_logout_pending',
      xDriveBrowserStorageWrite(key, value) { values.set(key, value); return true },
      xDriveBrowserStorageRead(key) { return values.get(key) ?? null },
      xDriveBrowserStorageRemove(key) { removed.push(key); values.delete(key); return true },
      xDriveClearBaiduConversionSession() {},
      xDriveClearPrivateMapBrowseSessions() {},
      setLogoutInProgress(value) { loading.push(value) },
      clearSession() {},
      broadcastXDriveAuthEvent() {},
      api: { logout: () => revoke },
      setAuthNotice() {},
    }
    const output = {}
    new Function('exports', ...Object.keys(vars), code)(output, ...Object.values(vars))
    output.signOut()
    return { values, removed, loading, finish }
  }
  for (const overwritten of ['no', 'other-owner', 'same-owner']) {
    const h = makeLogout()
    const original = h.values.get('xdrive.auth_cookie_logout_pending')
    assert.match(original, /^1:/, 'must record a unique durable logout attempt')
    assert.equal(h.values.get('xdrive.auth_cookie_logout_owner'), 'owner')
    if (overwritten !== 'no') {
      // A newer tab can sign in and then log out while the old POST is pending.
      h.values.set('xdrive.auth_cookie_logout_pending', '1:newer-attempt')
      h.values.set('xdrive.auth_cookie_logout_owner',
        overwritten === 'same-owner' ? 'owner' : 'other-owner')
    }
    h.finish()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    if (overwritten === 'no') {
      assert.equal(h.values.has('xdrive.auth_cookie_logout_pending'), false)
      assert.equal(h.values.has('xdrive.auth_cookie_logout_owner'), false)
      assert.equal(h.removed.length, 2)
    } else {
      assert.equal(h.values.get('xdrive.auth_cookie_logout_pending'), '1:newer-attempt')
      assert.equal(h.values.get('xdrive.auth_cookie_logout_owner'),
        overwritten === 'same-owner' ? 'owner' : 'other-owner')
      assert.deepEqual(h.removed, [])
    }
    assert.deepEqual(h.loading, [true, false])
  }
  // Previously persisted '1' markers remain eligible for cold-start
  // revocation, and newer '1:<nonce>' markers must be recognized as well.
  assert.ok(appSrc.includes("(xDriveBrowserStorageRead(COOKIE_LOGOUT_PENDING_KEY) ?? '').startsWith('1')"))
})

test('Cold Cookie logout ACK cannot clear a newer same-Owner peer-tab tombstone', async () => {
  const h = cookieBootstrapFixture({ tombstone: true })
  // Tab A's mount-time request started against legacy intent "1". Tab B has
  // since logged in and issued a NEW logout of the same Owner, without
  // changing Tab A's in-memory auth epoch.
  h.values.set('xdrive.auth_cookie_logout_pending', '1:peer-tab-new-logout')
  h.resolve()
  await settleCookieBootstrap()
  assert.equal(h.values.get('xdrive.auth_cookie_logout_pending'),
    '1:peer-tab-new-logout')
  assert.equal(h.values.get('xdrive.auth_cookie_logout_owner'), 'owner')
  assert.deepEqual(h.updates.removed, [],
    'old remote 204 must not erase newer peer-tab revocation intent')
  h.cleanup()
})

test('Cold Cookie logout ACK preserves a newer different Owner even if marker is reused', async () => {
  const h = cookieBootstrapFixture({ tombstone: true })
  h.values.set('xdrive.auth_cookie_logout_owner', 'new-owner')
  h.resolve()
  await settleCookieBootstrap()
  assert.equal(h.values.get('xdrive.auth_cookie_logout_owner'), 'new-owner')
  assert.equal(h.values.get('xdrive.auth_cookie_logout_pending'), '1')
  assert.deepEqual(h.updates.removed, [])
  h.cleanup()
})

test('Legacy Cookie tombstone still clears only after its own confirmed logout', async () => {
  const h = cookieBootstrapFixture({ tombstone: true })
  h.resolve()
  await settleCookieBootstrap()
  assert.equal(h.values.has('xdrive.auth_cookie_logout_pending'), false)
  assert.equal(h.values.has('xdrive.auth_cookie_logout_owner'), false)
  assert.ok(h.updates.removed.includes('xdrive.auth_cookie_logout_pending'))
  h.cleanup()
})

test('Manual login response after an Owner epoch change cannot remount old private UI', async () => {
  // Both callbacks come from the real App.tsx AST, not handwritten replicas.
  const ast = ts.createSourceFile('App.tsx', appSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const authView = ast.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'AuthView')
  assert.ok(authView, 'real login view missing')
  const decl = authView.body.statements.find(node =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some(
      d => d.name.getText(ast) === 'submit'))
  assert.ok(decl, 'real interactive login submit missing')
  const submitNode = decl.declarationList.declarations.find(d => d.name.getText(ast) === 'submit')
  const callbackSource = []
  function findCallback(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onAuthenticated' &&
        ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      callbackSource.push(node.initializer.expression.getText(ast))
    }
    ts.forEachChild(node, findCallback)
  }
  findCallback(ast)
  assert.equal(callbackSource.length, 1, 'real App must have one AuthView onAuthenticated callback')
  const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  const submitCode = ts.transpileModule(
    'exports.submit = ' + submitNode.initializer.getText(ast) + ';',
    { compilerOptions }).outputText
  const callbackCode = ts.transpileModule(
    'exports.accept = ' + callbackSource[0] + ';',
    { compilerOptions }).outputText

  async function simulate(stale) {
    const writes = [], notices = [], owners = [], events = [], persisted = [], passwordGates = []
    const authEpochRef = { current: 9 }
    const parentVars = {
      authEpochRef, setAuthNotice: value => notices.push(value),
      setLoginPasswordChangeRequired: value => passwordGates.push(value),
      COOKIE_LOGOUT_PENDING_KEY: 'pending', COOKIE_LOGOUT_OWNER_KEY: 'owner',
      xDriveBrowserStorageRemove: key => writes.push(['remove', key]),
      persistSession: (session, preference) => persisted.push({ session, preference }),
      sessionFromAuth: result => result, rememberLogin: true,
      xDriveBrowserStorageWrite: (key, value) => { writes.push(['write', key, value]); return true },
      LAST_USERNAME_KEY: 'last', USER_KEY: 'user', AUTH_STORAGE_KEYS: ['access','refresh'],
      setUsername: name => owners.push(name),
      broadcastXDriveAuthEvent: (...args) => events.push(args),
    }
    const parent = {}
    new Function('exports', ...Object.keys(parentVars), callbackCode)(
      parent, ...Object.values(parentVars))
    let completeLogin
    const inFlight = new Promise(resolve => { completeLogin = resolve })
    const childVars = {
      authEpoch: 9, loginUsername: 'owner', password: 'fixture-password',
      logoutInProgress: false, rememberLogin: true,
      api: { login: () => inFlight },
      onAuthenticated: parent.accept,
      xDriveUsernameValidationError: () => '',
      xDrivePasswordValidationError: () => '',
      setUsernameError() {}, setPasswordError() {}, setBusy() {}, setError() {},
    }
    const child = {}
    new Function('exports', ...Object.keys(childVars), submitCode)(child, ...Object.values(childVars))
    const pending = child.submit({ preventDefault() {} })
    if (stale) authEpochRef.current++ // peer logout / account switch arrived
    completeLogin({ username: 'owner', access_token: 'old-access', browser_session: true })
    await pending
    return { writes, notices, owners, events, persisted, passwordGates, epoch: authEpochRef.current }
  }
  const stale = await simulate(true)
  assert.deepEqual(stale.persisted, [], 'late login must never persist revoked Owner')
  assert.deepEqual(stale.owners, [], 'late login must not remount private Owner')
  assert.deepEqual(stale.writes, [], 'late login must not remove a newer tombstone')
  assert.deepEqual(stale.events, [], 'late login must not broadcast a resurrected Owner')
  assert.deepEqual(stale.passwordGates, [], 'late login must not set any previous Owner password gate')
  const valid = await simulate(false)
  assert.equal(valid.persisted.length, 1, 'current login can still mount its Owner')
  assert.deepEqual(valid.owners, ['owner'])
  assert.deepEqual(valid.events, [['login','owner']])
  assert.deepEqual(valid.passwordGates, [false], 'current login must use Server password gate only')
})
