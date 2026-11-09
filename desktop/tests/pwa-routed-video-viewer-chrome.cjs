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
const routed = fs.readFileSync(path.join(root, 'web/src/WebFileViewerApps.tsx'), 'utf8')
const begin = routed.indexOf('function WebViewerFrame({')
const end = routed.indexOf('\nfunction FileViewerActions({', begin)
assert.ok(begin >= 0 && end > begin, 'extract the REAL routed mobile Web Viewer frame')
const actual = routed.slice(begin, end).replace('function WebViewerFrame({',
  'export function WebViewerFrame({')
const scaffold = [
  "import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'",
  "import type { ReactNode, FocusEvent as ReactFocusEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'",
  "import { Box, IconButton, Stack, Tooltip, Typography, useMediaQuery, useXDrivePreviewSlideshow, xDriveContainViewerTabFocus } from './test-fixture'",
  "type XDriveFilePreviewPresentationState = 'loading' | 'ready' | 'failed'",
  "const XDRIVE_WEB_VIEWER_PHONE_LANDSCAPE_TOUCH_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'",
  "const ArrowBackRoundedIcon = () => null",
  "const PauseRoundedIcon = () => null",
  "const PlayArrowRoundedIcon = () => null",
  "const KeyboardArrowLeftRoundedIcon = () => null",
  "const KeyboardArrowRightRoundedIcon = () => null",
  actual,
].join('\n')
const compiled = ts.transpileModule(scaffold, {
  fileName: 'RealWebViewerFrame.tsx',
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(diag => diag.category === ts.DiagnosticCategory.Error)
  .map(diag => ts.flattenDiagnosticMessageText(diag.messageText, '\n')), [])

let viewport = 390
let coarsePointer = true
const fixtures = {
  ...Object.fromEntries(['Box','IconButton','Stack','Tooltip','Typography']
    .map(name => [name, name.toLowerCase()])),
  useMediaQuery(query) {
    if (query === '(max-width:899.95px)') return viewport < 900
    if (query === '(max-width:367.95px)') return viewport < 368
    if (query === '(max-width:899.95px) and (pointer: coarse)') return viewport < 900 && coarsePointer
    if (query.includes('orientation: landscape')) return false
    throw Error('unknown actual mobile breakpoint '+query)
  },
  useXDrivePreviewSlideshow: () => undefined,
  xDriveContainViewerTabFocus: () => false,
}
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRef, moduleRef.exports, name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (name === './test-fixture') return fixtures
    throw Error('unexpected real Web viewer module: '+name)
  },
)
const Frame = moduleRef.exports.WebViewerFrame
assert.equal(typeof Frame,'function')
const chrome = (view, label) => view.root.findAll(node =>
  node.props?.['data-xdrive-web-viewer-chrome'] === label)[0]
const findButton = (view, label) => view.root.findAll(node =>
  node.type === 'iconbutton' && node.props['aria-label'] === label)[0]
async function withFrame({ width, coarse, video }, check) {
  viewport = width
  coarsePointer = coarse
  const existingWindow = global.window
  const existingDocument = global.document
  const timers = new Map()
  let timerID = 0
  global.window = {
    setTimeout(fn, delay) {
      const id = ++timerID
      timers.set(id, { fn, delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
  }
  global.document = { activeElement: null }
  let nextCount = 0
  let backCount = 0
  let view
  const props = {
    title: 'family-trip.mp4',
    subtitle: '2026年11月9日',
    positionLabel: '2 / 3',
    photosViewer: true,
    immersive: true,
    chromeSessionKey: 'owner-video-42',
    keepChromeVisible: video,
    canNext: true,
    canPrevious: true,
    onNext: () => { nextCount++ },
    onPrevious: () => {},
    onClose: () => { backCount++ },
    filmstrip: React.createElement('filmstrip', { 'data-test-filmstrip': true }),
    actions: React.createElement('viewer-actions'),
    presentationState: 'loading',
    navigationLoading: false,
  }
  try {
    await act(async () => {
      view = Renderer.create(React.createElement(Frame, props, React.createElement('video-preview')))
    })
    await check({
      view, timers, props,
      get nextCount() { return nextCount },
      get backCount() { return backCount },
      async change(next) {
        await act(async () => view.update(React.createElement(Frame,
          { ...props, ...next }, React.createElement('video-preview'))))
      },
      async fire(delay) {
        const matching = [...timers].find(([, timer]) => timer.delay === delay)
        assert.ok(matching, 'missing auto-hide timer '+delay)
        timers.delete(matching[0])
        await act(async () => matching[1].fn())
      },
    })
  } finally {
    if (view) await act(async () => view.unmount())
    global.window = existingWindow
    global.document = existingDocument
  }
}

test('iPhone Safari routed video Viewer preserves Back, filmstrip and Next after slow buffering', async () => {
  // The routed Web/PWA Viewer is SEPARATE from Desktop MediaGalleryViewer.
  assert.ok(routed.includes("keepChromeVisible={viewer.loading || viewer.navigationLoading || previewKind === 'video' ||"),
    'Safari routed Viewer must preserve Back during slow metadata and video buffering')
  for (const config of [
    {width: 390, coarse: true, video: true},
    {width: 430, coarse: false, video: true},
    {width: 900, coarse: false, video: true},
  ]) {
    await withFrame(config, async ({view,timers,change}) => {
      assert.equal(chrome(view,'header')?.props.sx.visibility,'visible')
      assert.equal([...timers.values()].some(timer => timer.delay === 2200),false,
        'video must never auto-hide its only navigation after 2.2 seconds')
      assert.equal(chrome(view,'filmstrip')?.props.sx.visibility,'visible')
      assert.ok(findButton(view,'返回'))
      assert.ok(findButton(view,'下一个项目'))
      await change({presentationState:'ready'})
      assert.equal(chrome(view,'header')?.props.sx.visibility,'visible',
        'first decoded frame must not suddenly remove the top navigation')
      assert.equal(chrome(view,'filmstrip')?.props.sx.visibility,'visible')
      assert.equal([...timers.values()].some(timer => timer.delay === 2200),false)
      assert.equal(chrome(view,'header')?.props.sx.pt,
        config.width < 900 ? 'env(safe-area-inset-top)' : 0)
    })
  }
})

test('Safari video next and Back buttons stay functional on the real routed chrome', async () => {
  await withFrame({width:390,coarse:true,video:true},async state => {
    await act(async () => findButton(state.view,'下一个项目').props.onClick())
    await act(async () => findButton(state.view,'返回').props.onClick())
    assert.equal(state.nextCount,1)
    assert.equal(state.backCount,1)
    assert.equal(chrome(state.view,'header').props.sx.pointerEvents,'auto')
    assert.equal(chrome(state.view,'filmstrip').props.sx.pointerEvents,'auto')
    const rail = chrome(state.view,'actions')
    assert.equal(rail.props.sx.visibility,'visible')
    assert.equal(rail.props.sx.pb,'env(safe-area-inset-bottom)',
      'Safari browser controls require bottom safe area')
    assert.equal(state.view.root.findAll(node=>node.props?.['data-xdrive-web-viewer']).length,1)
  })
})

test('ordinary photo Viewer still auto-hides its chrome after 2.2 seconds', async () => {
  await withFrame({width:390,coarse:true,video:false},async state => {
    assert.equal(chrome(state.view,'header').props.sx.visibility,'visible')
    await state.fire(2200)
    assert.equal(chrome(state.view,'header').props.sx.visibility,'hidden')
    assert.equal(chrome(state.view,'filmstrip').props.sx.visibility,'hidden')
    assert.equal(chrome(state.view,'actions').props.sx.pointerEvents,'none')
  })
})


test('iPhone Safari retains Back before metadata identifies the video and while navigating', async () => {
  await withFrame({width:390, coarse:true, video:true}, async state => {
    await state.change({
      title:'媒体查看器', positionLabel:undefined,
      canPrevious:false, canNext:false, filmstrip:undefined,
      keepChromeVisible:true, presentationState:'loading', navigationLoading:true,
    })
    assert.equal(findButton(state.view,'返回')?.props.disabled,undefined,
      'Back must remain enabled even when the media identity is not yet available')
    assert.equal(chrome(state.view,'header')?.props.sx.visibility,'visible')
    assert.equal([...state.timers.values()].some(t => t.delay === 2200),false,
      'slow metadata must not hide the only available navigation')
    assert.equal(chrome(state.view,'actions'),undefined)
    await state.change({presentationState:'ready', navigationLoading:false,
      canNext:true, canPrevious:true, filmstrip:React.createElement('filmstrip'),
      keepChromeVisible:true})
    assert.equal(chrome(state.view,'header')?.props.sx.visibility,'visible')
    assert.ok(findButton(state.view,'下一个项目'),
      'adjacent navigation must be restored without remounting the Viewer')
  })
})
