'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const sourcePath = 'ui/shared/src/media-gallery-baidu-cell-return-session.ts'
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
const output = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(output.diagnostics || [], [])
const mod = new Module(sourcePath, module)
mod.filename = path.join(root, sourcePath)
mod.paths = module.paths
mod._compile(output.outputText, mod.filename)
const {
  XDRIVE_BAIDU_CELL_RETURN_TTL_MS,
  xDriveRememberBaiduCellReturn,
  xDriveReadBaiduCellReturn,
  xDriveRememberBaiduCellAnchor,
  xDriveClearBaiduCellReturn,
  xDriveBaiduCellReturnMatchesFreshSelection,
} = mod.exports

const cell = () => ({
  bounds: { coordinate_space: 'bd09ll', west: 100, east: 102, south: 20, north: 22 },
  cell_x: 3, cell_y: 4,
  asset_id: 85, node_id: 90, node_revision: 7, photo_count: 33,
})
const fresh = (selection = cell()) => ({ selection, sort: { by: 'captured', dir: 'desc' } })

test('W3b2a stores a tiny allowed Owner-only selection, never SDK extras', () => {
  const snap = fresh()
  snap.selection.bounds.sdkCallback = 'must-not-escape'
  snap.selection.sdkExtra = 'must-not-escape'
  snap.sort.sdkExtra = 'must-not-escape'
  assert.equal(xDriveRememberBaiduCellReturn('owner:a', snap, 100), true)
  snap.selection.node_revision = 99
  snap.selection.bounds.west = 120
  const saved = xDriveReadBaiduCellReturn('owner:a', 101)
  assert.equal(saved.selection.node_revision, 7)
  assert.equal(saved.selection.bounds.west, 100)
  assert.equal(saved.selection.sdkExtra, undefined)
  assert.equal(saved.selection.bounds.sdkCallback, undefined)
  assert.equal(saved.sort.sdkExtra, undefined)
  saved.selection.bounds.west = 200
  assert.equal(xDriveReadBaiduCellReturn('owner:a', 102).selection.bounds.west, 100)
  assert.equal(xDriveReadBaiduCellReturn('owner:b', 102), undefined)
  xDriveClearBaiduCellReturn('owner:a')
})

test('anchor is bounded, updated without changing the authenticated Cell identity', () => {
  assert.equal(xDriveRememberBaiduCellReturn('owner:anchor', fresh(), 1000), true)
  assert.equal(xDriveRememberBaiduCellAnchor('owner:anchor', 3001, 49999, 1001), true)
  assert.equal(xDriveRememberBaiduCellAnchor('owner:anchor', -1, 3, 1002), false)
  assert.equal(xDriveRememberBaiduCellAnchor('owner:anchor', 3, Number.NaN, 1002), false)
  assert.equal(xDriveRememberBaiduCellAnchor('owner:anchor', 3, 10000001, 1002), false)
  const snap = xDriveReadBaiduCellReturn('owner:anchor', 1003)
  assert.equal(snap.anchorNodeID, 3001)
  assert.equal(snap.anchorIndex, 49999)
  assert.equal(snap.selection.asset_id, 85)
  assert.equal(snap.selection.node_revision, 7)
  assert.equal(snap.sort.dir, 'desc')
  xDriveClearBaiduCellReturn('owner:anchor')
})

test('no invalid, cross-account, expired or over-capacity return snapshots', () => {
  assert.equal(xDriveRememberBaiduCellReturn('', fresh(), 0), false)
  assert.equal(xDriveRememberBaiduCellReturn('owner:bad', fresh({ ...cell(), node_revision: 0 }), 100), false)
  assert.equal(xDriveRememberBaiduCellReturn('owner:bad', fresh({
    ...cell(), bounds: { ...cell().bounds, coordinate_space: 'wgs84' },
  }), 100), false)
  assert.equal(xDriveRememberBaiduCellReturn('owner:bad', {
    ...fresh(), sort: { by: 'unknown', dir: 'desc' },
  }, 100), false)
  assert.equal(xDriveRememberBaiduCellReturn('owner:bad', fresh(), -1), false)
  assert.equal(xDriveRememberBaiduCellReturn('owner:ttl', fresh(), 200), true)
  assert.ok(xDriveReadBaiduCellReturn('owner:ttl', 200 + XDRIVE_BAIDU_CELL_RETURN_TTL_MS - 1))
  assert.equal(xDriveReadBaiduCellReturn('owner:ttl', 200 + XDRIVE_BAIDU_CELL_RETURN_TTL_MS), undefined)
  for (let i = 0; i < 9; i++) {
    assert.equal(xDriveRememberBaiduCellReturn('bounded:' + i, fresh(), 1000), true)
  }
  assert.equal(xDriveReadBaiduCellReturn('bounded:0', 1001), undefined)
  assert.ok(xDriveReadBaiduCellReturn('bounded:8', 1001))
  for (let i = 0; i < 9; i++) xDriveClearBaiduCellReturn('bounded:' + i)
})

test('previously selected Cell highlights ONLY the same fresh Server Cell', () => {
  const selected = cell()
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(selected, cell()), true)
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(selected, {
    ...cell(), node_revision: 8,
  }), false)
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(selected, {
    ...cell(), photo_count: 32,
  }), false)
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(selected, {
    ...cell(), bounds: { ...cell().bounds, west: 100.0001 },
  }), false)
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(selected, null), false)
  assert.equal(xDriveBaiduCellReturnMatchesFreshSelection(undefined, cell()), false)
})

test('original shared mounted map wires selection only after Owner Range success', () => {
  const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const photoSurface = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx'), 'utf8')
  const map = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'), 'utf8')
  assert.match(gallery, /xDriveRememberBaiduCellReturn\(preferenceScope/)
  assert.match(gallery, /xDriveRememberBaiduCellAnchor\(preferenceScope/)
  const verifiedRange = gallery.indexOf('if (range.offset !== 0 || range.limit !== pageSize')
  const remembered = gallery.indexOf('xDriveRememberBaiduCellReturn(preferenceScope')
  assert.ok(verifiedRange >= 0 && remembered > verifiedRange)
  assert.match(gallery, /selectedBaiduNativeCell=\{selectedBaiduCell\}/)
  assert.match(map, /selectedCell=\{selectedNativeCell\}/)
  assert.match(photoSurface, /xDriveSelectBaiduNativeCell\(frame.page, frame.bounds/)
  assert.match(photoSurface, /xDriveBaiduCellReturnMatchesFreshSelection/)
  assert.match(photoSurface, /aria-pressed=\{isSelected/)
})
