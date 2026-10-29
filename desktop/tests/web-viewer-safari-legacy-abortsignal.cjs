'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/webViewerContext.ts'), 'utf8')
const output = ts.transpileModule(source, {
  fileName: 'webViewerContext.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const NativeAbortController = AbortController

class LegacyAbortController extends NativeAbortController {
  constructor() {
    super()
    Object.defineProperty(this.signal, 'throwIfAborted', { value: undefined })
  }
}
function production(Controller = LegacyAbortController) {
  const mod = { exports: {} }
  const requireSource = name => {
    if (name === '../../ui/shared/src') return {
      xDriveClassifyFilePreview: () => 'image',
    }
    throw new Error('unexpected Viewer source dependency ' + name)
  }
  new Function('exports', 'module', 'require', 'AbortController', output)(
    mod.exports, mod, requireSource, Controller)
  return mod.exports
}
const photo = id => ({
  node: { id, revision: 1, type: 'file', name: id + '.jpg', size: 17 },
  metadata: {}, favorite: false,
})
const library = totalCount => ({
  kind: 'gallery', target: { kind: 'library', query: {} },
  activeIndex: 1, totalCount,
})

test('PWA Viewer on legacy WebKit reads current/neighbor Gallery without optional throwIfAborted', async () => {
  const { createXDriveWebViewerSession } = production()
  let calls = 0, signal
  const source = { listItemRange: async (limit, offset, query, givenSignal) => {
    calls++
    signal = givenSignal
    assert.equal(offset, 0)
    assert.equal(typeof signal.throwIfAborted, 'undefined')
    return { total_count: 3, items: [photo(1), photo(2), photo(3)] }
  } }
  const session = createXDriveWebViewerSession({}, source, library(3))
  const [current, previous, next] = await Promise.all([
    session.current(2, 1, true),
    session.neighbor(1, -1, () => true),
    session.neighbor(1, 1, () => true),
  ])
  assert.equal(current.node.id, 2)
  assert.equal(current.mediaItem.node.id, 2)
  assert.equal(previous.node.id, 1)
  assert.equal(next.node.id, 3)
  assert.equal(calls, 1, 'same bounded Owner page must be shared')
  session.dispose()
  assert.equal(signal.aborted, true)
})

test('PWA legacy WebKit refuses to publish a late Gallery response after Viewer Back', async () => {
  const { createXDriveWebViewerSession } = production()
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const source = { listItemRange: (_limit, _offset, _query, signal) => {
    enter(signal)
    return new Promise(resolve => { release = resolve })
  } }
  let fallbackCalls = 0
  const api = {
    node: async id => { fallbackCalls++; return photo(id).node },
    mediaItem: async id => { fallbackCalls++; return photo(id) },
  }
  const session = createXDriveWebViewerSession(api, source, library(1))
  const pending = session.current(1, 0, true)
  const oldSignal = await entered
  assert.equal(typeof oldSignal.throwIfAborted, 'undefined')
  session.dispose()
  assert.equal(oldSignal.aborted, true)
  release({ total_count: 1, items: [photo(1)] })
  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.equal(fallbackCalls, 0, 'a cancelled range cannot cause point-API fallback')
})

test('PWA legacy WebKit retains selection cancellation when old Node resolves late', async () => {
  const { createXDriveWebViewerSession } = production()
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const api = { node: (_id, signal) => {
    enter(signal)
    return new Promise(resolve => { release = resolve })
  } }
  const session = createXDriveWebViewerSession(api, {}, {
    kind: 'selection', nodeIDs: [7], activeIndex: 0,
  })
  const pending = session.candidateAt(0)
  const oldSignal = await entered
  session.dispose()
  assert.equal(oldSignal.aborted, true)
  release(photo(7).node)
  await assert.rejects(pending, error => error?.name === 'AbortError')
})

test('PWA private map Viewer with legacy WebKit cannot widen cancelled signed scope', async () => {
  const { createXDriveWebViewerSession } = production()
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  let pointReads = 0
  const api = {
    node: async id => { pointReads++; return photo(id).node },
    mediaItem: async id => { pointReads++; return photo(id) },
  }
  const source = { listBaiduNativeCellItems: (_cell, _limit, _offset, _sort, signal) => {
    enter(signal)
    return new Promise(resolve => { release = resolve })
  } }
  const context = {
    kind: 'gallery', totalCount: 1, activeIndex: 0,
    target: { kind: 'baidu-cell', id: 'signed-cell',
      baiduCell: { photo_count: 1 }, query: {} },
  }
  const session = createXDriveWebViewerSession(api, source, context)
  const pending = session.current(13, 0, true)
  const oldSignal = await entered
  session.dispose()
  assert.equal(oldSignal.aborted, true)
  release({ total_count: 1, items: [photo(13)] })
  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.equal(pointReads, 0)
})

test('PWA Viewer denies an unreadable AbortSignal before issuing private Range', async () => {
  class DeniedAbortController extends LegacyAbortController {
    constructor() {
      super()
      Object.defineProperty(this.signal, 'aborted', {
        get() { throw new Error('SecurityError: signal status denied') },
      })
    }
  }
  const { createXDriveWebViewerSession } = production(DeniedAbortController)
  let reads = 0
  const source = { listItemRange: async () => {
    reads++
    return { total_count: 1, items: [photo(1)] }
  } }
  const session = createXDriveWebViewerSession({}, source, library(1))
  await assert.rejects(session.candidateAt(0), error => error?.name === 'AbortError')
  assert.equal(reads, 0, 'an unreadable cancellation state is not Range authorization')
})
