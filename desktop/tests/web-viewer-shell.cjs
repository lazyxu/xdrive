const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
let compactTouch = false
let viewportWidth = 390
const timers = new Map()
let timerID = 0
const storage = new Map()
global.window = {
  setTimeout(callback, delay) { timers.set(++timerID, { callback, delay }); return timerID },
  clearTimeout(id) { timers.delete(id) },
  sessionStorage: {
    getItem(key) { return storage.get(key) ?? null },
    setItem(key, value) { storage.set(key, value) },
  },
}
global.HTMLElement = class HTMLElement {}

// Keep the real Viewer orchestration and frame. Host adapters replace MUI's
// styling/portal machinery; authenticated preview rendering has its own suite.
const host = (tag) => React.forwardRef(({ component, children, ...props }, ref) =>
  React.createElement(component || tag, { ...props, ref }, children))
const mui = {
  Box: host('div'), Stack: host('div'), Typography: host('span'),
  Dialog: host('dialog'), DialogContent: host('div'),
  IconButton: host('button'), Tooltip: ({ children }) => children,
  useMediaQuery: (query) => {
    if (query === '(max-width:899.95px)') return viewportWidth < 900
    if (query === '(max-width:899.95px) and (pointer: coarse)') {
      return compactTouch && viewportWidth < 900
    }
    return compactTouch
  },
}
const sharedUI = {
  XDriveFilePreviewSurface: (props) => React.createElement('preview-content', props),
  XDriveMediaViewerContent: (props) => React.createElement('media-content', props),
  XDriveMediaGalleryFilmstrip: (props) => React.createElement('gallery-filmstrip', props),
  XDriveStatePanel: ({ message }) => React.createElement('p', null, message),
  XDriveStatusAlert: ({ children }) => React.createElement('p', { role: 'alert' }, children),
  XDriveFileTagDialog: () => null, XDriveMediaDetailsInspector: () => null,
  XDriveShareDialog: () => null,
}

function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const localRequire = (name) => {
    if (name === '@mui/material') return mui
    if (name === '@xdrive/ui/mui') return sharedUI
    if (name.startsWith('@mui/icons-material/')) return () => null
    if (name === '../../ui/shared/src') {
      return {
        ...load(path.join(repo, 'ui/shared/src/file-preview.ts'), cache),
        ...load(path.join(repo, 'ui/shared/src/media-viewer.ts'), cache),
        xDriveWebAppHash: () => '#/files',
      }
    }
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(filename), name)
    const resolved = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return resolved ? load(resolved, cache) : require(base)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
Object.assign(sharedUI, load(path.join(repo, 'ui/shared/src/mui/usePreviewSlideshow.ts')))
const { WebFileViewerApps } = load(path.join(repo, 'web/src/WebFileViewerApps.tsx'))
const { XDriveOpenPreviewDialog } = load(path.join(repo, 'ui/shared/src/mui/FileOpenPreviewDialog.tsx'))

for (const app of ['preview', 'media-viewer', 'text-viewer', 'pdf-viewer', 'audio-player']) {
  test(`${app} owns a full-screen frame and Return while metadata is pending or fails`, async () => {
    compactTouch = true
    let rejectRead
    const pending = new Promise((_resolve, reject) => { rejectRead = reject })
    let renderer
    let closes = 0
    await act(async () => {
      renderer = create(React.createElement(WebFileViewerApps, {
        route: { app, params: { node: 81 } },
        api: { node: () => pending, mediaItem: () => pending, fileTextPreview: () => pending },
        gallerySource: {}, shareDialogAdapter: {},
        onClose() { closes += 1 }, onReplaceRoute() {}, onError() {},
      }), { createNodeMock: () => ({ focus() {} }) })
    })
    const frames = () => renderer.root.findAll((element) => element.type === 'div' && element.props['data-xdrive-web-viewer'] !== undefined)
    try {
      assert.equal(frames().length, 1, 'the loading app must cover the workspace, including global header/footer')
      const frame = frames()[0]
      assert.equal(frame.props.sx.position, 'fixed')
      assert.equal(frame.props.sx.inset, 0)
      assert.equal(buttons(renderer, '返回').length, 1, 'loading must remain dismissible')
      await act(async () => { rejectRead(new Error('metadata unavailable')) })
      assert.equal(frames().length, 1, 'failure must stay in the full-screen app')
      assert.equal(frames()[0], frame, 'loading-to-failure must preserve the app frame')
      assert.equal(renderer.root.findAll((element) => element.props.role === 'alert').length, 1)
      await act(async () => { buttons(renderer, '返回')[0].props.onClick() })
      assert.equal(closes, 1)
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}

function buttons(renderer, label) {
  return renderer.root.findAll((element) => element.type === 'button' && element.props['aria-label'] === label)
}

test('shared preview chrome renders arrows only when navigation is available', async () => {
  for (const touch of [false, true]) {
    compactTouch = touch
    let renderer
    const props = { open: true, title: 'one.pdf', onClose() {} }
    await act(async () => { renderer = create(React.createElement(XDriveOpenPreviewDialog, props, 'content')) })
    try {
      assert.equal(buttons(renderer, '预览上一个项目').length, 0)
      assert.equal(buttons(renderer, '预览下一个项目').length, 0)
      await act(async () => renderer.update(React.createElement(XDriveOpenPreviewDialog, { ...props, canNext: true, onNext() {} }, 'content')))
      assert.equal(buttons(renderer, '预览上一个项目').length, 1)
      assert.equal(buttons(renderer, '预览下一个项目')[0].props.disabled, false)
    } finally {
      await act(async () => renderer.unmount())
    }
  }
})

async function mount(app, name, capturedAt = '2026-10-09T00:12:34Z') {
  const node = { id: 41, revision: 2, type: 'file', name, size: 50 }
  let renderer
  await act(async () => {
    renderer = create(React.createElement(WebFileViewerApps, {
      route: { app, params: { node: node.id } },
      api: {
        node: async () => node,
        fileTextPreview: async () => ({ text: 'hello\nworld', size: 11, truncated: false }),
        mediaItem: async () => ({ node, metadata: { media_kind: 'image', index_state: 'ready', has_thumbnail: false, captured_at: capturedAt } }),
      },
      gallerySource: {}, shareDialogAdapter: {},
      onClose() {}, onReplaceRoute() {}, onError(error) { throw error },
    }), { createNodeMock: () => ({ focus() {} }) })
  })
  return renderer
}

test('Media Viewer displays capture time and distinguishes missing metadata', async () => {
  for (const [capturedAt, expected] of [['2026-10-09T00:12:34Z', '2026'], ['', '未记录'], ['invalid', '未记录']]) {
    compactTouch = true
    const renderer = await mount('media-viewer', 'photo.jpg', capturedAt)
    try {
      const labels = renderer.root.findAll((element) => element.type === 'span' && element.children.some((child) => typeof child === 'string' && child.startsWith('拍摄时间：')))
      assert.equal(labels.length, 1)
      assert.ok(labels[0].children.join('').includes(expected))
    } finally {
      await act(async () => renderer.unmount())
    }
  }
})

for (const [app, name] of [['text-viewer', 'source.cpp'], ['pdf-viewer', 'paper.pdf'], ['audio-player', 'recording.mp3']]) {
  test(`${app} renders standalone without disabled file-navigation buttons`, async () => {
    compactTouch = false
    const renderer = await mount(app, name)
    try {
      assert.equal(buttons(renderer, '上一个项目').length, 0)
      assert.equal(buttons(renderer, '下一个项目').length, 0)
      assert.equal(buttons(renderer, '返回').length, 1)
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  test(`${app} keeps its actions in the compact touch rail without file navigation`, async () => {
    compactTouch = true
    const renderer = await mount(app, name)
    try {
      const rail = renderer.root.findAll((element) => element.type === 'div' && element.props['data-xdrive-web-viewer-mobile-actions'] !== undefined)
      assert.equal(rail.length, 1, 'standalone viewers need the same reachable mobile action rail')
      assert.ok(rail[0].findAll((element) => element.type === 'button').length > 0)
      assert.equal(buttons(renderer, '上一个项目').length, 0)
      assert.equal(buttons(renderer, '下一个项目').length, 0)
      assert.equal(buttons(renderer, '返回').length, 1)
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}


test('P1-2c Web media-viewer uses the same narrow Photos chrome on coarse and fine pointers', async () => {
  try {
    for (const width of [390, 899, 900]) {
      for (const coarse of [false, true]) {
        compactTouch = coarse
        viewportWidth = width
        const renderer = await mount('media-viewer', 'photo.jpg')
        try {
          const frame = renderer.root.findAll(element =>
            element.type === 'div' && element.props['data-xdrive-web-viewer'] !== undefined)[0]
          assert.ok(frame, 'actual routed Web media Viewer must be mounted')
          const header = frame.children[0]
          const rail = frame.findAll(element =>
            element.type === 'div' && element.props['data-xdrive-web-viewer-mobile-actions'] !== undefined)
          const mobile = width < 900
          assert.equal(frame.props.sx.height, mobile ? '100dvh' : undefined,
            width + 'px (' + (coarse ? 'coarse' : 'fine') + ') must preserve full viewer height')
          assert.equal(header.props.sx.position, mobile ? 'absolute' : 'relative')
          assert.equal(rail.length, mobile ? 1 : 0, 'all narrow pointer types share one bottom action rail')
          const inspector = buttons(renderer, '查看属性')
          assert.equal(inspector.length, 1, 'real shared media inspector action remains available')
          if (mobile) {
            assert.equal(rail[0].props.sx.position, 'absolute')
            assert.equal(rail[0].props.sx.pb, 'env(safe-area-inset-bottom)')
            assert.equal(rail[0].props.sx['& .MuiIconButton-root'].width, 44)
            assert.ok(rail[0].findAll(element =>
              element.type === 'button' && element.props['aria-label'] === '查看属性').length,
              'same real media action moved to bottom, not duplicated or replaced')
          } else {
            assert.equal(header.findAll(element =>
              element.type === 'button' && element.props['aria-label'] === '查看属性').length, 1)
          }
          assert.equal(typeof frame.props.onMouseMove,
            (!coarse || !mobile) ? 'function' : 'undefined',
            'paired fine-pointer mouse must be able to recall auto-hidden Viewer controls')
          assert.equal(frame.findAll(element => element.type === 'media-content').length, 1,
            'one shared MediaViewerContent remains the media renderer')
        } finally {
          await act(async () => renderer.unmount())
        }
      }
    }
  } finally {
    compactTouch = false
    viewportWidth = 390
  }
})

test('P1-2c fine-pointer mobile non-photo Viewer keeps its original standalone chrome', async () => {
  compactTouch = false
  viewportWidth = 390
  try {
    for (const [app, filename] of [
      ['preview', 'photo.jpg'], ['text-viewer', 'code.ts'],
      ['pdf-viewer', 'book.pdf'], ['audio-player', 'recording.mp3'],
    ]) {
      const renderer = await mount(app, filename)
      try {
        const frame = renderer.root.findAll(element =>
          element.type === 'div' && element.props['data-xdrive-web-viewer'] !== undefined)[0]
        assert.equal(frame.children[0].props.sx.position, 'relative')
        assert.equal(frame.props.sx.height, undefined)
        assert.equal(frame.findAll(element =>
          element.props['data-xdrive-web-viewer-mobile-actions'] !== undefined).length, 0)
        assert.equal(buttons(renderer, '返回').length, 1)
      } finally {
        await act(async () => renderer.unmount())
      }
    }
  } finally {
    compactTouch = false
    viewportWidth = 390
  }
})

test('P1-2c real routed Viewer and Gallery use one Web media and virtual query contract', () => {
  const source = fs.readFileSync(path.join(repo, 'web/src/WebFileViewerApps.tsx'), 'utf8')
  const app = fs.readFileSync(path.join(repo, 'web/src/App.tsx'), 'utf8')
  const gallery = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const adapter = fs.readFileSync(path.join(repo, 'web/src/mediaGalleryAdapter.ts'), 'utf8')
  assert.match(app, /<XDriveMediaGalleryPage[\s\S]*?onOpenViewer=\{\(item, context\) => \{/)
  assert.match(app, /app: 'media-viewer'/)
  assert.match(source, /<WebViewerFrame[\s\S]*?immersive\s+photosViewer/)
  assert.match(source, /<XDriveMediaViewerContent/)
  assert.match(source, /onSwipePrevious=\{viewer.previous \? viewer.goPrevious : undefined\}/)
  assert.match(gallery, /useXDriveVirtualCollection(?:<[^>]+>)?\(/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(adapter, /listItemRange:\s*\(limit, offset, query, signal\)\s*=>\s*api\.mediaItemRange/)
  assert.doesNotMatch(source, /new XMLHttpRequest\(/)
})

test('P1-2c Gallery Viewer return scroll snapshot belongs to same Web route, host and viewport', () => {
  const app = fs.readFileSync(path.join(repo, 'web/src/App.tsx'), 'utf8')
  assert.match(app, /galleryViewerScrollRef = useRef/)
  assert.match(app, /useLayoutEffect\(\(\) => \{/)
  assert.match(app, /const wasViewerActive = previousViewerActiveRef\.current/)
  assert.match(app, /if \(viewerActive\) \{/)
  assert.match(app, /if \(wasViewerActive \|\| !saved \|\| appView !== 'gallery'/)
  assert.match(app, /saved\.offset = saved\.host\.scrollTop/)
  assert.match(app, /overflowAnchor: appView === 'gallery' \? 'none' : undefined/)

  assert.match(app, /saved\.host\.addEventListener\('scroll', captureEntry, \{ passive: true \}\)/)
  assert.match(app, /window\.addEventListener\('resize', freezeCapture\)/)
  assert.match(app, /saved\.host\.removeEventListener\('scroll', captureEntry\)/)
  assert.match(app, /window\.removeEventListener\('resize', freezeCapture\)/)
  assert.match(app, /window\.requestAnimationFrame\(captureEntry\)/)
  assert.match(app, /if \(!wasViewerActive\) return/)
  assert.match(app, /window\.location\.hash !== saved\.callerHash/)
  assert.match(app, /Math\.abs\(window\.innerWidth - saved\.viewportWidth\) > 1/)
  // The same connected-host contract is now expressed as an affirmative
  // guard reused by scroll restoration and its bounded event listener.
  assert.match(app, /return host === saved\.host && saved\.host\.isConnected/)
  assert.match(app, /window\.location\.hash === saved\.callerHash/)
  assert.match(app, /Math\.abs\(window\.innerWidth - saved\.viewportWidth\) <= 1/)
  assert.match(app, /saved\.host\.scrollTop = saved\.offset/)
  assert.match(app, /window\.requestAnimationFrame\(restore\)/)
  // Return viewport is restored even when a virtual row reflows after rAF,
  // without trapping any real subsequent Gallery gesture.
  assert.match(app, /saved\.host\.addEventListener\('scroll', preserveReturnOffset, \{ passive: true \}\)/)
  assert.match(app, /saved\.host\.removeEventListener\('scroll', preserveReturnOffset\)/)
  assert.match(app, /Math\.abs\(saved\.host\.scrollTop - saved\.offset\) > 1/)
  assert.match(app, /window\.setTimeout\(stopReturnGuard, 650\)/)
  assert.match(app, /if \(event\.isTrusted\) stopReturnGuard\(\)/)
  assert.match(app, /window\.addEventListener\('pointerdown', cancelOnUserInput/)
  assert.match(app, /window\.addEventListener\('wheel', cancelOnUserInput/)
  assert.match(app, /window\.removeEventListener\('keydown', cancelOnUserInput\)/)
  assert.match(app, /window\.addEventListener\('resize', cancelOnViewportChange\)/)
  assert.match(app, /window\.removeEventListener\('resize', cancelOnViewportChange\)/)
  assert.match(app, /galleryViewerScrollRef\.current = host \? \{/)
  assert.match(app, /offset: host\.scrollTop/)
  assert.match(app, /<WebFileViewerApps/)
  assert.match(app, /onClose=\{\(node\) => closeViewer\(/)
  const openStart = app.indexOf('onOpenViewer={(item, context) => {')
  const openEnd = app.indexOf('const contextID = xDriveCreateWebAppBrowseSession', openStart)
  assert.ok(openStart >= 0 && openEnd > openStart)
  assert.doesNotMatch(app.slice(openStart, openEnd), /api\.mediaItem|fetch\(/,
    'capturing an existing Gallery scroll position must not request media or touch Server state')
})


test('P1-2d real routed Gallery uses bounded shared Filmstrip across 128-item page boundary', async () => {
  const key = 'xdrive.web_app.session.v1:p12d-gallery-filmstrip'
  const items = Array.from({ length: 240 }, (_, i) => {
    const node = { id: 1000 + i, type: 'file', name: 'photo-' + (i + 1) + '.png', revision: 1, size: 80 }
    return { node, metadata: { media_kind: 'image', mime_type: 'image/png',
      index_state: 'ready', has_thumbnail: true, captured_at: '2026-10-09T12:00:00Z' } }
  })
  storage.set(key, JSON.stringify({ version: 1, context: {
    kind: 'gallery', target: { kind: 'all', query: {} }, activeIndex: 127, totalCount: 240,
  } }))
  const requests = [], navigated = []
  const api = { node: async id => items[id - 1000]?.node, mediaItem: async id => items[id - 1000] }
  const source = {
    loadThumbnail: async () => null,
    listItemRange: async (limit, offset) => {
      requests.push({ limit, offset })
      return { items: items.slice(offset, offset + limit), total_count: items.length, offset, limit }
    },
  }
  compactTouch = true
  viewportWidth = 390
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(WebFileViewerApps, {
        route: { app: 'media-viewer', params: { node: 1127, context: 'p12d-gallery-filmstrip' } },
        api, gallerySource: source, shareDialogAdapter: {},
        onReplaceRoute(next) {
          assert.equal(next.app, 'media-viewer', 'Filmstrip preserves the existing Viewer app route')
          navigated.push(next.params.node)
        },
        onError(error) { throw error }, onClose() {},
      }), { createNodeMock: () => ({ focus() {} }) })
    })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
    }
    const strips = renderer.root.findAll(el => el.type === 'gallery-filmstrip')
    assert.equal(strips.length, 1, 'reuse one XDriveMediaGalleryFilmstrip')
    assert.deepEqual(strips[0].props.entries.map(entry => entry.index),
      Array.from({ length: 11 }, (_, i) => i + 122))
    assert.equal(strips[0].props.activeIndex, 127)
    const frame = renderer.root.find(el => el.props['data-xdrive-web-viewer'] !== undefined)
    const rail = frame.findAll(el => el.type === 'div' &&
      el.props['data-xdrive-web-viewer-filmstrip'] !== undefined)
    assert.equal(rail.length, 1)
    assert.equal(rail[0].props.sx.position, 'absolute')
    assert.equal(rail[0].props.sx.bottom, 'calc(56px + env(safe-area-inset-bottom))')
    assert.equal(rail[0].props.sx.width, '100%')
    assert.deepEqual([...new Set(requests.map(req => req.offset))].sort((a, b) => a - b), [0, 128])
    assert.ok(requests.every(req => req.limit === 128), 'one authorized bounded range per page')
    assert.equal(navigated.length, 0, 'neighbor load cannot trigger Viewer navigation')
    await act(async () => { strips[0].props.onSelect(128) })
    assert.deepEqual(navigated, [1128], 'Filmstrip uses the same canonical Node/Viewer route')
    assert.equal(JSON.parse(storage.get(key)).context.activeIndex, 128)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    storage.delete(key)
    compactTouch = false
    viewportWidth = 390
  }
})

test('P1-2d no Filmstrip is generated for standalone media without a Gallery session', async () => {
  compactTouch = true
  viewportWidth = 390
  const renderer = await mount('media-viewer', 'standalone.jpg')
  try {
    assert.equal(renderer.root.findAll(el => el.type === 'gallery-filmstrip').length, 0)
    assert.equal(renderer.root.findAll(el =>
      el.props['data-xdrive-web-viewer-filmstrip'] !== undefined).length, 0)
  } finally {
    await act(async () => renderer.unmount())
    compactTouch = false
  }
})
