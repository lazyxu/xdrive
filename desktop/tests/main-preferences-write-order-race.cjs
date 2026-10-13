const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { normalizeDesktopPreferences } = require('../dist/main/window_preferences.cjs')

const mainPath = path.join(__dirname, '..', 'src', 'main', 'index.cts')
const functionNames = ['saveDesktopPreferences', 'publicDesktopPreferences', 'setStartAtLogin', 'setCloseToTray']

function realMainFunctionSource() {
  const source = ts.createSourceFile(mainPath, fs.readFileSync(mainPath, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) &&
        statement.name && functionNames.includes(statement.name.text)) {
      found.set(statement.name.text, statement.getText(source))
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...functionNames].sort(),
    'must execute the four actual production Electron Main functions')
  return functionNames.map((name) => found.get(name)).join('\n\n')
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function realDiskFixture(holdFirst) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'xdrive-race-prefs-'))
  const filename = path.join(directory, 'preferences.json')
  const firstEntered = deferred()
  const releaseFirst = deferred()
  let ordinal = 0
  const writeFile = async (destination, bytes, options) => {
    const n = ++ordinal
    if (n === 1) {
      firstEntered.resolve()
      if (holdFirst) await releaseFirst.promise
    }
    // Actual OS file write of the actual serialized Main preference bytes.
    await fsp.writeFile(destination, bytes, options)
  }
  const source = [
    'let desktopPreferences = normalizeDesktopPreferences(initialPreferences)',
    'let desktopPreferencesWriteQueue = Promise.resolve()',
    realMainFunctionSource(),
  ].join('\n\n')
  const emitted = ts.transpileModule(source, {
    fileName: mainPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const bindings = {
    exports: {}, // TypeScript's .cts transpiler emits a CommonJS exports marker.
    initialPreferences: {
      appearance: 'system', start_at_login: true, close_to_tray: true,
      close_behavior_prompted: false, window_maximized: false,
    },
    normalizeDesktopPreferences,
    app: { getPath: (name) => {
      assert.equal(name, 'userData')
      return directory
    } },
    path, desktopPreferencesName: path.basename(filename),
    mkdir: fsp.mkdir, writeFile, applyStartAtLogin: async () => {},
  }
  const keys = Object.keys(bindings)
  const methods = new Function(...keys,
    emitted + '\nreturn { setStartAtLogin, setCloseToTray, current: () => desktopPreferences }',
  )(...keys.map((key) => bindings[key]))
  return {
    methods, firstEntered, releaseFirst,
    readDisk: async () => JSON.parse(await fsp.readFile(filename, 'utf8')),
    cleanup: async () => {
      releaseFirst.resolve()
      await fsp.rm(directory, { recursive: true, force: true })
    },
  }
}

async function exerciseOverlap(first, second) {
  const fixture = await realDiskFixture(true)
  let older, newer, timeout
  try {
    older = first(fixture.methods)
    await fixture.firstEntered.promise
    newer = second(fixture.methods)
    // Original Main lets the newer save finish while the earlier OS write is
    // blocked. A repaired writer is allowed to queue the newer save instead.
    // The bounded wait is never a test assertion or First-red by itself.
    await Promise.race([
      newer.then(() => 'ack', () => 'reject'),
      new Promise((done) => { timeout = setTimeout(() => done('queued'), 1200) }),
    ])
    clearTimeout(timeout)
    fixture.releaseFirst.resolve()
    await Promise.all([older, newer])
    assert.equal(fixture.methods.current().start_at_login, false)
    assert.equal(fixture.methods.current().close_to_tray, false)
    const disk = await fixture.readDisk()
    assert.equal(disk.start_at_login, false,
      'a completed newer preference write must not lose saved startup on disk')
    assert.equal(disk.close_to_tray, false,
      'a completed newer preference write must not lose saved close-to-tray on disk')
    assert.equal(disk.close_behavior_prompted, true,
      'the saved close-to-tray choice must be persisted')
  } finally {
    clearTimeout(timeout)
    fixture.releaseFirst.resolve()
    await Promise.allSettled([older, newer].filter(Boolean))
    await fixture.cleanup()
  }
}

test('Electron Main delayed startup JSON write must not overwrite newer saved close-to-tray', async () => {
  await exerciseOverlap(
    (main) => main.setStartAtLogin(false),
    (main) => main.setCloseToTray(false),
  )
})

test('Electron Main delayed close-to-tray JSON write must not erase newer saved startup', async () => {
  await exerciseOverlap(
    (main) => main.setCloseToTray(false),
    (main) => main.setStartAtLogin(false),
  )
})

test('Electron Main sequential settings saves retain both preferences on disk', async () => {
  const fixture = await realDiskFixture(false)
  try {
    await fixture.methods.setStartAtLogin(false)
    await fixture.methods.setCloseToTray(false)
    const disk = await fixture.readDisk()
    assert.equal(disk.start_at_login, false)
    assert.equal(disk.close_to_tray, false)
    assert.equal(disk.close_behavior_prompted, true)
  } finally {
    await fixture.cleanup()
  }
})
