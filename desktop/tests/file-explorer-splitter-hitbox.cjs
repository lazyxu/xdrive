'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const code = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerPaneKeyboardResize.ts'), 'utf8')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const js = ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const mod = { exports: {} }
new Function('exports', 'module', js)(mod.exports, mod)
const resize = mod.exports.xDriveFileExplorerKeyboardResizeWidth

test('F04 navigation pane keyboard expands right without touching existing pointer width limits', () => {
  const nav = { width: 232, minWidth: 176, maxWidth: 320, expandArrow: 'ArrowRight' }
  assert.equal(resize({ ...nav, key: 'ArrowRight' }), 248)
  assert.equal(resize({ ...nav, key: 'ArrowLeft' }), 216)
  assert.equal(resize({ ...nav, key: 'ArrowRight', shiftKey: true }), 264)
  assert.equal(resize({ ...nav, key: 'Home' }), 176)
  assert.equal(resize({ ...nav, key: 'End' }), 320)
  assert.equal(resize({ ...nav, key: 'ArrowRight', width: 318 }), 320)
})
test('F04 inspector pane expands LEFT and Details columns use their own limits', () => {
  const inspector = { width: 312, minWidth: 260, maxWidth: 480, expandArrow: 'ArrowLeft' }
  assert.equal(resize({ ...inspector, key: 'ArrowLeft' }), 328)
  assert.equal(resize({ ...inspector, key: 'ArrowRight' }), 296)
  assert.equal(resize({ ...inspector, key: 'ArrowLeft', shiftKey: true }), 344)
  assert.equal(resize({ ...inspector, key: 'Home' }), 260)
  assert.equal(resize({ ...inspector, key: 'End' }), 480)
  assert.equal(resize({ ...inspector, key: 'ArrowRight', width: 260 }), 260)
  const column = { width: 320, minWidth: 180, maxWidth: 900, expandArrow: 'ArrowRight' }
  assert.equal(resize({ ...column, key: 'ArrowLeft', shiftKey: true }), 288)
  assert.equal(resize({ ...column, key: 'End' }), 900)
})
test('F04 does not hijack browser OS shortcuts, IME, or unrelated key handling', () => {
  const nav = { width: 232, minWidth: 176, maxWidth: 320, expandArrow: 'ArrowRight' }
  for (const key of ['Tab', 'Escape', 'Enter', 'PageDown', ' ']) {
    assert.equal(resize({ ...nav, key }), null, key)
  }
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(resize({ ...nav, key: 'ArrowRight', [mod]: true }), null, mod)
  }
  assert.equal(resize({ ...nav, key: 'ArrowRight', width: Number.NaN }), null)
  assert.equal(resize({ ...nav, key: 'ArrowRight', minWidth: 321 }), null)
})
test('F04 all three real splitters remain 6/8px visual but have extended invisible hit zones', () => {
  for (const prop of ['onPointerDown={startNavigationPaneResize}',
    'onPointerDown={startInspectorResize}',
    'onPointerDown={(event) => startDetailsColumnResize(event, key)}']) {
    assert(source.includes(prop), prop)
  }
  assert(source.includes("flex: '0 0 6px'"))
  assert(source.includes('width: 8,'))
  assert.equal((source.match(/left: '-5px', right: '-5px', top: 0, bottom: 0/g) || []).length, 2)
  assert(source.includes("left: '-4px', right: '-4px', top: 0, bottom: 0"))
  assert((source.match(/'&:focus-visible': \{ outline: '2px solid'/g) || []).length >= 3)
})
test('F04 Tab-focusable ARIA splitters use actual persisted bounds, plus working arrow keys', () => {
  const required = [
    'aria-valuemin={fileExplorerNavigationPaneMinWidth}',
    'aria-valuemax={fileExplorerNavigationPaneMaxWidth}',
    'aria-valuenow={viewPreferences.navigationPaneWidth}',
    'aria-valuemin={fileExplorerInspectorMinWidth}',
    'aria-valuemax={fileExplorerInspectorMaxWidth}',
    'aria-valuenow={viewPreferences.inspectorWidth}',
    'aria-valuemin={detailsColumnMeta[key].minWidth}',
    'aria-valuemax={detailsColumnMeta[key].maxWidth}',
    'aria-valuenow={detailsLayout.widths[key]}',
    "handlePaneResizeKey(event, \"navigation\")",
    "handlePaneResizeKey(event, \"inspector\")",
    'handleDetailsColumnResizeKey(event, key)',
  ]
  for(const token of required)assert(source.includes(token), token)
  assert((source.match(/tabIndex=\{0\}/g) || []).length >= 3)
  assert.doesNotMatch(code, /fetch\s*\(|api\/v1|BroadcastChannel|localStorage|skipWaiting/)
})


test('F04 CSS must never repeat position within the same splitter sx literal', () => {
  assert(!/position: 'relative',\s*touchAction: 'none',\s*position: 'relative'/.test(source))
})
