'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const sessionPath = 'ui/shared/src/media-gallery-baidu-cell-return-session.ts'
const content = fs.readFileSync(path.join(root, sessionPath), 'utf8')
const js = ts.transpileModule(content, {
  fileName: sessionPath,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(js.diagnostics || [], [])
const m = new Module(sessionPath, module)
m.filename = path.join(root, sessionPath)
m.paths = module.paths
m._compile(js.outputText, m.filename)
const {
  XDRIVE_BAIDU_CELL_VIEWER_RETURN_TTL_MS: returnTTL,
  xDriveRememberBaiduCellReturn: remember,
  xDriveReadBaiduCellReturn: read,
  xDriveMarkBaiduCellViewerReturn: mark,
  xDriveTakeBaiduCellViewerReturn: take,
  xDriveClearBaiduCellViewerReturn: clearIntent,
  xDriveClearBaiduCellReturn: clear,
} = m.exports

const mk = () => ({
  selection: {
    bounds: { coordinate_space: 'bd09ll', west: 100, south: 20, east: 102, north: 22 },
    cell_x: 1, cell_y: 2, asset_id: 7, node_id: 12,
    node_revision: 9, photo_count: 40,
  },
  sort: { by: 'captured', dir: 'desc' },
})

test('W3b2b preserves only a one-shot, short-lived Owner viewer return intent', () => {
  assert.equal(returnTTL, 600_000)
  assert.equal(remember('viewer:a', mk(), 1_000), true)
  assert.equal(mark('viewer:a', 567, 87000, 1_001), true)
  assert.equal(take('viewer:b', 1_002), undefined)
  const saved = take('viewer:a', 1_002)
  assert.equal(saved.selection.node_revision, 9)
  assert.equal(saved.sort.by, 'captured')
  assert.equal(saved.anchorNodeID, 567)
  assert.equal(saved.anchorIndex, 87000)
  // No repeated restoration and no retained return flag after consumption.
  assert.equal(take('viewer:a', 1_003), undefined)
  assert.equal(read('viewer:a', 1_003).anchorNodeID, 567)
  clear('viewer:a')
})

test('W3b2b refuses missing or forged viewer anchors and expires just the intent', () => {
  assert.equal(mark('viewer:unknown', 24, 0, 10), false)
  assert.equal(remember('viewer:ttl', mk(), 5_000), true)
  assert.equal(mark('viewer:ttl', 0, 0, 5_001), false)
  assert.equal(mark('viewer:ttl', 24, -1, 5_001), false)
  assert.equal(mark('viewer:ttl', 24, 10000001, 5_001), false)
  assert.equal(mark('viewer:ttl', 24, 99, 5_001), true)
  // Refresh the independently valid visual hint halfway through the intent TTL.
  // This must NOT refresh the original one-shot Viewer return timestamp.
  const midway = 5_001 + Math.floor(returnTTL / 2)
  const visual = read('viewer:ttl', midway)
  assert.ok(visual)
  assert.equal(remember('viewer:ttl', visual, midway), true)
  // Consume for the first time after the original bounded Viewer intent lifetime.
  assert.equal(take('viewer:ttl', 5_001 + returnTTL), undefined)
  // TTL logic must not erase an otherwise valid Owner's *visual* hint.
  assert.ok(read('viewer:ttl', 5_001 + returnTTL))
  clear('viewer:ttl')
})

test('W3b2b explicit tab/back cancels return without broadening a Cell', () => {
  assert.equal(remember('viewer:cancel', mk(), 10), true)
  assert.equal(mark('viewer:cancel', 24, 4, 11), true)
  clearIntent('viewer:cancel')
  assert.equal(take('viewer:cancel', 12), undefined)
  assert.equal(read('viewer:cancel', 12).selection.asset_id, 7)
  clear('viewer:cancel')
})

test('W3b2b source reauthorizes signed Cell and Node before priming the wall', () => {
  const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const openAt = gallery.indexOf('const openBaiduNativeCell = useCallback')
  const endAt = gallery.indexOf('const nativePhotoOpenAbort', openAt)
  assert.ok(openAt >= 0 && endAt > openAt)
  const original = gallery.slice(openAt, endAt)
  assert.match(original, /returning\?\.anchorNodeID/)
  assert.match(original, /anchorNodeID: returning\.anchorNodeID/)
  assert.match(original, /source\.listBaiduNativeCellItems\(/)
  assert.match(original, /range\.anchor_index! < 0/)
  assert.match(original, /range\.anchor_index! >= range\.total_count/)
  assert.match(original, /setSortAnchorRestoration\(returning\?\.anchorNodeID/)
  assert.ok(original.indexOf('if (range.offset !== 0') < original.indexOf('if (returning?.anchorNodeID'))
  assert.ok(original.indexOf('if (returning?.anchorNodeID') < original.indexOf('setCollectionTarget(target)'))
  assert.ok(original.indexOf('source.listBaiduNativeCellItems(') <
    original.indexOf('virtualCollection.primePage('))
  assert.match(gallery, /xDriveMarkBaiduCellViewerReturn\(preferenceScope, item\.node\.id, activeIndex\)/)
  assert.match(gallery, /const previous = xDriveTakeBaiduCellViewerReturn\(preferenceScope\)/)
  assert.match(gallery, /openBaiduNativeCell\(previous\.selection, previous\)/)
  assert.match(gallery, /xDriveClearBaiduCellViewerReturn\(preferenceScope\)/)
  const server = fs.readFileSync(path.join(root, 'internal/api/baidu_photo_map_cell_range.go'), 'utf8')
  assert.match(server, /"sort_by", "sort_dir", "anchor_node_id"/)
  assert.match(server, /options\.BaiduCell = &selection/)
  // Inaccessible production security acceptance is skipped, but fail-closed
  // current-Owner/Consent/revision checks on Server remain mandatory.
})

test('W3b2b leaves original source physical privacy/Provider boundaries intact', () => {
  const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const session = fs.readFileSync(path.join(root, sessionPath), 'utf8')
  assert.doesNotMatch(session, /localStorage|sessionStorage|document\.cookie|window\.BMap/)
  assert.match(session, /not media authority/i)
  assert.match(gallery, /if \(!returning\) xDriveClearBaiduCellViewerReturn\(preferenceScope\)/)
})
