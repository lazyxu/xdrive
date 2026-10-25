'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const helperPath = 'web/src/viewerFocusScope.ts'
const compiled = ts.transpileModule(read(helperPath), {
  fileName: helperPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleExports = {}
new Function('exports', compiled)(moduleExports)
const { xDriveContainViewerTabFocus: containTab } = moduleExports

function frame(count = 3) {
  const history = []
  const items = Array.from({ length: count }, (_, index) => ({
    index,
    visible: true,
    insideHiddenParent: false,
    tabIndexAttribute: null,
    disabled: false,
    getAttribute(name) { return name === 'tabindex' ? this.tabIndexAttribute : null },
    matches(selector) { return selector === ':disabled' && this.disabled },
    getClientRects() { return this.visible ? [{}] : [] },
    closest() { return this.insideHiddenParent ? {} : null },
    focus() { history.push(this.index) },
  }))
  const root = {
    querySelectorAll() { return items },
    contains(element) { return items.includes(element) },
    focus() { history.push('root') },
  }
  return { history, items, root }
}

test('routed Viewer loops Tab and Shift+Tab within its own focus boundary', () => {
  const { history, items, root } = frame()
  assert.equal(containTab(root, items[2], false), true)
  assert.equal(containTab(root, items[0], true), true)
  assert.equal(containTab(root, root, false), true)
  assert.equal(containTab(root, root, true), true)
  assert.deepEqual(history, [0, 2, 0, 2])
  assert.equal(containTab(root, items[1], false), false,
    'normal interior Tab order stays native')
  assert.equal(containTab(root, items[1], true), false)
  assert.equal(containTab(root, { foreign: true }, false), false,
    'a portaled dialog/menu owns its focus, not the Viewer')
  assert.deepEqual(history, [0, 2, 0, 2])
})

test('Viewer excludes hidden and inert chrome and retains a safe empty focus fallback', () => {
  const { items, root, history } = frame()
  items[0].visible = false
  items[2].insideHiddenParent = true
  assert.equal(containTab(root, items[1], false), true)
  assert.equal(containTab(root, items[1], true), true)
  assert.deepEqual(history, [1, 1])
  items[1].visible = false
  assert.equal(containTab(root, root, false), true)
  assert.equal(history.at(-1), 'root')
  assert.equal(containTab(null, root, false), false)
})

test('routed Web/Mobile Viewer uses a labelled modal dialog and traps only Tab', () => {
  const source = read('web/src/WebFileViewerApps.tsx')
  assert.match(source, /data-xdrive-web-viewer\s+role="dialog"\s+aria-modal="true"/)
  assert.match(source, /aria-label=\{photosViewer \? '照片查看器'/)
  assert.match(source, /event\.key === 'Tab' && xDriveContainViewerTabFocus\(rootRef\.current, document\.activeElement, event\.shiftKey\)/)
  assert.match(source, /event\.preventDefault\(\)\s+return/)
  assert.match(source, /if \(interactive\) return/)
  assert.match(read(helperPath), /video\[controls\].*audio\[controls\].*iframe/)
})

test('routed Viewer never uses non-tabbable Filmstrip thumbnails or disabled controls as Tab endpoints', () => {
  // MUI Filmstrip buttons use roving tabIndex=-1; they still match
  // button:not(:disabled) in the broad focusable CSS query.
  const { items, root, history } = frame(4)
  items[1].tabIndexAttribute = '-1'
  items[2].disabled = true
  items[2].tabIndexAttribute = '0'
  items[3].tabIndexAttribute = '-2'
  assert.equal(containTab(root, items[0], false), true,
    'Tab from the sole tabbable child must wrap, not escape behind the Viewer')
  assert.equal(containTab(root, items[0], true), true)
  assert.equal(containTab(root, root, true), true)
  assert.deepEqual(history, [0, 0, 0])
  assert.match(read('ui/shared/src/mui/MediaGalleryFilmstrip.tsx'),
    /tabIndex=\{active \|\| \(!activeEntryVisible && index === entries\[0\]\.index\) \? 0 : -1\}/)
})

test('explicit negative Tab indexes are excluded even from native audio/video and link query arms', () => {
  const { items, root, history } = frame(2)
  items[0].tabIndexAttribute = '-1'
  assert.equal(containTab(root, root, false), true)
  assert.equal(containTab(root, items[1], false), true)
  assert.deepEqual(history, [1, 1])
})
