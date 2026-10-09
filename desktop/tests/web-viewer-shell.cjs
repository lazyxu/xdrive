const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
let compactTouch = false
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
  useMediaQuery: () => compactTouch,
}
const sharedUI = {
  XDriveFilePreviewSurface: (props) => React.createElement('preview-content', props),
  XDriveMediaViewerContent: (props) => React.createElement('media-content', props),
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
