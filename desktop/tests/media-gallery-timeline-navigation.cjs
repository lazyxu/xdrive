const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryTimelineNavigation.ts')
const source = fs.readFileSync(filename, 'utf8')
const js = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', js)(mod.exports, mod, require)
const { xDriveMediaGalleryTimelineGroupAtIndex: at, xDriveMediaGalleryTimelineNearestDay: nearest } = mod.exports

const descending = [
  { key: '2026-10-09', start_index: 0, item_count: 10 },
  { key: '2026-10-06', start_index: 10, item_count: 4 },
  { key: '2026-09-30', start_index: 14, item_count: 2 },
  { key: 'unknown', start_index: 16, item_count: 1 },
]

test('M13 current date follows real logical index without loading a whole page', () => {
  assert.equal(at(descending, 0).key, '2026-10-09')
  assert.equal(at(descending, 9).key, '2026-10-09')
  assert.equal(at(descending, 10).key, '2026-10-06')
  assert.equal(at(descending, 15).key, '2026-09-30')
  assert.equal(at(descending, 16).key, 'unknown')
  assert.equal(at(descending, 17), null)
  assert.equal(at(descending, -1), null)
  assert.equal(at(descending, NaN), null)
})

test('M13 date picker jumps to an indexed date or truthful nearest date without timezone guessing', () => {
  assert.deepEqual(nearest(descending, '2026-10-06'), { group: descending[1], exact: true })
  assert.deepEqual(nearest(descending, '2026-10-07'), { group: descending[1], exact: false })
  assert.deepEqual(nearest(descending, '2026-10-08'), { group: descending[0], exact: false })
  assert.deepEqual(nearest(descending, '2026-10-01'), { group: descending[2], exact: false })
  assert.deepEqual(nearest(descending, '2026-09-01'), { group: descending[2], exact: false })
  assert.equal(nearest(descending, '2026-02-30'), null)
  assert.equal(nearest(descending, '2026-10'), null)
  assert.equal(nearest([{ key: 'unknown', start_index: 0, item_count: 3 }], '2026-10-09'), null)
  assert.equal(nearest([], '2026-10-09'), null)
})

test('M13 respects ascending chronological group order and deterministic older-day ties', () => {
  const ascending = [...descending.slice(0, 3)].reverse().map((group, index) => ({
    ...group, start_index: index * 5, item_count: 5,
  }))
  assert.equal(nearest(ascending, '2026-10-06').group.key, '2026-10-06')
  assert.equal(nearest(ascending, '2026-10-04').group.key, '2026-10-06')
  const tie = [
    { key: '2026-10-10', start_index: 0, item_count: 1 },
    { key: '2026-10-08', start_index: 1, item_count: 1 },
  ]
  assert.equal(nearest(tie, '2026-10-09').group.key, '2026-10-08')
})

test('M13 deep 100k index/date lookup remains logarithmic rather than scanning assets or groups', () => {
  const start = Date.UTC(1700, 0, 1)
  const groups = Array.from({ length: 100000 }, (_, index) => ({
    key: new Date(start + index * 86400000).toISOString().slice(0, 10),
    start_index: index,
    item_count: 1,
  }))
  let reads = 0
  const tracked = new Proxy(groups, {
    get(array, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1
      return Reflect.get(array, key, receiver)
    },
  })
  assert.equal(at(tracked, 90000).start_index, 90000)
  const target = groups[90000].key
  assert.equal(nearest(tracked, target).group.key, target)
  assert.ok(reads < 90, 'Deep 100k lookup must not read every group, actual reads=' + reads)
})

test('M13 shared Gallery controls expose accessible indexed date jump/current date/back anchor', () => {
  const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  for (const token of [
    'data-xdrive-gallery-timeline-day-jump',
    'data-xdrive-gallery-timeline-current-date',
    'data-xdrive-gallery-timeline-return',
    'xDriveMediaGalleryTimelineNearestDay(',
    'xDriveMediaGalleryTimelineGroupAtIndex(',
    'viewAnchorIndexRef.current',
    'restoreAnchorRevision={viewAnchorRevision}',
  ]) {
    assert.ok(gallery.includes(token), 'Missing M13 UI/anchor contract: ' + token)
  }
  assert.match(gallery, /aria-label="跳转日期"/)
  assert.match(gallery, /type="date"/)
  assert.match(gallery, /setTimelineReturnAnchor\(/)
  assert.match(gallery, /const timelineNavigationGroups = useMemo/)
  assert.match(gallery, /item_count: group\.items\.length/)
})
