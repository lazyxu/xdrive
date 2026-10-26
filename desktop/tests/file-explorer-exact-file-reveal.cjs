'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '../..')
const read = source => fs.readFileSync(path.join(root, source), 'utf8')
const compile = source => {
  const built = buildSync({
    entryPoints: [path.join(root, source)],
    bundle: true, platform: 'node', format: 'cjs',
    write: false, logLevel: 'silent',
  }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', built)(loaded.exports, loaded, require)
  return loaded.exports
}
const { xDriveFileExplorerVerifiedChildReveal: reveal } =
  compile('ui/shared/src/mui/FileExplorerReanchor.ts')
const { xDriveWebAppHash, xDriveParseWebAppHash } =
  compile('ui/shared/src/web-app.ts')

const sort = { key: 'name', direction: 'asc' }
const grouping = { groupBy: 'none', foldersFirst: true }
const position = {
  node_id: 321, revision: 7, index: 95237,
  sort: 'name', order: 'asc', group: 'none', folders_first: true,
}
const parameters = overrides => ({
  parentID: 12,
  nodeID: 321,
  itemCount: 100000,
  sort,
  grouping,
  signal: new AbortController().signal,
  locate: async () => position,
  collectRange: async () => [{ id: 321, revision: 7, kind: 'file', name: 'exact.jpg' }],
  ...overrides,
})

test('reveal one exact verified file without fetching preceding 95k siblings', async () => {
  const calls = []
  const result = await reveal(parameters({
    locate: async (...args) => { calls.push(['position', ...args]); return position },
    collectRange: async (...args) => {
      calls.push(['range', ...args])
      return [{ id: 321, revision: 7, name: 'exact.jpg' }]
    },
  }))
  assert.equal(result?.index, 95237)
  assert.equal(result?.item.id, 321)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].slice(0, 3), ['range', 95237, 95237])
  assert.equal(calls[0][5], calls[1][3], 'one cancellation signal for both operations')
})

test('reveal rejects stale position, wrong identity, revision, ordering and missing rows', async () => {
  for (const bad of [
    { ...position, node_id: 13 },
    { ...position, revision: 0 },
    { ...position, index: 100000 },
    { ...position, index: -1 },
    { ...position, sort: 'updated' },
    { ...position, order: 'desc' },
    { ...position, group: 'type' },
    { ...position, folders_first: false },
  ]) {
    let ranges = 0
    assert.equal(await reveal(parameters({
      locate: async () => bad,
      collectRange: async () => { ranges += 1; return [] },
    })), null)
    assert.equal(ranges, 0, 'invalid position must never authorize a Range')
  }
  for (const rows of [
    [], [{ id: 999, revision: 7 }], [{ id: 321, revision: 8 }],
    [{ id: 321, revision: 7 }, { id: 321, revision: 7 }],
  ]) {
    assert.equal(await reveal(parameters({ collectRange: async () => rows })), null)
  }
  assert.equal(await reveal(parameters({ parentID: 0 })), null)
  assert.equal(await reveal(parameters({ nodeID: -1 })), null)
  assert.equal(await reveal(parameters({ itemCount: 0 })), null)
})

test('reveal cancellation stops old source before loading or selecting another file', async () => {
  const a = new AbortController()
  a.abort()
  let reads = 0
  await assert.rejects(() => reveal(parameters({
    signal: a.signal, locate: async () => { reads++; return position },
  })), { name: 'AbortError' })
  assert.equal(reads, 0)
  const b = new AbortController()
  await assert.rejects(() => reveal(parameters({
    signal: b.signal,
    locate: async () => { b.abort(); return position },
    collectRange: async () => { reads++; return [] },
  })), { name: 'AbortError' })
  assert.equal(reads, 0)
})

test('files deep link preserves exact file ID, rejects invalid/select-only routes', () => {
  const route = { app: 'files', params: { dir: 12, select: 321 } }
  const hash = xDriveWebAppHash(route)
  assert.equal(hash, '#/app/files?dir=12&select=321')
  assert.deepEqual(xDriveParseWebAppHash(hash), route)
  assert.deepEqual(xDriveParseWebAppHash('#/app/files?select=321'), {
    app: 'files', params: { dir: undefined, select: undefined },
  })
  assert.deepEqual(xDriveParseWebAppHash('#/app/files?dir=12&select=-1'), {
    app: 'files', params: { dir: 12, select: undefined },
  })
})

test('same verified child reveal is wired into wide Web, Desktop and mobile Files', () => {
  const shared = read('ui/shared/src/mui/FileExplorer.tsx')
  const workspace = read('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
  const web = read('web/src/WebFileExplorer.tsx')
  const mobile = read('web/src/MobileFiles.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const webApp = read('web/src/App.tsx')
  const desktopApp = read('desktop/src/renderer/App.tsx')
  for (const code of [
    'xDriveFileExplorerVerifiedChildReveal({',
    'applySelection([result.item.id], [result.item])',
    'setActiveLogicalIndex(result.index)',
    'restoreLayoutRef.current',
    'host.scrollTop = top',
    'return () => controller.abort()',
  ]) assert.ok(shared.includes(code), 'shared visual reveal missing ' + code)
  assert.ok(workspace.includes('await navigation.navigateTo(parentCrumbs, true, intent, (value) =>') &&
    workspace.includes('navigation.isNavigationIntentCurrent(intent)'),
  'Search must wait for an accepted parent first Range')
  for (const code of ['revealTarget={', 'locateVerifiedReveal={', 'showNodeLocation',
    'target.nodeID', 'requestReveal(target.parentID, target.nodeID)']) {
    assert.ok(web.includes(code), 'Web route/reveal missing ' + code)
  }
  for (const code of [
    'mobileFilesViewportTop({', 'setSelected(new Map([[String(result.item.id), result.item]]))',
    'props.locateVerifiedReveal', 'controller.abort()', 'inlineLayout.itemCount !== totalCount',
  ]) assert.ok(mobile.includes(code), 'Mobile presentation missing ' + code)
  for (const code of ['revealTarget={', 'cloudChildPosition(', 'showNodeLocation',
    'requestReveal(target.parentID, target.nodeID)']) {
    assert.ok(desktop.includes(code), 'Desktop missing ' + code)
  }
  assert.ok(webApp.includes('initialRevealNodeID='))
  assert.ok(webApp.includes('select: location.node_id'))
  assert.ok(webApp.includes('select: targetNodeID'))
  assert.ok(desktopApp.includes('revealCloudNodeInDirectory('))
  assert.ok(desktopApp.includes('revealTarget: cloudFileActionLifecycleKey && cloudRevealTarget?.requestID.startsWith('),
    'Desktop exact reveal must be scoped to the authenticated Owner')
  assert.ok(desktopApp.includes('? cloudRevealTarget : null'),
    'a former Owner request cannot leak into the new Desktop file explorer')
})
