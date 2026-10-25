const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const filename = 'ui/shared/src/mui/FileOpenPreviewDialog.tsx'
const viewerSource = read('ui/shared/src/mui/MediaGalleryViewer.tsx')
const pageSource = read('ui/shared/src/mui/MediaGallery.tsx')
const webSource = read('web/src/App.tsx')
const adapterSource = read('web/src/mediaGalleryAdapter.ts')
let viewport = { width: 390, coarse: false }

const mui = Object.fromEntries([
  'Box', 'Dialog', 'DialogContent', 'IconButton', 'Stack', 'Tooltip', 'Typography',
].map((name) => [name, name.toLowerCase()]))
mui.useMediaQuery = (query) => {
  if (query === '(max-width:899.95px)') return viewport.width < 900
  if (query === '(max-width:367.95px)') return viewport.width < 368
  if (query === '(max-width:899.95px) and (pointer: coarse)') {
    return viewport.width < 900 && viewport.coarse
  }
  throw Error('Unexpected responsive query: ' + query)
}
const modules = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
}
const compiled = ts.transpileModule(read(filename), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'module', 'require', compiled)(
  loaded.exports, loaded,
  (name) => {
    if (modules[name]) return modules[name]
    if (name.startsWith('@mui/icons-material/')) return 'icon'
    throw Error('Unexpected dependency: ' + name)
  },
)
const Preview = loaded.exports.XDriveOpenPreviewDialog
const findData = (tree, key) => tree.root.findAll((node) => node.props?.[key] !== undefined)
const findType = (tree, kind) => tree.root.findAll((node) => node.type === kind)

async function withPreview({ width, coarse, immersive, mobileEdgeToEdge = false, keepChromeVisible = false,
  canPrevious = false, canNext = false }, verify) {
  viewport = { width, coarse }
  const originalWindow = global.window
  const originalHTMLElement = global.HTMLElement
  const timers = new Map()
  let nextTimer = 0
  class FakeHTMLElement {
    constructor(interactive = false) { this.interactive = interactive }
    closest() { return this.interactive ? {} : null }
  }
  global.HTMLElement = FakeHTMLElement
  global.window = {
    setTimeout(fn, delay) {
      const timer = ++nextTimer
      timers.set(timer, { fn, delay })
      return timer
    },
    clearTimeout(timer) { timers.delete(timer) },
  }
  let view
  let clicked = 0
  let closed = 0
  try {
    const props = {
      open: true,
      title: 'sample.jpg',
      immersive,
      mobileEdgeToEdge,
      keepChromeVisible,
      quickLook: !immersive,
      canPrevious,
      canNext,
      onPrevious() {},
      onNext() {},
      actions: React.createElement('button', {
        'data-shared-media-action': true,
        onClick() { clicked++ },
      }, 'actual shared action'),
      footer: React.createElement('span', { 'data-filmstrip-entry': true }, 'sample.jpg'),
      onClose() { closed++ },
    }
    await act(async () => {
      view = create(React.createElement(Preview, props, 'same shared media'))
    })
    await verify({
      view, timers, FakeHTMLElement,
      get clicks() { return clicked },
      get closes() { return closed },
      runTimeout(delay) {
        const matching = [...timers].find(([, timer]) => timer.delay === delay)
        assert.ok(matching, 'missing real timer ' + delay)
        timers.delete(matching[0])
        matching[1].fn()
      },
    })
  } finally {
    if (view) await act(async () => { view.unmount() })
    global.window = originalWindow
    global.HTMLElement = originalHTMLElement
  }
}

test('P1-2a narrow immersive Gallery Viewer is full-screen and has same actions for fine/coarse pointers', async () => {
  for (const width of [390, 899]) {
    for (const coarse of [false, true]) {
      await withPreview({ width, coarse, immersive: true }, async ({ view, clicks }) => {
        const dialog = findType(view, 'dialog')[0]
        assert.equal(dialog.props.fullScreen, true, width + ' / ' + coarse)
        assert.equal(dialog.props.slotProps.paper.sx.height, '100dvh')
        assert.equal(findData(view, 'data-xdrive-preview-mobile-filmstrip').length, 1)
        const actionRail = findData(view, 'data-xdrive-preview-mobile-actions')[0]
        assert.ok(actionRail, 'mobile Viewer action rail must be present')
        assert.equal(actionRail.props.sx.pb, 'env(safe-area-inset-bottom)')
        const header = view.root.findAll((node) => node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
        assert.equal(header.findAll((node) => node.props?.['data-shared-media-action']).length, 0,
          'narrow Gallery actions must not remain as desktop header buttons')
        const actualAction = actionRail.findAll((node) => node.props?.['data-shared-media-action'])[0]
        assert.ok(actualAction, 'existing Viewer callback must remain reachable')
        await act(async () => { actualAction.props.onClick() })
      })
    }
  }
})

test('P1-2a wide desktop and non-immersive fine-pointer Quick Look keep existing layout', async () => {
  for (const mode of [
    { width: 900, coarse: false, immersive: true },
    { width: 390, coarse: false, immersive: false },
    { width: 899, coarse: false, immersive: false },
  ]) {
    await withPreview(mode, async ({ view }) => {
      assert.equal(findType(view, 'dialog')[0].props.fullScreen, false)
      assert.equal(findData(view, 'data-xdrive-preview-mobile-actions').length, 0)
      assert.equal(findData(view, 'data-xdrive-preview-mobile-filmstrip').length, 0)
      const header = view.root.findAll((node) => node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      assert.equal(header.findAll((node) => node.props?.['data-shared-media-action']).length, 1)
      assert.equal(findType(view, 'dialog')[0].props.slotProps.paper.sx.maxHeight, 820)
    })
  }
  // Existing coarse-pointer Files Quick Look behavior is unchanged.
  await withPreview({ width: 390, coarse: true, immersive: false }, async ({ view }) => {
    assert.equal(findType(view, 'dialog')[0].props.fullScreen, true)
    assert.equal(findData(view, 'data-xdrive-preview-mobile-actions').length, 1)
  })
})

test('P1-2a touch tap toggles Gallery chrome even when a paired mouse is the primary pointer', async () => {
  await withPreview({ width: 390, coarse: false, immersive: true },
    async ({ view, timers, FakeHTMLElement, runTimeout }) => {
      const content = findType(view, 'dialogcontent')[0]
      const chrome = () => view.root.findAll((node) =>
        node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      const first = {
        pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 140,
        target: new FakeHTMLElement(),
      }
      await act(async () => {
        content.props.onPointerDownCapture(first)
        content.props.onPointerUpCapture(first)
      })
      await act(async () => { runTimeout(260) })
      assert.equal(chrome().props.sx.opacity, 0)
      assert.equal(findData(view, 'data-xdrive-preview-mobile-actions')[0].props.sx.opacity, 0)
      const second = { ...first, pointerId: 2, clientX: 180 }
      await act(async () => {
        content.props.onPointerDownCapture(second)
        content.props.onPointerUpCapture(second)
      })
      await act(async () => { runTimeout(260) })
      assert.equal(chrome().props.sx.opacity, 1)
      // A paired fine-pointer mouse must be able to reveal controls after
      // touch hides them; coarse-pointer touch remains tap-owned.
      const third = { ...first, pointerId: 4, clientX: 270 }
      await act(async () => {
        content.props.onPointerDownCapture(third)
        content.props.onPointerUpCapture(third)
      })
      await act(async () => { runTimeout(260) })
      assert.equal(chrome().props.sx.opacity, 0)
      assert.equal(typeof content.props.onMouseMove, 'function')
      await act(async () => { content.props.onMouseMove({}) })
      assert.equal(chrome().props.sx.opacity, 1)
      // Touch on interactive media controls must never hide the Viewer toolbar.
      const interactive = { ...first, pointerId: 3, target: new FakeHTMLElement(true) }
      await act(async () => {
        content.props.onPointerDownCapture(interactive)
        content.props.onPointerUpCapture(interactive)
      })
      assert.equal([...timers.values()].filter((timer) => timer.delay === 260).length, 0)
      assert.equal(chrome().props.sx.opacity, 1)
    })
})

test('P1-2a does not fork Gallery data, virtual items, or media semantics', () => {
  assert.match(viewerSource, /<XDriveOpenPreviewDialog[\s\S]*?immersive/)
  assert.match(viewerSource, /<XDriveMediaViewerContent/)
  assert.match(viewerSource, /<XDriveMediaGalleryFilmstrip/)
  assert.match(viewerSource, /onSwipePrevious=\{canPrevious \? previousIfCurrent : undefined\}/)
  assert.match(pageSource, /<XDriveMediaGalleryViewer/)
  assert.match(pageSource, /useXDriveVirtualCollection(?:<[^>]+>)?\(/)
  assert.match(pageSource, /<MediaVirtualTileGrid/)
  assert.match(webSource, /<XDriveMediaGalleryPage/)
  assert.match(webSource, /createWebMediaGalleryDataSource\(\s*api\s*(?:,\s*\{\s*onAuthorizedAlbums\s*:|\))/)
  assert.match(adapterSource, /listItemRange:\s*\(limit, offset, query, signal\)\s*=>\s*api\.mediaItemRange/)
})


test('P1-2b narrow Gallery keeps one full-height media canvas below opt-in overlay chrome', async () => {
  for (const width of [390, 899]) {
    for (const coarse of [false, true]) {
      await withPreview({ width, coarse, immersive: true, mobileEdgeToEdge: true }, async (h) => {
        const { view } = h
        const dialog = findType(view, 'dialog')[0]
        const header = view.root.findAll((node) => node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
        const media = findType(view, 'dialogcontent')[0]
        const strip = findData(view, 'data-xdrive-preview-mobile-filmstrip')[0]
        const actions = findData(view, 'data-xdrive-preview-mobile-actions')[0]
        assert.equal(dialog.props.fullScreen, true)
        assert.equal(dialog.props.slotProps.paper.sx.position, 'relative')
        assert.equal(dialog.props.slotProps.paper.sx.height, '100dvh')
        assert.equal(media.props.sx.flex, '1 1 0', 'no headers/footers may consume media flex height')
        for (const owner of [header, strip, actions]) {
          assert.equal(owner.props.sx.position, 'absolute',
            'visible/hidden chrome must float over the same full-size media canvas')
          assert.equal(owner.props.sx.zIndex, 3)
        }
        assert.equal(header.props.sx.top, 0)
        assert.equal(header.props.sx.pt, 'env(safe-area-inset-top)')
        assert.equal(strip.props.sx.bottom, 'calc(56px + env(safe-area-inset-bottom))')
        assert.equal(actions.props.sx.bottom, 0)
        assert.equal(actions.props.sx.minHeight, 'calc(56px + env(safe-area-inset-bottom))')
        assert.equal(actions.props.sx.pb, 'env(safe-area-inset-bottom)')
        assert.equal(actions.props.sx['& .MuiIconButton-root'].width, 44)
        assert.equal(header.props.sx['& .MuiIconButton-root'].height, 44)
        const back = header.findAll((node) =>
          node.type === 'iconbutton' && node.props['aria-label'] === '返回图库')
        assert.equal(back.length, 1, 'Gallery owns a genuine back-to-collection action')
        assert.equal(header.findAll((node) => node.props['aria-label'] === '关闭预览').length, 0)
        const action = actions.findAll((node) => node.props['data-shared-media-action'] === true)[0]
        assert.ok(action, 'same Gallery mutation/download handler stays reachable in overlay')
        await act(async () => { action.props.onClick() })
        assert.equal(h.clicks, 1)

        await act(async () => { h.runTimeout(2200) })
        for (const owner of [
          view.root.findAll((node) => node.props?.['data-xdrive-preview-chrome'] === 'header')[0],
          findData(view, 'data-xdrive-preview-mobile-filmstrip')[0],
          findData(view, 'data-xdrive-preview-mobile-actions')[0],
        ]) {
          assert.equal(owner.props.sx.opacity, 0)
          assert.equal(owner.props.sx.pointerEvents, 'none')
          assert.equal(owner.props.sx.position, 'absolute',
            'auto-hide must not reserve layout or resize zoom/pan viewport')
        }
        // Explicit return is the existing onClose, not a second app-navigation callback.
        await act(async () => { back[0].props.onClick() })
        assert.equal(h.closes, 1)
      })
    }
  }
})

test('P1-2b Quick Look and wide Gallery preserve the non-overlaid shared preview shell', async () => {
  const modes = [
    { width: 900, coarse: false, immersive: true, mobileEdgeToEdge: true },
    { width: 900, coarse: true, immersive: true, mobileEdgeToEdge: true },
    { width: 390, coarse: true, immersive: true, mobileEdgeToEdge: false },
    { width: 390, coarse: false, immersive: false, mobileEdgeToEdge: true },
    { width: 390, coarse: true, immersive: false, mobileEdgeToEdge: true },
  ]
  for (const mode of modes) {
    await withPreview(mode, async ({ view }) => {
      const dialog = findType(view, 'dialog')[0]
      const header = view.root.findAll((node) => node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      const media = findType(view, 'dialogcontent')[0]
      assert.equal(dialog.props.slotProps.paper.sx.position, undefined)
      assert.equal(header.props.sx.position, undefined)
      assert.equal(media.props.sx.flex, undefined)
      assert.equal(header.findAll((node) => node.props['aria-label'] === '返回图库').length, 0)
      assert.equal(header.findAll((node) => node.props['aria-label'] === '关闭预览').length, 1)
      const strip = findData(view, 'data-xdrive-preview-mobile-filmstrip')
      if (strip.length) assert.equal(strip[0].props.sx.position, undefined)
      const rail = findData(view, 'data-xdrive-preview-mobile-actions')
      if (rail.length) assert.equal(rail[0].props.sx.position, undefined)
    })
  }
})

test('P1-2b edge-to-edge mode is owned only by the existing shared Gallery Viewer', () => {
  assert.match(viewerSource, /<XDriveOpenPreviewDialog[\s\S]*?\bimmersive\s+mobileEdgeToEdge\b/)
  assert.match(viewerSource, /<XDriveMediaViewerContent/)
  assert.match(viewerSource, /<XDriveMediaGalleryFilmstrip/)
  assert.match(viewerSource, /onSwipePrevious=\{canPrevious \? previousIfCurrent : undefined\}/)
  assert.match(pageSource, /useXDriveVirtualCollection(?:<[^>]+>)?\(/)
  assert.match(webSource, /createWebMediaGalleryDataSource\(\s*api\s*(?:,\s*\{\s*onAuthorizedAlbums\s*:|\))/)
  assert.match(adapterSource, /listItemRange:\s*\(limit, offset, query, signal\)\s*=>\s*api\.mediaItemRange/)
})


test('P1 shared Viewer treats SVG button targets as interactive and rejected gestures as non-taps', async () => {
  await withPreview({ width: 390, coarse: false, immersive: true },
    async ({ view, timers, FakeHTMLElement }) => {
      const content = findType(view, 'dialogcontent')[0]
      const chrome = () => view.root.findAll(node =>
        node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      const svgChildOfButton = { closest(selector) {
        assert.match(selector, /button/)
        return { tagName: 'button' }
      } }
      const iconTap = { pointerId: 71, pointerType: 'touch', clientX: 150,
        clientY: 100, target: svgChildOfButton }
      await act(async () => {
        content.props.onPointerDownCapture(iconTap)
        content.props.onPointerUpCapture(iconTap)
      })
      assert.equal([...timers.values()].filter(t => t.delay === 260).length, 0,
        'tapping SVG inside a button must not hide the toolbars')
      assert.equal(chrome().props.sx.opacity, 1)

      const farStart = { pointerId: 72, pointerType: 'touch', clientX: 10,
        clientY: 100, target: new FakeHTMLElement() }
      await act(async () => {
        content.props.onPointerDownCapture(farStart)
        content.props.onPointerUpCapture({ ...farStart, clientX: 200 })
      })
      assert.equal([...timers.values()].filter(t => t.delay === 260).length, 0,
        'pointerup far from pointerdown cannot count as a tap if pointermove was skipped')
      await act(async () => {
        content.props.onPointerDownCapture(farStart)
        content.props.onPointerCancelCapture(farStart)
      })
      assert.equal([...timers.values()].filter(t => t.delay === 260).length, 0)
    })
})

test('P1 shared Viewer keeps chrome accessible while an action menu or modal owns focus', async () => {
  await withPreview({ width: 390, coarse: false, immersive: true, keepChromeVisible: true },
    async ({ view, timers, FakeHTMLElement, runTimeout }) => {
      assert.equal([...timers.values()].some(t => t.delay === 2200), false,
        'More/Inspector must suspend auto-hide while open')
      const content = findType(view, 'dialogcontent')[0]
      const tap = { pointerId: 73, pointerType: 'touch', clientX: 80,
        clientY: 120, target: new FakeHTMLElement() }
      await act(async () => {
        content.props.onPointerDownCapture(tap)
        content.props.onPointerUpCapture(tap)
      })
      await act(async () => runTimeout(260))
      const header = view.root.findAll(node =>
        node.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      assert.equal(header.props.sx.opacity, 1,
        'background tap cannot hide controls behind an open action menu')
      assert.equal([...timers.values()].some(t => t.delay === 2200), false)
    })
})

test('P1-320 shared Gallery rail preserves 44px actions and delegates navigation only below 368px', async () => {
  for (const width of [320, 367, 368, 375]) {
    for (const coarse of [true, false]) {
      await withPreview({ width, coarse, immersive: true, mobileEdgeToEdge: true,
        canPrevious: true, canNext: true }, async ({ view }) => {
        const rail = findData(view, 'data-xdrive-preview-mobile-actions')[0]
        const buttons = rail.findAll(node => node.type === 'iconbutton')
        const previous = buttons.filter(node => node.props['aria-label'] === '预览上一个项目')
        const next = buttons.filter(node => node.props['aria-label'] === '预览下一个项目')
        assert.equal(previous.length, width < 368 ? 0 : 1)
        assert.equal(next.length, width < 368 ? 0 : 1)
        assert.equal(rail.props.spacing, 0, 'Gallery rail must spend no width on invisible gaps')
        assert.equal(rail.props.sx.overflowX, 'hidden', 'Gallery actions must not depend on horizontal scrolling')
        assert.equal(rail.props.sx['& .MuiIconButton-root'].height, 44)
        assert.equal(rail.props.sx['@media (prefers-reduced-motion: reduce)'].transition, 'none')
        assert.equal(findData(view, 'data-xdrive-preview-mobile-filmstrip').length, 1,
          'filmstrip stays navigable when the two arrows move to More')
      })
    }
  }
})

test('P1 reduced-motion shared Viewer chrome removes opacity animation without changing visibility', async () => {
  await withPreview({ width: 390, coarse: false, immersive: true, mobileEdgeToEdge: true },
    async ({ view }) => {
      const header = view.root.findAll(n => n.props?.['data-xdrive-preview-chrome'] === 'header')[0]
      assert.equal(header.props.sx['@media (prefers-reduced-motion: reduce)'].transition, 'none')
      assert.equal(header.props.sx.opacity, 1)
      const strip = findData(view, 'data-xdrive-preview-mobile-filmstrip')[0]
      assert.equal(strip.props.sx['@media (prefers-reduced-motion: reduce)'].transition, 'none')
    })
})
