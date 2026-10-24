const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
let width = 390
const host = tag => ({ children, ...props }) => React.createElement(tag, props, children)
const mui = {
  Box: host('div'), Stack: host('div'),
  IconButton: host('button'), MenuItem: host('menuitem'),
  Menu: ({ open, children, ...props }) => open ? React.createElement('menu', props, children) : null,
  Tooltip: ({ children }) => children,
  useMediaQuery: query => {
    assert.equal(query, '(max-width:899.95px)')
    return width < 900
  },
}
const ui = {
  './ConfirmDialog': {
    XDriveConfirmDialog: props => React.createElement('test-confirm', props),
  },
  './FileOpenPreviewDialog': {
    XDriveOpenPreviewDialog: ({ actions, children, ...props }) =>
      React.createElement('test-shared-viewer', props, actions, children),
  },
  './MediaGalleryCreativeDialog': {
    XDriveMediaGalleryCreativeDialog: () => null,
    xDriveMediaItemSupportsCreative: () => false,
  },
  './MediaGalleryEditDialog': { XDriveMediaGalleryEditDialog: props => React.createElement('test-edit-dialog', props) },
  './MediaGalleryViewerLocationDialog': { XDriveMediaGalleryViewerLocationDialog: () => null },
  './MediaGalleryFilmstrip': { XDriveMediaGalleryFilmstrip: () => null },
  './MediaViewerContent': { XDriveMediaViewerContent: props => React.createElement('test-media-content', props) },
  '../media-edit': { xDriveMediaItemSupportsBasicEditing: () => true },
  '../media-viewer': { xDriveMediaCaptureTimeLabel: () => '' },
}
const slideshowModule = { exports: {} }
const slideshowPath = path.join(root, 'ui/shared/src/mui/usePreviewSlideshow.ts')
const slideshowJS = ts.transpileModule(fs.readFileSync(slideshowPath, 'utf8'), {
  fileName: slideshowPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
new Function('exports', 'module', 'require', slideshowJS)(
  slideshowModule.exports, slideshowModule, name => name === 'react' ? React : require(name))
ui['./usePreviewSlideshow'] = slideshowModule.exports
// Use the real file-preview classifier rather than hard-coding still behavior.
const previewModule = { exports: {} }
const previewPath = path.join(root, 'ui/shared/src/file-preview.ts')
const previewJS = ts.transpileModule(fs.readFileSync(previewPath, 'utf8'), {
  fileName: previewPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
new Function('exports', 'module', 'require', previewJS)(
  previewModule.exports, previewModule, name => require(name))
ui['../file-preview'] = previewModule.exports
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryViewer.tsx')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'module', 'require', compiled)(loaded.exports, loaded, name => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(name)
  if (name === '@mui/material') return mui
  if (name.startsWith('@mui/icons-material/')) return () => null
  if (ui[name]) return ui[name]
  throw new Error('unexpected Viewer dependency: ' + name)
})
const Viewer = loaded.exports.XDriveMediaGalleryViewer
const item = {
  node: { id: 1991, revision: 3, name: 'captured.jpg', type: 'file' },
  metadata: { media_kind: 'image', mime_type: 'image/jpeg', latitude: 39.9, longitude: 116.3 },
}
const findButton = (renderer, name) => renderer.root.findAll(el =>
  el.type === 'button' && el.props['aria-label'] === name)
const findMenuAction = (renderer, name) => renderer.root.findAll(el =>
  el.type === 'menuitem' && el.props['aria-label'] === name)

test('P1 inline Gallery Viewer matches routed Web compact More and keeps full desktop actions', async () => {
  for (const nextWidth of [390, 899, 900]) {
    width = nextWidth
    const downloads = [], infos = [], maps = []
    let renderer
    try {
      await act(async () => {
        renderer = create(React.createElement(Viewer, {
          item, activeIndex: 0, canPrevious: false, canNext: false,
          filmstripEntries: [], loadThumbnail: async () => null,
          onPrevious() {}, onNext() {}, onFilmstripSelect() {}, onClose() {},
          onDownload: async value => downloads.push(value.node.id),
          onInfo: value => infos.push(value.node.id),
          onSaveEditRecipe: async () => ({ revision: 1 }),
          onShare() {}, onDelete: async () => {},
          onOpenDynamicMap: () => maps.push(item.node.id),
        }))
      })
      const compact = nextWidth < 900
      assert.equal(findButton(renderer, '更多照片操作').length, compact ? 1 : 0)
      assert.equal(findButton(renderer, '下载媒体').length, compact ? 0 : 1)
      assert.equal(findButton(renderer, '查看属性').length, 1, 'Info is always directly visible')
      assert.equal(findButton(renderer, '编辑媒体').length, compact ? 0 : 1, 'Edit moves to compact More')
      assert.equal(findButton(renderer, '分享媒体').length, 1,
        'share stays a primary action on both widths')
      assert.equal(findButton(renderer, '删除媒体').length, 1,
        'delete confirmation remains reachable on both widths')
      if (compact) {
        await act(async () => {
          findButton(renderer, '更多照片操作')[0].props.onClick({ currentTarget: {} })
        })
        for (const label of ['在地图上查看照片', '编辑媒体', '下载']) {
          assert.equal(findMenuAction(renderer, label).length, 1,
            label + ' must move into compact More rather than overflowing')
        }
        await act(async () => { findMenuAction(renderer, '下载')[0].props.onClick() })
      } else {
        await act(async () => { findButton(renderer, '下载媒体')[0].props.onClick() })
      }
      assert.deepEqual(downloads, [1991],
        'both layouts must run exactly the same shared authenticated download')
      assert.equal(renderer.root.findByType('test-shared-viewer').props.keepChromeVisible, false)
      if (compact) {
        await act(async () => {
          findButton(renderer, '更多照片操作')[0].props.onClick({ currentTarget: {} })
        })
        assert.equal(renderer.root.findByType('test-shared-viewer').props.keepChromeVisible, true,
          'open More must suspend the preview chrome timeout')
        await act(async () => { findMenuAction(renderer, '编辑媒体')[0].props.onClick() })
        const editDialog = renderer.root.findByType('test-edit-dialog')
        assert.equal(editDialog.props.open, true, 'compact Edit opens the shared editor')
        await act(async () => { editDialog.props.onClose() })
        assert.equal(renderer.root.findByType('test-edit-dialog').props.open, false)
      }
      await act(async () => { findButton(renderer, '查看属性')[0].props.onClick() })
      assert.deepEqual(infos, [1991], 'Info reaches the same shared Inspector on all widths')
    } finally {
      if (renderer) await act(async () => renderer.unmount())
    }
  }
})

test('P1 compact Gallery More must not revive after 390→900→390', async () => {
  width = 390
  let renderer
  const props = {
    item, activeIndex: 0, canPrevious: false, canNext: false,
    filmstripEntries: [], loadThumbnail: async () => null,
    onPrevious() {}, onNext() {}, onFilmstripSelect() {}, onClose() {},
    onDownload: async () => {}, onInfo() {}, onShare() {},
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(Viewer, props))
    })
    await act(async () => {
      findButton(renderer, '更多照片操作')[0].props.onClick({ currentTarget: {} })
    })
    assert.equal(findMenuAction(renderer, '下载').length, 1)

    width = 900
    await act(async () => {
      renderer.update(React.createElement(Viewer, props))
    })
    assert.equal(findMenuAction(renderer, '下载').length, 0)
    assert.equal(findButton(renderer, '更多照片操作').length, 0)

    width = 390
    await act(async () => {
      renderer.update(React.createElement(Viewer, props))
    })
    assert.equal(findButton(renderer, '更多照片操作').length, 1)
    assert.equal(findMenuAction(renderer, '下载').length, 0,
      'old compact anchor must not reopen when resizing back to 390px')
    assert.equal(renderer.root.findByType('test-shared-viewer').props.keepChromeVisible, false)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    width = 390
  }
})

test('P0 inline Gallery rejects stale Share and Inspector callbacks after filmstrip navigation', async () => {
  for (const nextWidth of [390, 900]) {
    width = nextWidth
    const calls = []
    const nextItem = { ...item, node: { ...item.node, id: 1992, revision: 4 } }
    const props = current => ({
      item: current, activeIndex: 0, canPrevious: false, canNext: false,
      filmstripEntries: [], loadThumbnail: async () => null,
      onPrevious() {}, onNext() {}, onFilmstripSelect() {}, onClose() {},
      onDownload: async () => {},
      onInfo: value => calls.push(['info', value.node.id]),
      onShare: value => calls.push(['share', value.node.id]),
    })
    let renderer
    try {
      await act(async () => { renderer = create(React.createElement(Viewer, props(item))) })
      const oldShare = findButton(renderer, '分享媒体')[0].props.onClick
      const oldInfo = findButton(renderer, '查看属性')[0].props.onClick
      await act(async () => {
        renderer.update(React.createElement(Viewer, props(nextItem)))
      })
      await act(async () => { oldShare(); oldInfo() })
      assert.deepEqual(calls, [], 'old handlers cannot share/inspect the wrong item')
      await act(async () => {
        findButton(renderer, '分享媒体')[0].props.onClick()
      })
      await act(async () => { findButton(renderer, '查看属性')[0].props.onClick() })
      assert.deepEqual(calls, [['share', 1992], ['info', 1992]],
        'current Viewer actions still work after rejecting stale callbacks')
    } finally {
      if (renderer) await act(async () => renderer.unmount())
    }
  }
  width = 390
})

test('P0 changing media loaders remounts the inner preview without recreating the Gallery Viewer shell', async () => {
  width = 390
  const initial = async () => null
  const next = async () => null
  const props = loadThumbnail => ({
    item, activeIndex: 0, canPrevious: false, canNext: false,
    filmstripEntries: [], loadThumbnail,
    onPrevious() {}, onNext() {}, onFilmstripSelect() {}, onClose() {},
    onDownload: async () => {},
  })
  let renderer
  try {
    await act(async () => { renderer = create(React.createElement(Viewer, props(initial))) })
    const first = renderer.root.findByType('test-media-content')
    const shell = renderer.root.findByType('test-shared-viewer')
    const firstChromeSession = shell.props.chromeSessionKey
    await act(async () => { renderer.update(React.createElement(Viewer, props(initial))) })
    assert.equal(renderer.root.findByType('test-media-content'), first,
      'stable authenticated loader must preserve preview zoom and motion state')

    await act(async () => { renderer.update(React.createElement(Viewer, props(next))) })
    assert.equal(renderer.root.findByType('test-shared-viewer'), shell)
    assert.notEqual(renderer.root.findByType('test-media-content'), first,
      'switching a source with the same Node/revision must remount its media bytes')
    assert.notEqual(renderer.root.findByType('test-shared-viewer').props.chromeSessionKey,
      firstChromeSession, 'same-Node replacement rotates the visible chrome session')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('Gallery slideshow uses decoded still readiness, 5s dwell and compact More at 390/899/900px', async () => {
  for (const nextWidth of [390, 899, 900]) {
    width = nextWidth
    const oldWindow = global.window, oldDocument = global.document, oldNow = Date.now
    let now = 1000, timerID = 0, advances = 0, renderer
    const timers = new Map()
    global.window = {
      setTimeout(callback, delay) { timers.set(++timerID, { callback, at: now + delay }); return timerID },
      clearTimeout(id) { timers.delete(id) },
    }
    global.document = new EventTarget()
    document.visibilityState = 'visible'
    Date.now = () => now
    const advance = async (ms) => {
      const until = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at
        timers.delete(due[0])
        await act(async () => due[1].callback())
      }
      now = until
    }
    const loadThumbnail = async () => null
    const props = (current, canNext) => ({
      item: current, activeIndex: 0, canPrevious: false, canNext,
      filmstripEntries: [], loadThumbnail,
      onPrevious() {}, onNext() { advances++ },
      onFilmstripSelect() {}, onClose() {},
    })
    try {
      await act(async () => { renderer = create(React.createElement(Viewer, props(item, true))) })
      if (nextWidth < 900) {
        assert.equal(findButton(renderer, '开始幻灯片').length, 0)
        await act(async () => findButton(renderer, '更多照片操作')[0].props.onClick({ currentTarget: {} }))
        assert.equal(findMenuAction(renderer, '开始幻灯片').length, 1)
        await act(async () => findMenuAction(renderer, '开始幻灯片')[0].props.onClick())
      } else {
        assert.equal(findButton(renderer, '开始幻灯片').length, 1)
        await act(async () => findButton(renderer, '开始幻灯片')[0].props.onClick())
      }
      await advance(10000)
      assert.equal(advances, 0, 'metadata alone must not consume image dwell')
      await act(async () =>
        renderer.root.findByType('test-media-content').props.onPresentationStateChange('ready'))
      await advance(4999)
      assert.equal(advances, 0)
      await advance(1)
      assert.equal(advances, 1, 'first actually decoded still advances once')
      const last = { ...item, node: { ...item.node, id: 1992, name: 'last.jpg' } }
      await act(async () => renderer.update(React.createElement(Viewer, props(last, false))))
      await act(async () =>
        renderer.root.findByType('test-media-content').props.onPresentationStateChange('ready'))
      await advance(5000)
      assert.equal(advances, 1, 'end of authorized range stops without another call')
    } finally {
      if (renderer) await act(async () => renderer.unmount())
      global.window = oldWindow
      global.document = oldDocument
      Date.now = oldNow
    }
  }
  width = 390
})
