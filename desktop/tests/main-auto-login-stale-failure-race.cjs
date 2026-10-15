const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const {
  normalizeLoginHistory, automaticLoginProfile, disableAutomaticLogin,
  publicLoginHistory, recordSuccessfulLogin,
} = require('../dist/main/login_history.cjs')

const mainPath = path.join(__dirname, '..', 'src', 'main', 'index.cts')
const required = [
  'saveLoginHistory', 'persistLoginHistoryBestEffort',
  'loginHistorySnapshot', 'attemptAutomaticLogin',
]
const oldServer = 'https://old-auto-race.example.invalid'
const newerServer = 'https://new-manual-race.example.invalid'

function originalMainFunctions() {
  const source = ts.createSourceFile(mainPath, fs.readFileSync(mainPath, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name &&
      required.includes(statement.name.text)) {
      found.set(statement.name.text, statement.getText(source))
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...required].sort(),
    'run original Electron Main auto-login and credential persistence bodies')
  return required.map((name) => found.get(name)).join('\n\n')
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'xdrive-stale-auto-login-race-'))
  const file = path.join(dir, 'desktop-login-history.json')
  const oldAttemptEntered = deferred()
  const oldAttemptResult = deferred()
  const original = normalizeLoginHistory({ profiles: [{
    server: oldServer, username: 'old-user',
    last_used_at: '2026-10-01T00:00:00Z',
    remember_password: true, auto_login: true,
    encrypted_password: 'synthetic-old-ciphertext',
  }] })
  const extracted = [
    'let loginHistory = normalizeLoginHistory(initial)',
    "let lastAutoLoginError = ''",
    'let mainWindow = null',
    'let lifecycleLog = { record: () => {} }',
    'let agentState = { connected: true, status: { configured: false } }',
    originalMainFunctions(),
  ].join('\n\n')
  const transpiled = ts.transpileModule(extracted, {
    fileName: mainPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const bindings = {
    exports: {}, initial: original, normalizeLoginHistory,
    automaticLoginProfile, disableAutomaticLogin, recordSuccessfulLogin, publicLoginHistory,
    app: { getPath: (key) => {
      assert.equal(key, 'userData')
      return dir
    } },
    loginHistoryName: path.basename(file), path,
    mkdir: fsp.mkdir,
    writeFile: async (name, content, options) => {
      assert.equal(name, file, 'test must write only its private history file')
      return fsp.writeFile(name, content, options)
    },
    securePasswordStorageAvailable: () => true,
    decryptLoginPassword: (ciphertext) => ciphertext,
    runAgentAction: async (action) => action(),
    requireAgentClient: () => ({ login: async (input) => {
      assert.equal(input.server, oldServer)
      assert.equal(input.username, 'old-user')
      oldAttemptEntered.resolve()
      return oldAttemptResult.promise
    } }),
    formatLifecycleError: (error) => error instanceof Error ? error.message : String(error),
  }
  const keys = Object.keys(bindings)
  const main = new Function(...keys, transpiled + [
    'return {',
    'startOld: () => attemptAutomaticLogin(),',
    'manualSuccess: async (server, username, ciphertext, time) => {',
    "lastAutoLoginError = '';",
    'loginHistory = recordSuccessfulLogin(loginHistory, {',
    'server, username, encrypted_password: ciphertext, last_used_at: time,',
    'remember_password: true, auto_login: true,',
    '});',
    'await persistLoginHistoryBestEffort();',
    '},',
    'current: () => loginHistory,',
    'error: () => lastAutoLoginError,',
    '}',
  ].join('\n'))(...keys.map((key) => bindings[key]))
  return {
    main, oldAttemptEntered, oldAttemptResult,
    readDisk: async () => JSON.parse(await fsp.readFile(file, 'utf8')),
    cleanup: async () => { oldAttemptResult.resolve({ ok: false, error: { code: 'stale' } }); await fsp.rm(dir, { recursive: true, force: true }) },
  }
}

function assertNewestAutoLogin(history, server, username, ciphertext) {
  assert.equal(history.version, 1)
  const selected = automaticLoginProfile(history)
  assert.ok(selected, 'new successful manual login must keep its auto-login choice')
  assert.equal(selected.server, server)
  assert.equal(selected.username, username)
  assert.equal(selected.encrypted_password, ciphertext)
}

async function overlappingManualSuccess({ sameProfile }) {
  const f = await fixture()
  let old
  try {
    old = f.main.startOld()
    await f.oldAttemptEntered.promise
    const server = sameProfile ? oldServer : newerServer
    const username = sameProfile ? 'old-user' : 'new-user'
    const ciphertext = 'synthetic-new-accepted-ciphertext'
    await f.main.manualSuccess(server, username, ciphertext, '2026-10-14T00:00:00Z')
    assertNewestAutoLogin(f.main.current(), server, username, ciphertext)
    f.oldAttemptResult.resolve({ ok: false, error: {
      code: 'stale_auto_login_error', message: 'obsolete old credential failed',
    } })
    await old
    assertNewestAutoLogin(f.main.current(), server, username, ciphertext)
    assertNewestAutoLogin(await f.readDisk(), server, username, ciphertext)
    assert.equal(f.main.error(), '', 'stale old failure must not show an error after newer success')
  } finally {
    f.oldAttemptResult.resolve({ ok: false, error: { code: 'fixture_cleanup' } })
    await Promise.allSettled([old].filter(Boolean))
    await f.cleanup()
  }
}

test('late failed initial auto-login A cannot disable newer successful manual login B', async () => {
  await overlappingManualSuccess({ sameProfile: false })
})

test('late failed initial auto-login cannot disable newly saved credentials for the same profile', async () => {
  await overlappingManualSuccess({ sameProfile: true })
})

test('uncontested failed initial auto-login disables that obsolete automatic-login choice', async () => {
  const f = await fixture()
  let old
  try {
    old = f.main.startOld()
    await f.oldAttemptEntered.promise
    f.oldAttemptResult.resolve({ ok: false, error: {
      code: 'bad_credentials', message: 'credentials rejected',
    } })
    await old
    assert.equal(automaticLoginProfile(f.main.current()), undefined)
    assert.equal(automaticLoginProfile(await f.readDisk()), undefined)
    assert.match(f.main.error(), /credentials rejected/)
  } finally {
    f.oldAttemptResult.resolve({ ok: false, error: { code: 'fixture_cleanup' } })
    await Promise.allSettled([old].filter(Boolean))
    await f.cleanup()
  }
})
