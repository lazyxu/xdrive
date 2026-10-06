const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function loadTypeScriptModule(filename, dependencies = {}) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => dependencies[request] ?? require(request)
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const gridFilename = path.join(
  repo,
  'ui',
  'shared',
  'src',
  'mui',
  'MediaGalleryVirtualGrid.ts',
)
const timelineFilename = path.join(
  repo,
  'ui',
  'shared',
  'src',
  'mui',
  'MediaGalleryVirtualTimeline.ts',
)
const grid = loadTypeScriptModule(gridFilename)
const timeline = loadTypeScriptModule(timelineFilename, {
  './MediaGalleryVirtualGrid': grid,
})

const {
  xDriveMediaGalleryTimelineGroupLabel,
  xDriveMediaGalleryTimelineLayout,
  xDriveMediaGalleryTimelineWindow,
  xDriveMediaGalleryTimelineIndexVisible,
} = timeline

test('Gallery Timeline lays out month groups without materializing logical items', () => {
  const groups = []
  let startIndex = 0
  for (let index = 0; index < 1_200; index += 1) {
    const itemCount = index === 1_199 ? 79 : 83
    groups.push({
      key: `group-${String(index).padStart(4, '0')}`,
      item_count: itemCount,
      start_index: startIndex,
    })
    startIndex += itemCount
  }

  const layout = xDriveMediaGalleryTimelineLayout({
    width: 1_280,
    groups,
  })
  const visibleTop = layout.totalHeight * 0.5
  const window = xDriveMediaGalleryTimelineWindow({
    layout,
    visibleTop,
    visibleBottom: visibleTop + 900,
  })

  assert.equal(layout.groups.length, groups.length)
  assert.ok(layout.totalHeight > 1_000_000)
  assert.ok(window.segments.length > 0)
  assert.ok(window.segments.length < 10)
  assert.ok(window.startIndex > 0)
  assert.ok(window.endIndex < startIndex)
  assert.ok(
    window.endIndex - window.startIndex < 1_000,
    `retained logical range must stay bounded, got ${window.endIndex - window.startIndex}`,
  )
})

test('Gallery Timeline preserves group logical indexes across row boundaries', () => {
  const groups = [
    { key: '2026-10', item_count: 8, start_index: 0 },
    { key: '2026-09', item_count: 5, start_index: 8 },
    { key: 'unknown', item_count: 2, start_index: 13 },
  ]
  const layout = xDriveMediaGalleryTimelineLayout({
    width: 640,
    groups,
  })
  assert.equal(layout.columns, 4)
  assert.equal(layout.groups[0].rowCount, 2)
  assert.equal(layout.groups[1].startIndex, 8)
  assert.equal(layout.groups[2].startIndex, 13)

  const second = layout.groups[1]
  const window = xDriveMediaGalleryTimelineWindow({
    layout,
    visibleTop: second.itemsTop,
    visibleBottom: second.itemsTop + layout.rowStep,
    overscanRows: 0,
  })
  assert.equal(window.startIndex, 8)
  assert.equal(window.endIndex, 12)
  assert.equal(window.segments.length, 1)
  assert.equal(window.segments[0].groupIndex, 1)
  assert.equal(xDriveMediaGalleryTimelineIndexVisible(8, window), true)
  assert.equal(xDriveMediaGalleryTimelineIndexVisible(12, window), false)
})

test('Gallery Timeline labels canonical month keys and unknown dates', () => {
  assert.equal(xDriveMediaGalleryTimelineGroupLabel('2026-10'), '2026年10月')
  assert.equal(xDriveMediaGalleryTimelineGroupLabel('2026-01'), '2026年1月')
  assert.equal(xDriveMediaGalleryTimelineGroupLabel('unknown'), '日期未知')
})
