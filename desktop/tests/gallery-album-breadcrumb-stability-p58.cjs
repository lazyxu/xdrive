const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

// Mount the ORIGINAL shared Web/Desktop Gallery organizer, not a navigation clone.
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
function compile(name, jsx = false) {
  return ts.transpileModule(read(name), {
    fileName: path.join(root, name),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined, esModuleInterop: true,
    },
  }).outputText
}
function moduleFor(name, imports, jsx = false) {
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', compile(name, jsx))(
    mod.exports, mod, key => {
      if (!Object.hasOwn(imports, key)) throw Error('Unexpected import: ' + key)
      return imports[key]
    },
  )
  return mod.exports
}
const organization = moduleFor('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts', {})
const folders = moduleFor('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts', {})
const mui = Object.fromEntries([
  'Alert', 'Box', 'Breadcrumbs', 'Button', 'CircularProgress',
  'Dialog', 'DialogActions', 'DialogContent', 'DialogTitle',
  'IconButton', 'MenuItem', 'Paper', 'Stack', 'TextField',
  'Tooltip', 'Typography',
].map(key => [key, key.toLowerCase()]))
const icons = new Proxy({}, { get: (_, key) => String(key) })
const Organizer = moduleFor('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  '@mui/icons-material': icons,
  './MediaGalleryCoverThumbnail': { XDriveMediaGalleryCoverThumbnail: 'thumbnail' },
  './MediaGalleryAlbumOrganization': organization,
  './MediaGalleryAlbumFolderModel': folders,
  './useDeferredLoading': { useXDriveDeferredLoading: () => false,
    useXDriveDeferredPendingLoading: () => false },
}, true).XDriveMediaGalleryAlbumOrganizer
const deepFolders = [
  { id: 10, parent_id: 0, revision: 1, name: '一段非常长的一级文件夹名称—日本春季旅行' },
  { id: 11, parent_id: 10, revision: 1, name: '二级目录—东京照片与回忆精选' },
  { id: 12, parent_id: 11, revision: 1, name: '三级目录—上野公园与新宿夜景' },
]
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const byAttribute = (view, key, value) => {
  const matches = view.root.findAll(node => node.props?.[key] === value)
  assert.equal(matches.length, 1, 'expected a single ' + key)
  return matches[0]
}
function folderOpen(view, id) {
  const card = byAttribute(view, 'data-xdrive-gallery-album-folder', id)
  const buttons = card.findAll(node => node.type === 'button' && typeof node.props.onClick === 'function')
  assert.ok(buttons.length > 0, 'original folder card should contain a navigation button')
  return buttons[0].props.onClick
}

test('P58: Mobile/Wide album folder path stays single-line and exposes active crumb without shifting chrome', async () => {
  const breadcrumbHost = { scrollLeft: 0, scrollWidth: 1024 }
  let reads = 0
  const actions = {
    list: async () => { reads++; return deepFolders },
    create: async () => { throw new Error('only navigation is under test') },
  }
  let view
  await act(async () => {
    view = Renderer.create(React.createElement(Organizer, {
      albums: [], accountScope: 'web:p58-stable-breadcrumb',
      folderActions: actions, loadThumbnail: async () => null,
    }), { createNodeMock: node => node.props?.['data-xdrive-gallery-album-breadcrumb-viewport']
      ? breadcrumbHost : null })
    await flush()
  })
  try {
    const row = byAttribute(view, 'data-xdrive-gallery-album-folder-nav-row', true)
    const originalRowStyle = row.props.sx
    assert.equal(originalRowStyle.minHeight, 44)
    assert.equal(originalRowStyle.flexWrap, 'nowrap')
    const viewport = byAttribute(view, 'data-xdrive-gallery-album-breadcrumb-viewport', true)
    assert.equal(viewport.props.sx.overflowX, 'auto')
    assert.equal(viewport.props.sx.overflowY, 'hidden')
    assert.equal(viewport.props.sx.minWidth, 0)
    const breadcrumb = view.root.findAll(node => node.type === 'breadcrumbs')[0]
    assert.ok(breadcrumb)
    assert.equal(breadcrumb.props.sx['& .MuiBreadcrumbs-ol'].flexWrap, 'nowrap')
    assert.equal(breadcrumb.props.sx['& .MuiBreadcrumbs-li'].flexShrink, 0)
    assert.equal(breadcrumbHost.scrollLeft, 0)
    assert.equal(view.root.findAll(node => node.type === 'button' &&
      node.props.children === '新建相册文件夹').length, 1,
    'create remains accessible on the fixed row')
    for (const [enterID, nextID] of [[10, 11], [11, 12], [12, null]]) {
      await act(async () => { folderOpen(view, enterID)(); await flush() })
      assert.equal(breadcrumbHost.scrollLeft, 1024,
        'new accepted folder should reveal rightmost breadcrumb before paint')
      const currentRowStyle = byAttribute(view, 'data-xdrive-gallery-album-folder-nav-row', true).props.sx
      assert.equal(currentRowStyle.minHeight, originalRowStyle.minHeight,
        'navigation must retain the original 44px toolbar geometry')
      assert.equal(currentRowStyle.flexWrap, originalRowStyle.flexWrap,
        'navigation must never wrap the toolbar')
      assert.equal(view.root.findAll(node => node.type === 'button' &&
        node.props['aria-current'] === 'page').length, 1,
      'exactly one active breadcrumb should be announced')
      if (nextID !== null) byAttribute(view, 'data-xdrive-gallery-album-folder', nextID)
    }
    const rootCrumb = view.root.findAll(node => node.type === 'button' &&
      node.props.children === '所有相册')[0]
    assert.ok(rootCrumb)
    await act(async () => { rootCrumb.props.onClick(); await flush() })
    assert.equal(breadcrumbHost.scrollLeft, 0,
      'back to root restores breadcrumb origin but not Gallery media scroll')
    byAttribute(view, 'data-xdrive-gallery-album-folder', 10)
    assert.equal(reads, 1, 'cached authoritative folder hierarchy needs no extra API')
  } finally {
    await act(async () => { view.unmount() })
  }
})

test('P58: no wrapping on narrow viewports; no duplicate Gallery/API or thumbnail suppression', () => {
  const source = read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.ok(source.includes('data-xdrive-gallery-album-breadcrumb-viewport'))
  assert.ok(source.includes("overflowX: 'auto', overflowY: 'hidden'"))
  assert.ok(source.includes("viewport.scrollLeft = visibleFolderID === 0 ? 0 : viewport.scrollWidth"))
  assert.ok(source.includes("aria-current={folder.id === visibleFolderID ? 'page' : undefined}"))
  assert.ok(source.includes('maxWidth: 180'))
  assert.ok(source.includes('<XDriveMediaGalleryCoverThumbnail'))
  assert.ok(gallery.includes('<XDriveMediaGalleryAlbumOrganizer'))
  assert.ok(web.includes('<XDriveMediaGalleryPage'))
  assert.ok(desktop.includes('<XDriveMediaGalleryPage'))
  assert.equal(source.includes('flexWrap="wrap" useFlexGap'), false)
  assert.equal(source.includes('api.listAlbumFolders('), false)
})
