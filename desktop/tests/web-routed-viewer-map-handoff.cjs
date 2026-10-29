'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const repo=path.resolve(__dirname,'../..')
const cache=new Map()
function load(relative){
  const filename=path.resolve(repo,relative)
  if(cache.has(filename))return cache.get(filename).exports
  const source=fs.readFileSync(filename,'utf8')
  const compiled=ts.transpileModule(source,{fileName:filename,
    reportDiagnostics:true,compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    }})
  assert.deepEqual((compiled.diagnostics||[]).filter(
    x=>x.category===ts.DiagnosticCategory.Error),[])
  const mod={exports:{}}
  cache.set(filename,mod)
  new Function('exports','module','require',compiled.outputText)(
    mod.exports,mod,name=>{
      if(!name.startsWith('.'))return require(name)
      return load(path.relative(repo,path.resolve(
        path.dirname(filename),name+'.ts')))
    })
  return mod.exports
}
const {xDriveRoutedViewerMapEntry: mapEntry}=load(
  'web/src/routedViewerMapEntry.ts')
const {xDrivePlacesMapScopeHandoffURL: handoffURL}=load(
  'ui/shared/src/media-gallery-places-map-mode.ts')

const context=(target,extra={})=>({kind:'gallery',
  activeIndex:0,totalCount:9,target,...extra})
const all={kind:'all',query:{sort_by:'captured',sort_dir:'desc'}}
const current={kind:'album',id:'manual:Family',query:{
  sort_by:'captured',sort_dir:'desc',favorite:true,
}}

test('a routed Viewer inherits the exact approved Album/favorite map scope',()=>{
  assert.deepEqual(mapEntry(context(current)),{
    albumKey:'manual:Family',filters:{
      sort_by:'captured',sort_dir:'desc',favorite:true,
    },
  })
  assert.deepEqual(mapEntry(context(all)),{
    albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'},
  })
  assert.deepEqual(mapEntry(context({
    kind:'all',query:{sort_by:'added',sort_dir:'asc',favorite:true,
      captured_from:'2026-10-01',captured_to:'2026-10-29',time_zone:'Asia/Tokyo'},
  })),{albumKey:'',filters:{sort_by:'added',sort_dir:'asc',
    favorite:true,captured_from:'2026-10-01',captured_to:'2026-10-29',
    time_zone:'Asia/Tokyo'},
  })
})

test('signed Cell/Viewport context cannot widen to its whole Album or Library',()=>{
  // An Owner-signed Cell selects only nine photos out of an album. A normal
  // Album map handoff would drop that spatial constraint, so deny it.
  const cell={
    kind:'baidu-cell',id:'manual:Family',baiduCell:{
      cell_x:3,cell_y:2,asset_id:7,node_id:42,node_revision:1,
      photo_count:9,bounds:{coordinate_space:'bd09ll',west:100,
        south:0,east:120,north:20},
    },query:{sort_by:'captured',sort_dir:'desc',favorite:true,
      fold_duplicates:false},
  }
  assert.equal(mapEntry(context(cell)),null)
  const viewport={
    kind:'baidu-viewport',id:'manual:Family',
    baiduViewport:{coordinate_space:'bd09ll',west:100,
      south:0,east:120,north:20},
    query:{sort_by:'captured',sort_dir:'desc',favorite:true},
  }
  assert.equal(mapEntry(context(viewport)),null)
  assert.equal(mapEntry(context({...cell,id:undefined})),null)
  assert.equal(mapEntry(context({...viewport,id:undefined})),null)
})

test('File, Search, stale and unrepresentable Viewer contexts fail closed',()=>{
  for(const candidate of [
    null,undefined,{}, {kind:'directory',directoryID:3,activeIndex:0},
    {kind:'selection',nodeIDs:[42],activeIndex:0},
    {kind:'search',query:'photo',activeIndex:0},
    context({kind:'person',id:'person:1',query:{}}),
    context({kind:'memory',id:'memory:1',query:{}}),
    context({kind:'trash',query:{}}),
    context({kind:'pet',id:'cat',query:{}}),
    context({...all,id:'manual:Family'}),
    context({kind:'album',query:{}}),
    context({kind:'baidu-cell',query:{}}),
    context({kind:'baidu-viewport',query:{}}),
    context({kind:'all',query:{search:'secret'} }),
    context({kind:'all',query:{sort_by:'unknown'} }),
    context({kind:'all',query:{sort_dir:'wrong'} }),
    context({kind:'all',query:{fold_duplicates:true} }),
    context({kind:'all',query:{folder_id:45} }),
    context({kind:'all',query:{owner_id:99} }),
    context({kind:'all',query:{kind:'RAW'} }),
    context(all,{activeIndex:-1}),
    context(all,{activeIndex:9}),
    context(all,{totalCount:0}),
  ]){
    assert.equal(mapEntry(candidate),null,
      'unverified Viewer context must not widen to full-library map')
  }
})

test('only an opaque Server-issued same-origin HTTPS ticket enters map URL',()=>{
  const ticket='a'.repeat(64)
  const url=handoffURL('https://gallery.example.invalid/?filter=none#media-viewer/42',
    'isolated',ticket)
  assert.ok(url)
  const parsed=new URL(url)
  assert.equal(parsed.origin,'https://gallery.example.invalid')
  assert.equal(parsed.searchParams.get('places_map_handoff'),ticket)
  assert.equal(parsed.searchParams.get('places_map_scope_required'),'1')
  assert.equal(parsed.searchParams.get('places_map_mode'),'isolated')
  assert.equal(parsed.searchParams.has('owner_id'),false)
  assert.equal(parsed.searchParams.has('album'),false)
  assert.equal(parsed.searchParams.has('latitude'),false)
  assert.equal(handoffURL('http://gallery.example.invalid/#media-viewer/42',
    'prototype',ticket),null)
  assert.equal(handoffURL('https://gallery.example.invalid/','prototype',
    'not-a-ticket'),null)
})

test('actual routed Viewer must use Server handoff and deny unscope hash navigation',()=>{
  const app=fs.readFileSync(path.join(repo,'web/src/WebFileViewerApps.tsx'),'utf8')
  const start=app.indexOf('function WebMediaViewerApp(')
  const end=app.indexOf('function WebSinglePreviewApp(',start)
  const chunk=end>start ? app.slice(start,end) : app.slice(start)
  assert.match(chunk,/xDriveRoutedViewerMapEntry\(/)
  assert.match(chunk,/xDriveResolveBaiduOwnerPhotoFocusCamera\(/)
  assert.match(chunk,/mediaBaiduNativePhotoFocus\(/)
  assert.match(chunk,/mediaBaiduMapScopeHandoffIssue\(/)
  assert.match(chunk,/xDrivePlacesMapScopeHandoffURL\(/)
  assert.match(chunk,/window\.location\.assign\(/)
  assert.doesNotMatch(chunk,/window\.location\.hash\s*=\s*xDriveWebAppHash\(/)
})
