const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const storageSource = read('web/src/browserSafeStorage.ts')
const appSource = read('web/src/App.tsx')
const mainSource = read('web/src/main.tsx')
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
const transpile = source => ts.transpileModule(source, { compilerOptions: options }).outputText
const appAST = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const mainAST = ts.createSourceFile('main.tsx', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function functionDeclaration(ast, name) {
  const node = ast.statements.find(item =>
    ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(node, 'missing source function: ' + name)
  return node.getText(ast)
}
function initializer(ast, name) {
  let result = null
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === name) result = node.initializer?.getText(ast) ?? null
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, 'missing source initializer: ' + name)
  return result
}
const sessionCode = transpile([
  functionDeclaration(appAST, 'initialSession'),
  'exports.initialSession = initialSession;',
  'exports.persistSession = ' + initializer(appAST, 'persistSession') + ';',
  'exports.clearSession = ' + initializer(appAST, 'clearSession') + ';',
].join('\n'))
const rootCode = transpile(functionDeclaration(mainAST, 'Root') + '\nexports.Root = Root;')

function createHarness(storage, denyGetter = false) {
  const win = {}
  if (denyGetter) {
    Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError') } })
  } else {
    win.localStorage = storage
  }
  const safe = {}
  new Function('exports', 'window', transpile(storageSource))(safe, win)

  let liveSession = null, username = null, notice = null, disposeCalls = 0
  // The real App also revokes the forced-password UI on every logout.
  // Start true to verify that clearSession actually resets this state.
  let loginPasswordChangeRequired = true
  const foregroundTransitions = []
  const keys = {
    ACCESS_KEY: 'xdrive.access_token',
    LEGACY_TOKEN_KEY: 'xdrive.token',
    REFRESH_KEY: 'xdrive.refresh_token',
    EXPIRES_KEY: 'xdrive.access_expires_at',
    USER_KEY: 'xdrive.username',
  }
  const vars = {
    ...keys, AUTH_STORAGE_KEYS: Object.values(keys),
    AUTH_TOKEN_KEYS: Object.values(keys).filter(key => key !== 'xdrive.username'),
    REMEMBER_LOGIN_KEY: 'xdrive.remember_login',
    COOKIE_MODE_KEY: 'xdrive.auth_cookie_mode',
    // This harness evaluates extracted useCallback expressions outside React.
    // Match the real default-on preference without hiding opt-out coverage.
    rememberLogin: true,
    ...safe, useCallback: fn => fn,
    setSession(next) { liveSession = next },
    setUsername(next) { username = next },
    setLoginPasswordChangeRequired(next) { loginPasswordChangeRequired = next },
    setAuthNotice(next) { notice = next },
    transferApiRef: { current: { disposeTransfers() { disposeCalls++ } } },
    authEpochRef: { current: 0 },
    xDriveEnterForegroundPage(page) { foregroundTransitions.push(page) },
    xDriveClearBaiduConversionSession() {},
    async xDrivePwaClearOfflineMetadata() {},
  }
  const app = {}
  new Function('exports', ...Object.keys(vars), sessionCode)(app, ...Object.values(vars))
  return { safe, app, win, keys,
    get session() { return liveSession }, get username() { return username },
    get loginPasswordChangeRequired() { return loginPasswordChangeRequired },
    get notice() { return notice }, get disposeCalls() { return disposeCalls },
    get foregroundTransitions() { return [...foregroundTransitions] } }
}

test('PWA stored login/refresh and logout keep existing browser semantics', () => {
  const values = new Map([
    ['xdrive.access_token', 'old-access'], ['xdrive.refresh_token', 'old-refresh'],
    ['xdrive.access_expires_at', '123'], ['xdrive.username', 'owner'],
  ])
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const h = createHarness(storage)
  assert.deepEqual(h.app.initialSession(), {
    accessToken: 'old-access', refreshToken: 'old-refresh', accessExpiresAt: 123,
  })
  const fresh = { accessToken: 'fresh', refreshToken: 'renewed', accessExpiresAt: 789 }
  h.app.persistSession(fresh)
  assert.strictEqual(h.session, fresh)
  assert.equal(values.get(h.keys.ACCESS_KEY), 'fresh')
  assert.equal(values.get(h.keys.LEGACY_TOKEN_KEY), 'fresh')
  assert.equal(values.get(h.keys.REFRESH_KEY), 'renewed')
  assert.equal(values.get(h.keys.EXPIRES_KEY), '789')
  assert.equal(h.loginPasswordChangeRequired, true)
  h.app.clearSession('会话已失效。')
  assert.equal(h.loginPasswordChangeRequired, false,
    'logout must clear the former Owner forced-password gate')
  assert.deepEqual(h.session, { accessToken: '', refreshToken: '', accessExpiresAt: 0 })
  assert.equal(h.username, '')
  assert.equal(h.notice, '会话已失效。')
  assert.equal(h.disposeCalls, 1)
  assert.deepEqual(h.foregroundTransitions, [null],
    'logout must invalidate obsolete foreground page before a new Owner can mount')
  for (const key of Object.values(h.keys)) assert.equal(values.has(key), false, key)
})

test('HTTPS Cookie mode serializes NO access or refresh secret to localStorage', () => {
  const values = new Map([
    ['xdrive.access_token', 'legacy-access'],
    ['xdrive.refresh_token', 'legacy-refresh'],
  ])
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const h = createHarness(storage)
  const session = { accessToken: 'short-only', refreshToken: '',
    accessExpiresAt: Date.now() + 900000, browserSession: true, username: 'owner' }
  h.app.persistSession(session, true)
  assert.strictEqual(h.session, session)
  assert.equal(values.get('xdrive.auth_cookie_mode'), 'cookie')
  assert.equal(values.get('xdrive.username'), 'owner',
    'Cookie renewal must preserve a durable Owner hint for next cold restore')
  for (const key of Object.values(h.keys).filter(key => key !== 'xdrive.username')) {
    assert.equal(values.has(key), false, key)
  }
  h.app.clearSession()
  assert.equal(h.loginPasswordChangeRequired, false)
  assert.equal(values.has('xdrive.auth_cookie_mode'), false)
})

test('PWA opt-out deletes durable tokens and never revives the previous Owner', () => {
  const values = new Map([
    ['xdrive.remember_login', 'false'],
    ['xdrive.access_token', 'stale-access'],
    ['xdrive.refresh_token', 'stale-refresh'],
    ['xdrive.access_expires_at', '123'],
    ['xdrive.username', 'stale-owner'],
  ])
  const h = createHarness({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  })
  assert.deepEqual(h.app.initialSession(), { accessToken: '', refreshToken: '', accessExpiresAt: 0 })
  for (const key of Object.values(h.keys)) assert.equal(values.has(key), false, key)
  const active = { accessToken: 'current', refreshToken: 'current-refresh', accessExpiresAt: 999 }
  h.app.persistSession(active, false)
  assert.strictEqual(h.session, active, 'opt-out keeps current authenticated memory')
  for (const key of Object.values(h.keys)) assert.equal(values.has(key), false, key)
  assert.equal(values.get('xdrive.remember_login'), 'false')
})

test('PWA denied localStorage getter cannot crash first paint, login or logout', () => {
  const h = createHarness(null, true)
  assert.equal(h.safe.xDriveBrowserStorageRead('xdrive.appearance'), null)
  assert.equal(h.safe.xDriveBrowserStorageWrite('xdrive.appearance', 'dark'), false)
  assert.equal(h.safe.xDriveBrowserStorageRemove(Object.values(h.keys)), false)
  assert.deepEqual(h.app.initialSession(), {
    accessToken: '', refreshToken: '', accessExpiresAt: 0,
  })
  const session = { accessToken: 'live', refreshToken: 'live-refresh', accessExpiresAt: 1234 }
  h.app.persistSession(session)
  assert.strictEqual(h.session, session, 'Server login remains in memory')
  h.app.clearSession()
  assert.deepEqual(h.session, { accessToken: '', refreshToken: '', accessExpiresAt: 0 })
  assert.equal(h.username, '')
  assert.match(h.notice, /无法确认浏览器已清除本地登录记录/)
  assert.equal(h.disposeCalls, 1)
})

test('PWA partial storage writes attempt all cleanup keys and never revive partial tokens', () => {
  const values = new Map()
  const removed = []
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === 'xdrive.refresh_token') throw new Error('QuotaExceededError')
      values.set(key, value)
    },
    removeItem(key) { removed.push(key); values.delete(key) },
  }
  const h = createHarness(storage)
  const next = { accessToken: 'new-token', refreshToken: 'new-refresh', accessExpiresAt: 43 }
  h.app.persistSession(next)
  assert.strictEqual(h.session, next)
  assert.deepEqual(removed, ['xdrive.auth_cookie_mode', ...Object.values(h.keys)])
  for (const key of Object.values(h.keys)) assert.equal(values.has(key), false, key)
})

test('PWA logout still clears memory and tries remaining keys after removeItem throws', () => {
  const removed = []
  const storage = {
    getItem: () => null, setItem() {},
    removeItem(key) {
      removed.push(key)
      if (key === 'xdrive.refresh_token') throw new Error('SecurityError')
    },
  }
  const h = createHarness(storage)
  h.app.clearSession('请重新登录。')
  assert.deepEqual(removed, [...Object.values(h.keys), 'xdrive.auth_cookie_mode'])
  assert.equal(h.session.accessToken, '')
  assert.equal(h.username, '')
  assert.match(h.notice, /请重新登录/)
  assert.match(h.notice, /浏览器设置中清理本站点数据/)
})

test('PWA real Root renders and can change theme with denied site storage', () => {
  const h = createHarness(null, true)
  let renderedAppearance = null
  const react = {
    useState(init) { return [typeof init === 'function' ? init() : init,
      next => { renderedAppearance = next }] },
    useCallback: fn => fn,
    createElement: (component, props, ...children) => ({ component, props, children }),
  }
  const env = {
    React: react,
    normalizeXDriveAppearance: saved => saved ?? 'system',
    xDriveBrowserStorageRead: h.safe.xDriveBrowserStorageRead,
    xDriveBrowserStorageWrite: h.safe.xDriveBrowserStorageWrite,
    APPEARANCE_KEY: 'xdrive.appearance',
    XDriveAppearanceThemeProvider: 'theme',
    App: 'app',
  }
  const module = {}
  new Function('exports', ...Object.keys(env), rootCode)(module, ...Object.values(env))
  const tree = module.Root()
  assert.equal(tree.props.appearance, 'system')
  assert.equal(tree.children[0].props.appearance, 'system')
  tree.children[0].props.onAppearanceChange('dark')
  assert.equal(renderedAppearance, 'dark')
})

test('PWA boot/auth entry points use guarded storage; Owner and Service Worker are untouched', () => {
  assert.match(mainSource, /xDriveBrowserStorageRead\(APPEARANCE_KEY\)/)
  assert.match(mainSource, /xDriveBrowserStorageWrite\(APPEARANCE_KEY, next\)/)
  assert.match(appSource, /useState\(\(\) => xDriveBrowserStorageRead\(USER_KEY\) \?\? ''\)/)
  assert.match(appSource, /persistSession\(sessionFromAuth\(result\), rememberLogin\)/)
  assert.match(appSource, /xDriveBrowserStorageWrite\(USER_KEY, result\.username\)/)
  assert.match(appSource, /xDriveBrowserStorageRemove\(AUTH_STORAGE_KEYS\)/)
  for (const source of [mainSource, appSource]) {
    assert.doesNotMatch(source, /\blocalStorage\.(?:getItem|setItem|removeItem)\(/)
  }
  assert.doesNotMatch(storageSource, /serviceWorker|CacheStorage|fetch\(|skipWaiting|location\.reload/)
})
