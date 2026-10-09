const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const source = read('ui/shared/src/mui/MediaGalleryTimelineNavigation.ts')
const code = ts.transpileModule(source,{
  fileName: 'MediaGalleryTimelineNavigation.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiled = { exports: {} }
new Function('exports', 'require', code)(compiled.exports, () => { throw Error('unexpected runtime import') })
const navigation = compiled.exports

test('mobile ascending unknown-date group is first and day jump finds nearest valid indexed date', () => {
  const rows = [
    {key:'unknown',start_index:0,item_count:2},
    {key:'2025-03-02',start_index:2,item_count:4},
    {key:'2026-04-03',start_index:6,item_count:1},
  ]
  assert.equal(navigation.xDriveMediaGalleryTimelineGroupAtIndex(rows,0).key,'unknown')
  assert.equal(navigation.xDriveMediaGalleryTimelineGroupAtIndex(rows,6).key,'2026-04-03')
  const near = navigation.xDriveMediaGalleryTimelineNearestDay(rows,'2026-03-30')
  assert.deepEqual(near,{group:rows[2],exact:false})
  assert.equal(navigation.xDriveMediaGalleryTimelineNearestDay(
    [{key:'unknown',start_index:0,item_count:8}], '2026-04-01',
  ),null)
})

test('mobile sort key is separate and the server tail query is one ephemeral first-page request', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const web = read('web/src/api.ts')
  const models = read('ui/shared/src/models.ts')
  assert.match(gallery,/xdrive\.gallery\.mobile\.sort\.v1/)
  assert.match(gallery,/xdrive\.gallery\.sort\.v1/)
  assert.match(gallery,/mobile\s*\?\s*\{\s*by:\s*'captured',\s*dir:\s*'asc'\s*\}/)
  assert.match(gallery,/mobileGalleryViewport \? mobileGallerySort : desktopGallerySort/)
  assert.match(gallery,/firstAtLatest/)
  assert.match(gallery,/firstAtLatest \? 'latest' : undefined/)
  assert.match(gallery,/virtualCollection\.primePage\(/)
  assert.match(gallery,/sortAnchorRestoration/)
  assert.match(gallery,/mobileGalleryViewerReturns\.set/)
  assert.match(gallery,/mobileGalleryViewerReturns\.delete/)
  assert.ok(gallery.includes('mobileGalleryBrowsePositions.set('))
  assert.ok(gallery.includes('browsePosition.querySignature === mediaGalleryQuerySignature(scopedQuery)'))
  assert.ok(gallery.includes('onVisibleAnchorNode={rememberMobileGalleryAnchor}'))
  assert.ok(gallery.includes('onVisibleAnchorNode?.(visible.node.id)'))
  assert.match(web,/values\.set\('initial_position', query\.initial_position\)/)
  assert.match(web,/values\.set\('unknown_first', 'true'\)/)
  assert.match(models,/initial_position\?: 'latest'/)
  assert.doesNotMatch(gallery,/for \(let offset = 0; offset < .*100.?000/)
})
