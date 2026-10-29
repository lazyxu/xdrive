'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const name = 'ui/shared/src/mui/FileExplorerViewPreference.ts'
const transpiled = ts.transpileModule(read(name), {
  fileName: name,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, require)
const {
  XDRIVE_HOST_FILES_PREFERENCES: keys,
  xDriveReadFileExplorerStoredViewMode: readMode,
  useXDriveFileExplorerPersistedViewMode: usePreference,
} = mod.exports

function scopedStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  const writes = []
  return {
    values, writes,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
}
function withWindow(value, callback) {
  const original = global.window
  global.window = value
  try { return callback() } finally { global.window = original }
}

test('Desktop legacy view-mode/layout preferences retain their unchanged schema', () => {
  assert.deepEqual(keys, {
    viewMode: 'xdrive.desktop.files.view_mode',
    detailsLayout: 'xdrive.desktop.files.details_layout',
    viewPreferences: 'xdrive.desktop.files.view_preferences',
  })
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const dsm = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
  const navigation = read('ui/shared/src/mui/FileExplorerNavigation.ts')
  for (const name of ['viewMode', 'detailsLayout', 'viewPreferences']) {
    assert.ok(desktop.includes('XDRIVE_HOST_FILES_PREFERENCES.' + name),
      'Desktop must use the shared persisted key: ' + name)
    assert.ok(dsm.includes('XDRIVE_HOST_FILES_PREFERENCES.' + name),
      'DSM must use the same UI preference schema: ' + name)
  }
  assert.match(navigation, /function loadStoredViewMode\(storageKey/)
  // Desktop's existing tabbed navigation stays backed by its original denial-
  // safe loader. DSM reads the same schema via the shared single-page hook.
  assert.match(dsm, /viewMode=\{viewMode\}/)
  assert.match(dsm, /onViewModeChange=\{onViewModeChange\}/)
  assert.match(dsm, /detailsPreferencesKey=\{XDRIVE_HOST_FILES_PREFERENCES\.detailsLayout\}/)
  assert.match(dsm, /viewPreferencesKey=\{XDRIVE_HOST_FILES_PREFERENCES\.viewPreferences\}/)
})

test('shared view reader rejects unrecognized preferences and tolerates absent or restricted storage', () => {
  const values = scopedStorage({ mode: 'grid' })
  withWindow({ localStorage: values }, () => {
    assert.equal(readMode('mode'), 'grid')
    values.values.set('mode', 'columns')
    assert.equal(readMode('mode'), 'columns')
    for (const value of ['invalid', 'GRID', '0', '', 'admin-users', '{}']) {
      values.values.set('mode', value)
      assert.equal(readMode('mode'), 'details')
    }
    assert.equal(readMode('missing'), 'details')
  })
  withWindow({ get localStorage() { throw Error('blocked') } }, () => {
    assert.equal(readMode('mode'), 'details')
  })
  withWindow(undefined, () => assert.equal(readMode('mode'), 'details'))
})

test('shared controlled mode persists only appearance; a changed Host storage key immediately changes scope', () => {
  const storage = scopedStorage({ first: 'grid', second: 'details' })
  withWindow({ localStorage: storage }, () => {
    let state
    let renderer
    function Harness({ storageKey }) {
      state = usePreference(storageKey)
      return React.createElement('p', null, state.viewMode)
    }
    Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness, { storageKey: 'first' })) })
    assert.equal(state.viewMode, 'grid')
    Renderer.act(() => state.onViewModeChange('details'))
    assert.equal(state.viewMode, 'details')
    assert.deepEqual(storage.writes, [['first', 'details']])
    Renderer.act(() => renderer.update(React.createElement(Harness, { storageKey: 'second' })))
    assert.equal(state.viewMode, 'details')
    Renderer.act(() => state.onViewModeChange('grid'))
    assert.deepEqual(storage.writes, [['first', 'details'], ['second', 'grid']])
    Renderer.act(() => state.onViewModeChange('invalid'))
    assert.equal(state.viewMode, 'grid')
    assert.equal(storage.writes.length, 2)
    Renderer.act(() => renderer.unmount())
  })
})

test('denied persistence cannot unmount FileExplorer or elevate an Owner action', () => {
  withWindow({
    localStorage: {
      getItem() { throw Error('no storage access') },
      setItem() { throw Error('no storage access') },
    },
  }, () => {
    let state
    let renderer
    function Harness() {
      state = usePreference('read-only')
      return React.createElement('p', null, state.viewMode)
    }
    Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness)) })
    assert.equal(state.viewMode, 'details')
    Renderer.act(() => state.onViewModeChange('grid'))
    assert.equal(state.viewMode, 'grid')
    Renderer.act(() => renderer.unmount())
  })
  const dsm = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
  assert.match(dsm, /unavailableActions=\{unavailableActions\}/)
  assert.match(dsm, /currentScopeVerified/)
  assert.match(dsm, /isCurrentOwner/)
  assert.doesNotMatch(read(name), /fetch\s*\(|window\.xdriveDesktop|ipcRenderer|credentials|OwnerRoot/)
})
