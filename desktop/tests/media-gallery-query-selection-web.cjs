const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const file = 'ui/shared/src/mui/MediaGalleryQuerySelection.tsx'
const output = ts.transpileModule(read(file), {
  fileName: path.join(root, file),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress', Dialog: 'dialog',
  DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  Stack: 'stack', TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => false,
}
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material/CloseRounded': 'close',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const moduleUnderTest = { exports: {} }
new Function('exports', 'module', 'require', output)(
  moduleUnderTest.exports, moduleUnderTest,
  (name) => {
    if (!Object.hasOwn(deps, name)) throw Error('Unexpected dependency ' + name)
    return deps[name]
  },
)
const Selection = moduleUnderTest.exports.XDriveMediaGalleryQuerySelection
const snapshot = {
  token: 'snapshot-token', version: 1, total: 230, selected: 230,
  excluded: 0, day: '', expires_at: '2026-10-09T20:00:00Z',
}
const row = (n) => ({
  node_id: n, revision: 2, name: 'image-' + n + '.jpg', stale: false,
})
const page = (offset, selected = 230, version = 1) => ({
  ...snapshot, selected, excluded: 230 - selected, version,
  offset, limit: 100,
  items: Array.from({ length: Math.min(100, Math.max(0, selected - offset)) },
    (_, i) => row(offset + i + 1)),
  has_more: offset + 100 < selected,
})
const queryButton = (view, attr) =>
  view.root.findAll((n) => n.type === 'button' && n.props[attr])[0]
const buttonText = (view, value) => view.root.findAll(
  (n) => n.type === 'button' && n.props.children === value,
)[0]
const rows = (view) => view.root.findAll(
  (n) => n.props['data-xdrive-gallery-snapshot-row'] !== undefined,
)
const renderProps = (actions, overrides = {}) => ({
  actions, timeZone: 'Asia/Singapore', sortBy: 'captured', ...overrides,
})

test('G07 Web query selection reviews only bounded pages, excludes and releases', async () => {
  const calls = { create: [], page: [], exclude: [], release: [] }
  let currentSelected = 230
  let currentVersion = 1
  const actions = {
    create: async (day) => { calls.create.push(day); return { ...snapshot } },
    page: async (token, offset, limit) => {
      calls.page.push([token, offset, limit])
      return page(offset, currentSelected, currentVersion)
    },
    exclude: async (token, nodeID, excluded, version) => {
      calls.exclude.push([token, nodeID, excluded, version])
      assert.equal(version, currentVersion)
      currentVersion += 1
      currentSelected += excluded ? -1 : 1
      return { ...snapshot, selected: currentSelected, excluded: 230 - currentSelected,
        version: currentVersion }
    },
    release: async (token) => { calls.release.push(token) },
  }
  let activated = 0
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Selection, renderProps(
      actions, { onActivated: () => { activated += 1 } },
    )))
  })
  await act(async () => { queryButton(view, 'data-xdrive-gallery-select-query').props.onClick() })
  assert.equal(activated, 1)
  assert.deepEqual(calls.create, [undefined])
  assert.deepEqual(calls.page[0], ['snapshot-token', 0, 100])
  assert.equal(rows(view).length, 100)
  assert.equal(rows(view)[0].props['data-xdrive-gallery-snapshot-row'], 1)

  await act(async () => { buttonText(view, '下一页').props.onClick() })
  assert.equal(rows(view)[0].props['data-xdrive-gallery-snapshot-row'], 101)
  const exclude = view.root.findAll((n) => n.type === 'button' &&
    n.props['aria-label'] === '排除 image-101.jpg')[0]
  await act(async () => { exclude.props.onClick() })
  assert.deepEqual(calls.exclude[0], ['snapshot-token', 101, true, 1])
  assert.equal(currentSelected, 229)
  await act(async () => { buttonText(view, '恢复选择').props.onClick() })
  assert.deepEqual(calls.exclude[1], ['snapshot-token', 101, false, 2])
  assert.equal(currentSelected, 230)
  await act(async () => { buttonText(view, '完成审核').props.onClick() })
  assert.deepEqual(calls.release, ['snapshot-token'])
  await act(async () => { view.unmount() })
  assert.equal(calls.release.length, 1, 'already-released tokens cannot leak or release twice')
})

test('G07 date action forwards exact IANA calendar day; no implicit work on first paint', async () => {
  const created = []
  const actions = {
    create: async (day) => { created.push(day); return { ...snapshot, day } },
    page: async (_token, offset) => page(offset),
    exclude: async () => { throw Error('not used') },
    release: async () => {},
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(
    Selection, renderProps(actions),
  )) })
  assert.deepEqual(created, [], 'initial Gallery open must not scan 100k')
  const input = view.root.findAll((n) =>
    n.type === 'textfield' && n.props['data-xdrive-gallery-selection-day'])[0]
  await act(async () => { input.props.onChange({ target: { value: '2026-03-08' } }) })
  await act(async () => { queryButton(view, 'data-xdrive-gallery-select-day').props.onClick() })
  assert.deepEqual(created, ['2026-03-08'])
  await act(async () => { view.unmount() })
})

test('G07 stale creation after scope unmount is immediately released', async () => {
  let resolve
  let released = ''
  let view
  const actions = {
    create: () => new Promise((r) => { resolve = r }),
    page: async () => { throw Error('stale creation must not page') },
    exclude: async () => { throw Error('stale creation must not mutate') },
    release: async (token) => { released = token },
  }
  await act(async () => { view = renderer.create(React.createElement(
    Selection, renderProps(actions),
  )) })
  await act(async () => { queryButton(view, 'data-xdrive-gallery-select-query').props.onClick() })
  await act(async () => { view.unmount() })
  await act(async () => { resolve({ ...snapshot }) })
  assert.equal(released, snapshot.token)
})

test('G07 shared selection cannot promote a frozen token into MediaItem[] batch mutation', () => {
  const shared = read('ui/shared/src/mui/MediaGallery.tsx')
  const controller = read(file)
  const api = read('web/src/api.ts')
  const web = read('web/src/mediaGalleryAdapter.ts')
  assert.match(shared, /querySelectionActions=/)
  assert.match(shared, /collectionTarget\.kind === 'all'/)
  assert.match(shared, /collectionTarget\.kind === 'album'/)
  assert.match(shared, /collectionTarget\.query\.fold_duplicates/)
  assert.match(shared, /anchor_node_id: undefined/)
  assert.match(api, /appendMediaGalleryQuery\(params, filters\)/)
  assert.match(api, /params\.set\('album_id', albumID\)/)
  assert.match(api, /params\.set\('day', day\)/)
  assert.match(web, /createSelectionSnapshot: \(query, albumID, day\)/)
  assert.doesNotMatch(controller, /onDeleteItems|onSetFavoriteBatch|downloadArchive/)
  assert.match(controller, /release\(token\)/)
  assert.match(controller, /version/)
})
