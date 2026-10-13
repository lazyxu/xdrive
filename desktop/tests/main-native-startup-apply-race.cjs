const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { normalizeDesktopPreferences } = require('../dist/main/window_preferences.cjs')

const filename = path.join(__dirname, '..', 'src', 'main', 'index.cts')
const functions = ['saveDesktopPreferences', 'quoteDesktopExec', 'applyStartAtLogin', 'setStartAtLogin']

function originalMainFunctions() {
  const source = ts.createSourceFile(
    filename, fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  )
  const declarations = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name &&
        functions.includes(statement.name.text)) {
      declarations.set(statement.name.text, statement.getText(source))
    }
  }
  assert.deepEqual([...declarations.keys()].sort(), [...functions].sort(),
    'run actual Main preference persistence and packaged Linux startup application')
  return functions.map((name) => declarations.get(name)).join('\n\n')
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture({ initiallyEnabled, holdNative }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'xdrive-native-startup-race-'))
  const configHome = path.join(root, 'xdg')
  const userData = path.join(root, 'user-data')
  const startupFile = path.join(configHome, 'autostart', 'xdrive-desktop.desktop')
  if (initiallyEnabled) {
    await fsp.mkdir(path.dirname(startupFile), { recursive: true })
    await fsp.writeFile(startupFile, 'original enabled startup entry\n')
  }
  const nativeEntered = deferred()
  const releaseNative = deferred()
  let intercepted = false
  const rm = async (target, options) => {
    if (target === startupFile && holdNative === 'remove' && !intercepted) {
      intercepted = true
      nativeEntered.resolve()
      await releaseNative.promise
    }
    return fsp.rm(target, options)
  }
  const writeFile = async (target, bytes, options) => {
    if (target === startupFile && holdNative === 'write' && !intercepted) {
      intercepted = true
      nativeEntered.resolve()
      await releaseNative.promise
    }
    return fsp.writeFile(target, bytes, options)
  }
  const extracted = [
    'let desktopPreferences = normalizeDesktopPreferences(initial)',
    'let desktopPreferencesWriteQueue = Promise.resolve()',
    // Inert for original production; this mirrors the optional scoped
    // serialized-native-apply tail when verifying any future repair.
    'let desktopStartupApplyQueue = Promise.resolve()',
    originalMainFunctions(),
  ].join('\n\n')
  const compiled = ts.transpileModule(extracted, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const binding = {
    exports: {},
    initial: {
      appearance: 'system', start_at_login: initiallyEnabled,
      close_to_tray: true, close_behavior_prompted: false,
      window_maximized: false,
    },
    normalizeDesktopPreferences,
    app: {
      isPackaged: true,
      getPath: (key) => {
        assert.equal(key, 'userData')
        return userData
      },
    },
    process: {
      platform: 'linux',
      execPath: '/opt/xdrive/xdrive-desktop',
      env: { XDG_CONFIG_HOME: configHome },
    },
    path, os, mkdir: fsp.mkdir, rm, writeFile,
    desktopPreferencesName: 'desktop-settings.json',
  }
  const keys = Object.keys(binding)
  const main = new Function(...keys,
    compiled + '\nreturn { setStartAtLogin, current: () => desktopPreferences }',
  )(...keys.map((key) => binding[key]))
  const persisted = () => fsp.readFile(path.join(userData, 'desktop-settings.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
  const nativeExists = async () => {
    try {
      return (await fsp.stat(startupFile)).isFile()
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  return {
    main, nativeEntered, releaseNative, persisted, nativeExists,
    readNative: () => fsp.readFile(startupFile, 'utf8'),
    cleanup: async () => {
      releaseNative.resolve()
      await fsp.rm(root, { recursive: true, force: true })
    },
  }
}

async function overlappingNativeStartup({ initiallyEnabled, first, second, holdNative }) {
  const f = await fixture({ initiallyEnabled, holdNative })
  let older, newer, timeout
  try {
    older = f.main.setStartAtLogin(first)
    // This must be a REAL native applyStartAtLogin operation, not a timer,
    // copied business method or an artificial startup-state mock.
    await Promise.race([
      f.nativeEntered.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('native test setup did not reach old apply')), 4000)
      }),
    ])
    clearTimeout(timeout)
    newer = f.main.setStartAtLogin(second)
    // Original product can acknowledge the newer OS action before the held
    // older OS operation completes. A correctly serialized repair may wait.
    // The timeout outcome is NOT a test assertion or First-red.
    await Promise.race([
      newer.then(() => 'acknowledged', () => 'rejected'),
      new Promise((done) => { timeout = setTimeout(() => done('queued'), 1000) }),
    ])
    clearTimeout(timeout)
    f.releaseNative.resolve()
    await Promise.all([older, newer])

    assert.equal(f.main.current().start_at_login, second,
      'native Main in-memory preference must retain last accepted choice')
    const disk = await f.persisted()
    assert.equal(disk.start_at_login, second,
      'serialized preferences JSON must retain newest accepted choice')
    const installed = await f.nativeExists()
    assert.equal(installed, second,
      'after both successful saves the actual Linux autostart file must match newest accepted startup choice')
    if (second) {
      const desktopEntry = await f.readNative()
      assert.match(desktopEntry, /X-GNOME-Autostart-enabled=true/,
        'enabled startup must have an actual generated Linux desktop entry')
    }
  } finally {
    clearTimeout(timeout)
    f.releaseNative.resolve()
    await Promise.allSettled([older, newer].filter(Boolean))
    await f.cleanup()
  }
}

test('Electron Main late native disable must not delete a newer saved enabled autostart', async () => {
  await overlappingNativeStartup({
    initiallyEnabled: true, first: false, second: true, holdNative: 'remove',
  })
})

test('Electron Main late native enable must not recreate a newer disabled autostart', async () => {
  await overlappingNativeStartup({
    initiallyEnabled: false, first: true, second: false, holdNative: 'write',
  })
})

test('Electron Main uncontested packaged Linux autostart enable and disable persists', async () => {
  const f = await fixture({ initiallyEnabled: false, holdNative: null })
  try {
    await f.main.setStartAtLogin(true)
    assert.equal((await f.persisted()).start_at_login, true)
    assert.equal(await f.nativeExists(), true)
    assert.match(await f.readNative(), /X-GNOME-Autostart-enabled=true/)
    await f.main.setStartAtLogin(false)
    assert.equal((await f.persisted()).start_at_login, false)
    assert.equal(await f.nativeExists(), false)
  } finally {
    await f.cleanup()
  }
})
