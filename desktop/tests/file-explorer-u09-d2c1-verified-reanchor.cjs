'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const shared = read('ui/shared/src/mui/FileExplorer.tsx')
const nav = read('ui/shared/src/mui/FileExplorerNavigation.ts')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const app = read('desktop/src/renderer/App.tsx')
const source = read('ui/shared/src/mui/FileExplorerReanchor.ts')
const built = buildSync({
  entryPoints: [path.join(root, 'ui/shared/src/mui/FileExplorerReanchor.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
}).outputFiles[0].text
const moduleForTest = { exports: {} }
new Function('exports', 'module', 'require', built)(moduleForTest.exports, moduleForTest, require)
const verify = moduleForTest.exports.xDriveFileExplorerVerifiedChildReanchor
const sort = { key: 'updated', direction: 'desc' }
const grouping = { groupBy: 'modified', foldersFirst: false }
const p = { node_id: 42, revision: 7, index: 54321, sort: 'updated', order: 'desc', group: 'modified', folders_first: false }
const params = overrides => ({
  parentID: 2, nodeID: 42, revision: 7, itemCount: 100000, sort, grouping,
  signal: new AbortController().signal,
  locate: async () => p,
  collectRange: async () => [{ id: 42, revision: 7, name: 'canonical.pdf', kind: 'file' }],
  ...overrides,
})

test('U09-D2c1 exact real helper loads one Server-authoritative 100k ordinal', async () => {
  const calls = []
  const result = await verify(params({
    locate: async (...args) => { calls.push(['position', ...args]); return p },
    collectRange: async (...args) => { calls.push(['range', ...args]); return [{ id: 42, revision: 7 }] },
  }))
  assert.equal(result.index, 54321)
  assert.equal(result.item.id, 42)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'position')
  assert.deepEqual(calls[1].slice(0, 3), ['range', 54321, 54321])
  assert.equal(calls[0][5], calls[1][3], 'same request signal for both operations')
})

test('U09-D2c1 wrong Node/Revision/order and out-of-bounds index cannot reanchor', async () => {
  for (const response of [
    { ...p, node_id: 43 }, { ...p, revision: 8 },
    { ...p, sort: 'name' }, { ...p, group: 'size' },
    { ...p, index: 100000 }, { ...p, index: -1 },
  ]) {
    let ranges = 0
    assert.equal(await verify(params({
      locate: async () => response,
      collectRange: async () => { ranges++; return [] },
    })), null)
    assert.equal(ranges, 0)
  }
  assert.equal(await verify(params({ collectRange: async () => [{ id: 420, revision: 7 }] })), null)
  assert.equal(await verify(params({ collectRange: async () => [{ id: 42, revision: 8 }] })), null)
})

test('U09-D2c1 real signal cancellation halts both steps without applying an obsolete ordinal', async () => {
  const a = new AbortController(); a.abort()
  let calls = 0
  await assert.rejects(() => verify(params({ signal: a.signal, locate: async () => { calls++; return p } })), { name: 'AbortError' })
  assert.equal(calls, 0)
  const b = new AbortController()
  await assert.rejects(() => verify(params({
    signal: b.signal, locate: async () => { b.abort(); return p },
    collectRange: async () => { calls++; return [] },
  })), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('U09-D2c1 shared visual owner and Web/Desktop transport fence authorized first Range', () => {
  for (const token of [
    'const stageAuthoritativeReanchor = (',
    'pendingReanchorRef.current?.controller?.abort()',
    'accepted !== true', 'generation !== reanchorGenerationRef.current',
    'pending.fromVirtualKey === virtualCollection?.interactionKey',
    'xDriveFileExplorerVerifiedChildReanchor({',
    'selectionIntentRef.current > pending.selectionGeneration + 1',
    'restoreLayoutRef.current.itemTop(result.index)',
    'if (pending.wasSelected) applySelection([result.item.id], [result.item])',
  ]) assert.ok(shared.includes(token), token)
  assert.match(nav, /const changeSort = \(nextSort: XDriveFileExplorerSort\): Promise<boolean>/)
  assert.match(nav, /const changeGrouping = \(nextGrouping: XDriveFileExplorerGrouping\): Promise<boolean>/)
  assert.match(web, /api\.childPosition\(\s*parentID, nodeID, targetSort\.key, targetSort\.direction, targetGrouping, signal/)
  assert.match(desktop, /xDriveDesktopViewportRequest\(signal, \(requestID\) =>/)
  assert.match(desktop, /agent\.cloudChildPosition\(/)
  assert.match(app, /capabilities\.includes\('cloud-child-position'\)/)
  assert.doesNotMatch(desktop, /\/children\/position\?/)
  assert.match(source, /position\.revision !== revision/)
  assert.match(source, /Number\(rows\[0\]\.revision\) !== position\.revision/)
})
