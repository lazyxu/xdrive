const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const {
  normalizeLoginHistory, clearSavedPassword, recordSuccessfulLogin,
} = require('../dist/main/login_history.cjs')

const filename = path.join(__dirname, '..', 'src', 'main', 'index.cts')
const functions = ['saveLoginHistory', 'persistLoginHistoryBestEffort']
const server = 'https://race.example.invalid'
const username = 'race-test-user'

function mainPersistenceFunctions() {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name &&
        functions.includes(statement.name.text)) {
      found.set(statement.name.text, statement.getText(source))
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...functions].sort(),
    'must execute actual Electron Main login history persistence functions')
  return functions.map((name) => found.get(name)).join('\n\n')
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture(holdFirst) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'xdrive-race-login-history-'))
  const file = path.join(dir, 'desktop-login-history.json')
  const firstEntered = deferred()
  const releaseFirst = deferred()
  let ordinal = 0
  const writeFile = async (destination, bytes, options) => {
    assert.equal(destination, file, 'only the private test login-history path may be written')
    if (++ordinal === 1) {
      firstEntered.resolve()
      if (holdFirst) await releaseFirst.promise
    }
    // Actual serialized production bytes are written to a real temporary OS file.
    await fsp.writeFile(destination, bytes, options)
  }
  const initial = normalizeLoginHistory({ profiles: [{
    server, username, last_used_at: '2026-10-01T00:00:00Z',
    remember_password: true, auto_login: true,
    encrypted_password: 'synthetic-before-clear',
  }] })
  const extracted = [
    'let loginHistory = normalizeLoginHistory(initial)',
    'let mainWindow = null',
    'let lifecycleLog = null',
    mainPersistenceFunctions(),
  ].join('\n\n')
  const emitted = ts.transpileModule(extracted, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const bindings = {
    exports: {}, initial, server, username, normalizeLoginHistory, clearSavedPassword, recordSuccessfulLogin,
    app: { getPath: (key) => {
      assert.equal(key, 'userData')
      return dir
    } },
    loginHistoryName: path.basename(file),
    path, mkdir: fsp.mkdir, writeFile,
  }
  const keys = Object.keys(bindings)
  const main = new Function(...keys, emitted + [
    'return {',
    'remember: (cipher, time) => {',
    'loginHistory = recordSuccessfulLogin(loginHistory, { server, username,',
    'last_used_at: time, remember_password: true, auto_login: true,',
    'encrypted_password: cipher });',
    'return persistLoginHistoryBestEffort(); },',
    'clear: () => { loginHistory = clearSavedPassword(loginHistory, server, username);',
    'return persistLoginHistoryBestEffort(); },',
    'current: () => loginHistory,',
    '}',
  ].join('\n'))(...keys.map((key) => bindings[key]))
  return {
    main, firstEntered, releaseFirst,
    readDisk: async () => JSON.parse(await fsp.readFile(file, 'utf8')),
    cleanup: async () => {
      releaseFirst.resolve()
      await fsp.rm(dir, { recursive: true, force: true })
    },
  }
}

function credentialState(history) {
  assert.equal(history.version, 1)
  assert.equal(history.profiles.length, 1)
  const profile = history.profiles[0]
  assert.equal(profile.server, server)
  assert.equal(profile.username, username)
  return {
    remembered: profile.remember_password,
    automatic: profile.auto_login,
    ciphertext: profile.encrypted_password ?? null,
  }
}

async function overlappingHistory(first, second, expected) {
  const f = await fixture(true)
  let older, newer, timer
  try {
    older = first(f.main)
    // This is a genuine old Main writeFile call, after it captured old JSON.
    await Promise.race([
      f.firstEntered.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('old login history write not reached')), 4000) }),
    ])
    clearTimeout(timer)
    newer = second(f.main)
    // The old writer may finish last on original product; a safe writer may
    // serialize both calls instead. This bounded wait is not a First-red.
    await Promise.race([
      newer.then(() => 'ack', () => 'reject'),
      new Promise((done) => { timer = setTimeout(() => done('queued'), 1000) }),
    ])
    clearTimeout(timer)
    f.releaseFirst.resolve()
    await Promise.all([older, newer])
    assert.deepEqual(credentialState(f.main.current()), expected,
      'newer acknowledged action must own current Main login history')
    assert.deepEqual(credentialState(await f.readDisk()), expected,
      'an older in-flight OS write must not restore or erase saved login credentials')
  } finally {
    clearTimeout(timer)
    f.releaseFirst.resolve()
    await Promise.allSettled([older, newer].filter(Boolean))
    await f.cleanup()
  }
}

test('Electron Main delayed login-history save must not resurrect a cleared saved password', async () => {
  await overlappingHistory(
    (main) => main.remember('synthetic-old-login', '2026-10-10T00:00:00Z'),
    (main) => main.clear(),
    { remembered: false, automatic: false, ciphertext: null },
  )
})

test('Electron Main delayed password-clear disk save must not erase a newer saved login', async () => {
  await overlappingHistory(
    (main) => main.clear(),
    (main) => main.remember('synthetic-new-login', '2026-10-11T00:00:00Z'),
    { remembered: true, automatic: true, ciphertext: 'synthetic-new-login' },
  )
})

test('Electron Main uncontested login history remember then clear persists safely', async () => {
  const f = await fixture(false)
  try {
    await f.main.remember('synthetic-control', '2026-10-12T00:00:00Z')
    assert.equal(credentialState(await f.readDisk()).ciphertext, 'synthetic-control')
    await f.main.clear()
    assert.deepEqual(credentialState(await f.readDisk()),
      { remembered: false, automatic: false, ciphertext: null })
  } finally {
    await f.cleanup()
  }
})
