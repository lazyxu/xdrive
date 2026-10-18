'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const root = path.resolve(__dirname, '../..')
const homeFile = path.join(root, 'ui/shared/src/mui/HomePage.tsx')
const realSource = fs.readFileSync(homeFile, 'utf8')
const compiled = ts.transpileModule(realSource, {
  fileName: homeFile,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const mui = new Proxy({}, { get: (_, name) => String(name) })
const components = {
  './ActionButton': { XDriveActionButton: 'ActionButton' },
  './FileExplorer': {
    XDriveFileExplorerAvailabilityBadge: 'AvailabilityBadge',
    XDriveFileExplorerItemIcon: 'ItemIcon',
    xDriveFileSupportsThumbnail: () => true,
  },
  './FileExplorerThumbnail': {
    XDriveFileExplorerThumbnail: 'FileThumbnail',
    XDriveFileExplorerThumbnailProvider: 'ThumbnailProvider',
  },
  './MetricCards': {
    XDriveMetricCard: 'MetricCard',
    XDriveMetricGrid: 'MetricGrid',
  },
  './SectionHeader': { XDriveSectionHeader: 'SectionHeader' },
  './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  './WorkspaceSurface': { XDriveWorkspaceSurface: 'WorkspaceSurface' },
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled)(
  mod, mod.exports, dependency => {
    if (dependency === 'react') return React
    if (dependency === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (dependency === '@mui/material') return mui
    if (dependency.startsWith('@mui/icons-material/')) {
      return { __esModule: true, default: 'Icon' }
    }
    if (dependency === '../format') return { formatBytes: value => String(value) + ' B' }
    if (Object.hasOwn(components, dependency)) return components[dependency]
    throw Error('Unexpected actual HomePage dependency: ' + dependency)
  },
)
const Home = mod.exports.XDriveHomePage
assert.equal(typeof Home, 'function', 'must mount the actual shared Home renderer')

function defaults(overrides = {}) {
  return {
    lifecycleKey: 'p80-owner-A', sync: { value: '已同步', tone: 'good' },
    activeTaskCount: 0, recentVerified: false, favoritesVerified: false,
    recentLoading: false, favoritesLoading: false, listReadEpoch: 0,
    recentItems: [], favoriteItems: [],
    onOpenFiles() {}, onOpenGallery() {}, onOpenTransfers() {},
    ...overrides,
  }
}
function marked(view, name) {
  return view.root.findAll(node => Object.hasOwn(node.props ?? {}, name))
}
function panels(view) {
  return view.root.findAll(node => node.type === 'StatePanel' || node.type === 'CircularProgress')
}
async function withHome(run, initial) {
  let tree
  let props = defaults(initial)
  try {
    await act(async () => { tree = Renderer.create(React.createElement(Home, props)) })
    await run({
      view: tree,
      async update(patch) {
        props = { ...props, ...patch }
        await act(async () => { tree.update(React.createElement(Home, props)) })
      },
    })
  } finally {
    if (tree) await act(async () => { tree.unmount() })
  }
}

test('P80 original Home first cold/idle/held GET stays silent and fixed for both list cards', async () => {
  await withHome(async ({ view, update }) => {
    const verify = () => {
      const slots = marked(view, 'data-xdrive-home-list-first-read')
      assert.equal(slots.length, 2, 'one consistent slot per current-Owner list')
      for (const slot of slots) {
        assert.equal(slot.props['aria-busy'], true)
        assert.equal(slot.props.sx.minHeight, 96)
      }
      assert.equal(panels(view).length, 0, 'no visible transient loading panel')
    }
    verify()
    await update({ recentLoading: true, favoritesLoading: true, listReadEpoch: 1 })
    verify()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    verify()
    await update({ recentLoading: false, favoritesLoading: false, listReadEpoch: 2 })
    verify()
  })
})

test('P80 original Home accepts true empty/error while preserving the same 96px card geometry', async () => {
  await withHome(async ({ view, update }) => {
    await update({ recentError: '最近项目读取失败，请重试', favoritesError: '收藏读取失败' })
    assert.equal(marked(view, 'data-xdrive-home-list-first-read').length, 2)
    for (const slot of marked(view, 'data-xdrive-home-list-first-read')) {
      assert.equal(slot.props['aria-busy'], undefined, 'terminal failures are not pending')
      assert.equal(slot.props.sx.minHeight, 96)
    }
    assert.equal(panels(view).length, 0)
    await update({
      recentVerified: true, favoritesVerified: true,
      recentError: undefined, favoritesError: undefined,
    })
    assert.equal(marked(view, 'data-xdrive-home-list-first-read').length, 0)
    const empty = marked(view, 'data-xdrive-home-list-verified-empty')
    assert.equal(empty.length, 2)
    for (const slot of empty) assert.equal(slot.props.sx.minHeight, 96)
    assert.equal(panels(view).length, 0)
  })
})

test('P80 accepted original Home rows persist through an unrelated same-owner refresh', async () => {
  const row = {
    item: { id: 12, name: 'family.jpg', kind: 'file', revision: 1 },
    secondary: '昨天', onOpen() {},
  }
  await withHome(async ({ view, update }) => {
    assert.equal(marked(view, 'data-xdrive-home-list-first-read').length, 0)
    assert.equal(view.root.findAll(node => node.type === 'FileThumbnail').length, 1,
      'real thumbnail feedback belongs to the media renderer')
    await update({ recentLoading: true, favoritesLoading: true, listReadEpoch: 4 })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 355)) })
    assert.equal(view.root.findAll(node => node.type === 'FileThumbnail').length, 1)
    assert.equal(marked(view, 'data-xdrive-home-list-first-read').length, 0)
    assert.equal(panels(view).length, 0)
  }, {
    recentVerified: true, favoritesVerified: true,
    recentItems: [row],
  })
})
