'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const filename = path.resolve(__dirname, '../../ui/shared/src/mui/MediaGalleryOCRDetails.tsx')
const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const exported = {}
new Function('exports', 'require', js)(exported, name => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(name)
  if (name === '@mui/material') return new Proxy({}, { get: (_, key) => String(key) })
  if (name.startsWith('@mui/icons-material/')) return { __esModule: true, default: 'Icon' }
  throw Error('Unexpected dependency ' + name)
})
const Component = exported.XDriveMediaOCRDetails
const item = (revision = 3, ocr) => ({ node: { id: 7, revision }, ocr })
const ready = text => ({ state: 'ready', text })
const renderedText = node => node == null ? '' : typeof node === 'string' ? node
  : Array.isArray(node) ? node.map(renderedText).join(' ') : renderedText(node.children)
const text = tree => renderedText(tree.toJSON())
const button = (tree, label) => tree.root.findAllByType('Button')
  .find(node => node.props.children === label)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('actual OCR inspector refreshes a preloaded result and copies only the current text', async () => {
  let tree, calls = 0, copied = ''
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { clipboard: { writeText: async value => { copied = value } } } })
  try {
    await act(async () => { tree = Renderer.create(React.createElement(Component, {
      item: item(3, ready('旧文本')),
      loadMediaItem: async id => { calls++; assert.equal(id, 7); return item(3, ready('中文 XDRIVE')) },
    })) })
    assert.equal(calls, 0)
    assert.match(text(tree), /旧文本/)
    await act(async () => button(tree, '刷新识别结果').props.onClick())
    assert.equal(calls, 1)
    assert.doesNotMatch(text(tree), /旧文本/)
    await act(async () => button(tree, '复制文字').props.onClick())
    assert.equal(copied, '中文 XDRIVE')
  } finally {
    if (tree) await act(async () => tree.unmount())
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
  }
})

test('actual OCR inspector aborts obsolete reads and refuses stale revisions', async () => {
  let tree
  const first = deferred(), second = deferred(), signals = []
  const loadMediaItem = (_id, signal) => {
    signals.push(signal)
    return signals.length === 1 ? first.promise : second.promise
  }
  try {
    await act(async () => { tree = Renderer.create(React.createElement(Component, {
      item: item(3), loadMediaItem,
    })) })
    await act(async () => tree.update(React.createElement(Component, { item: item(4), loadMediaItem })))
    assert.equal(signals[0].aborted, true)
    await act(async () => first.resolve(item(3, ready('obsolete private text'))))
    assert.doesNotMatch(text(tree), /obsolete private text/)
    await act(async () => second.resolve(item(3, ready('wrong revision private text'))))
    assert.doesNotMatch(text(tree), /wrong revision private text/)
    assert.match(text(tree), /无法读取识别结果/)
  } finally {
    if (tree) await act(async () => tree.unmount())
    assert.equal(signals.every(signal => signal.aborted), true)
  }
})

test('a failed detail read can be refreshed without remounting or polling', async () => {
  let tree, calls = 0
  try {
    await act(async () => { tree = Renderer.create(React.createElement(Component, {
      item: item(), loadMediaItem: async () => {
        if (++calls === 1) throw Error('private upstream failure')
        return item(3, ready('重试成功'))
      },
    })) })
    assert.equal(calls, 1)
    assert.doesNotMatch(text(tree), /private upstream failure/)
    await act(async () => button(tree, '刷新识别结果').props.onClick())
    assert.equal(calls, 2)
    assert.match(text(tree), /重试成功/)
  } finally { if (tree) await act(async () => tree.unmount()) }
})
