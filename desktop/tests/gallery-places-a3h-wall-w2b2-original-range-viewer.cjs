'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const app = read('ui/shared/src/web-app.ts')
const webViewer = read('web/src/webViewerContext.ts')
const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
const isolated = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
test('W2b2 keeps trusted BD09 cell as distinct Gallery and Viewer range', () => {
  assert.match(app, /\| 'baidu-cell'/)
  assert.match(app, /baiduCell\?: MediaBaiduNativeCellSelection/)
  assert.match(gallery, /case 'baidu-cell':/)
  assert.match(webViewer, /case 'baidu-cell':/)
  assert.match(webViewer, /source\.listBaiduNativeCellItems\(/)
  assert.match(gallery, /target\.baiduCell \? JSON\.stringify\(target\.baiduCell\)/)
})
test('W2b2 atomically commits a real Owner first page before showing photo wall', () => {
  assert.match(gallery, /const openBaiduNativeCell = useCallback/)
  assert.match(gallery, /source\.listBaiduNativeCellItems\(\s*cell, pageSize, 0/)
  assert.match(gallery, /if \(controller\.signal\.aborted \|\| request !== requestID\.current\) return/)
  assert.match(gallery, /setCollectionTarget\(target\)/)
  assert.match(gallery, /virtualCollection\.primePage\(\{/)
  assert.match(gallery, /nativeCellWall \|\|/)
  assert.match(gallery, /!nativeCellWall/)
})
test('W2b2 navigation and Refresh must never turn a cell into an unscoped all-items Range', () => {
  assert.match(gallery, /const selectSection = useCallback\([^\n]*\n\s*\/\/[^\n]*\n\s*nativeCellOpenAbort\.current\?\.abort\(\)/)
  assert.match(gallery, /const refreshGallery = \(\) => \{\n\s*if \(collectionTargetRef\.current\?\.kind === 'baidu-cell'\)/)
  assert.match(gallery, /const showCollectionFilters =\s*showPhotoCollection &&\s*!nativeCellWall/)
  assert.match(gallery, /const leaveBaiduCellWall = useCallback/)
})
test('W2b2 aborts pending map selection on camera invalidation or leaving collection', () => {
  assert.match(surface, /if \(!page\) latestInvalidation\.current\?\.\(\)/)
  assert.match(map, /onInvalidated=\{onBaiduNativeCellInvalidated\}/)
  assert.match(isolated, /invalidated\.current\?\.\(\)/)
  assert.match(isolated, /activeQuery\?\.abort\(\)/)
  assert.match(gallery, /onBaiduNativeCellInvalidated=\{\(\) => nativeCellOpenAbort\.current\?\.abort\(\)\}/)
  assert.match(gallery, /nativeCellOpenAbort\.current\?\.abort\(\)/)
  assert.match(gallery, /if \(collectionTargetRef\.current\?\.kind === 'baidu-cell'\)/)
})

test('W2b2 Viewer pages respect the signed Owner Cell 100-item hard limit', async () => {
  const ts = require('typescript')
  const compiled = ts.transpileModule(webViewer, {
    fileName: 'web/src/webViewerContext.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, (name) => {
      if (name === '../../ui/shared/src') return { xDriveClassifyFilePreview: () => 'image' }
      throw Error('unexpected dependency ' + name)
    },
  )
  const calls = []
  const selection = { bounds: { coordinate_space: 'bd09ll', west: 116, east: 117,
    south: 39, north: 41 }, cell_x: 2, cell_y: 3, asset_id: 1, node_id: 10,
    node_revision: 2, photo_count: 101 }
  const context = { kind: 'gallery', target: { kind: 'baidu-cell', baiduCell: selection,
    query: { sort_by: 'captured', sort_dir: 'desc' } }, activeIndex: 100, totalCount: 101 }
  const source = {
    listItemRange: () => { throw Error('forbidden unscoped Gallery Range') },
    listBaiduNativeCellItems: (sel, limit, offset, sort, signal) => {
      assert.equal(sel, selection)
      assert.equal(limit, 100)
      assert.equal(offset, 100)
      assert.deepEqual(sort, { by: 'captured', dir: 'desc' })
      assert.equal(signal.aborted, false)
      calls.push(offset)
      return Promise.resolve({ items: [{ node: { id: 101, type: 'file',
        name: 'item.heic', revision: 1 } }], total_count: 101, offset, limit })
    },
  }
  const session = mod.exports.createXDriveWebViewerSession({}, source, context)
  const item = await session.candidateAt(100)
  assert.equal(item.node.id, 101)
  assert.equal(item.index, 100)
  assert.equal(item.totalCount, 101)
  assert.deepEqual(calls, [100])
})

test('W2b2 presentational Gallery consumes explicit Owner Cell scope from Page (no undefined collectionTarget)', () => {
  assert.match(gallery, /isBaiduCellWall=\{collectionTarget\?\.kind === 'baidu-cell'\}/)
  assert.match(gallery, /isBaiduCellWall\?: boolean/)
  assert.match(gallery, /isBaiduCellWall = false,/)
  assert.match(gallery, /const nativeCellWall = isBaiduCellWall/)
  assert.doesNotMatch(gallery, /const nativeCellWall = collectionTarget\?\.kind/)
})
