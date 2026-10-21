'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('web/src/webViewerContext.ts')
const hook = read('web/src/useWebViewerNode.ts')
const compiled = ts.transpileModule(source, {
  fileName: 'web/src/webViewerContext.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [])
const exportsObject = {}
const moduleObject = { exports: exportsObject }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleObject, exportsObject, id => {
    if (id === '../../ui/shared/src') return { xDriveClassifyFilePreview: () => 'image' }
    throw new Error('unexpected dependency: ' + id)
  },
)
const { createXDriveWebViewerSession } = moduleObject.exports
function mockContext() {
  return { kind: 'gallery', target: {
    kind: 'baidu-cell', query: { sort_by: 'captured', sort_dir: 'desc' },
    baiduCell: { bounds: { coordinate_space: 'bd09ll', west: 116, east: 117,
      south: 39, north: 40 }, cell_x: 2, cell_y: 4,
      asset_id: 9, node_id: 19, node_revision: 3, photo_count: 2 },
  }, activeIndex: 0, totalCount: 2 }
}
test('W3a aborted Viewer cancels real Owner-cell transport and not generic Gallery', async () => {
  const signals = []
  const source = {
    listItemRange: () => { throw new Error('unscoped gallery read') },
    listBaiduNativeCellItems: (_selection, limit, offset, sort, signal) => {
      assert.equal(limit, 100)
      assert.equal(offset, 0)
      assert.deepEqual(sort, { by: 'captured', dir: 'desc' })
      signals.push(signal)
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        if (signals.length === 2) resolve({
          items: [{ node: { id: 19, type: 'file', name: 'photo.heic', revision: 3 } }],
          total_count: 1,
        })
      })
    },
  }
  const session = createXDriveWebViewerSession({}, source, mockContext())
  const first = session.candidateAt(0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(signals.length, 1)
  assert.equal(signals[0].aborted, false)
  session.dispose()
  assert.equal(signals[0].aborted, true)
  await assert.rejects(first, /aborted/)
  await assert.rejects(session.candidateAt(0), /已取消/)
  // StrictMode effect replay resumes one memoized reader with a fresh signal.
  session.activate()
  const value = await session.candidateAt(0)
  assert.equal(value.node.id, 19)
  assert.equal(signals.length, 2)
  assert.notEqual(signals[0], signals[1])
  assert.equal(signals[1].aborted, false)
  session.dispose()
  assert.equal(signals[1].aborted, true)
})
test('W3a new Viewer reader does not reuse cancelled context', async () => {
  const seen = []
  const source = {
    listBaiduNativeCellItems: (_selection, _limit, _offset, _sort, signal) => {
      seen.push(signal)
      return Promise.resolve({ items: [{
        node: { id: 20, type: 'file', revision: 1, name: 'clip.mp4' },
      }], total_count: 1 })
    },
  }
  const context = mockContext()
  const first = createXDriveWebViewerSession({}, source, context)
  assert.equal((await first.candidateAt(0)).node.id, 20)
  first.dispose()
  const second = createXDriveWebViewerSession({}, source, context)
  assert.equal((await second.candidateAt(0)).node.id, 20)
  assert.equal(seen.length, 2)
  assert.equal(seen[0].aborted, true)
  assert.equal(seen[1].aborted, false)
  second.dispose()
})
test('W3a Viewer hook aborts session on route/index/Owner/unmount', () => {
  assert.match(hook, /useEffect\(\(\) => \{\s*session\.activate\(\)\s*return \(\) => session\.dispose\(\)\s*\}, \[session\]\)/)
  assert.match(source, /const signal = rangeController\.signal/)
  assert.match(source, /target\.baiduCell, limit, offset,[\s\S]*?signal,/)
  assert.doesNotMatch(source, /new AbortController\(\)\.signal,/)
})
