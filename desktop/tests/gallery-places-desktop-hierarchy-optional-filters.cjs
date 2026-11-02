'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const helper = 'ui/shared/src/media-gallery-places-hierarchy-query.ts'
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(root, helper), 'utf8'),
  { fileName: helper, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
)
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = {exports:{}}
new Function('module','exports',compiled.outputText)(mod,mod.exports)
const {xDrivePlacesHierarchyRequestFilters: clean} = mod.exports

test('hierarchy drops omitted map/location fields without mutating the gallery query', () => {
  const query = {sort_by:'captured', sort_dir:'desc', favorite:true,
    asset_kind:'image', time_zone:'Asia/Shanghai', has_location:false,
    place:'place:123:456', place_hierarchy:'country:CN',
    nearby:{latitude:30,longitude:120,radius_km:12},
    bbox:'not-forwarded', anchor_node_id:42, initial_position:'not-forwarded'}
  const copy=structuredClone(query)
  const result=clean(query)
  assert.deepEqual(query,copy,'do not mutate the original Gallery scope')
  assert.deepEqual(result,{sort_by:'captured',sort_dir:'desc',favorite:true,
    asset_kind:'image',time_zone:'Asia/Shanghai',has_location:true})
  for(const key of ['place','place_hierarchy','nearby','bbox',
    'anchor_node_id','initial_position'])
    assert.equal(Object.hasOwn(result,key),false,key+' is not an own IPC key')
  assert.deepEqual(clean(),{has_location:true})
})

test('Desktop hierarchy IPC removes only undefined keys before its strict allowlist',()=>{
  const main=fs.readFileSync(path.join(root,'desktop/src/main/index.cts'),'utf8')
  const hierarchy=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesHierarchy.tsx'),'utf8')
  assert.match(main,/Object\.entries\(filters as Record<string, unknown>\)/)
  assert.match(main,/\.filter\(\(\[, value\]\) => value !== undefined\)/)
  assert.match(main,/Object\.keys\(filter\)\.some\(key => !allowedFilters\.includes\(key\)\)/)
  assert.match(hierarchy,/xDrivePlacesHierarchyRequestFilters\(query\)/)
})

test('Desktop primary map always mounts interactive WGS84 fallback without provider SDK',()=>{
  const map=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')
  const branch=map.slice(map.indexOf('{desktopOnly ? ('),map.indexOf(') : !getBaiduJSAPI4Status'))
  assert.match(branch,/<XDriveMediaGalleryOwnerGPSOverview/)
  assert.match(branch,/listPage=\{listPlacesMapOverview\}/)
  assert.match(branch,/onOpenPlace=\{onOpenPlace\}/)
  assert.match(branch,/onOpenSecureDesktopMap\?\.\(mapPhotoScope\)/)
})
