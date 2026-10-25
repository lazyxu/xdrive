'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const shared = {
  xDriveClassifyFilePreview: ({name,kind}) =>
    kind === 'file' && /\.(jpg|jpeg|png|heic|mov|mp4)$/i.test(name) ? 'image' : 'none',
  xDriveParseWebAppHash: () => null,
  xDriveWebAppHash: () => '#/app/overview',
  xDriveWebAppViewer: () => false,
}

function load(rel, inject = {}) {
  const file = path.join(root,rel)
  const result = ts.transpileModule(fs.readFileSync(file,'utf8'), {
    fileName:file,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  })
  const errors = (result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
  const mod = {exports:{}}
  new Function('module','exports','require',result.outputText)(mod,mod.exports,(name)=>{
    if(Object.hasOwn(inject,name))return inject[name]
    if(name==='react')return React
    if(name==='../../ui/shared/src')return shared
    throw Error('Unexpected module '+name+' in '+rel)
  })
  return mod.exports
}
const node = (id,revision=2) => ({
  id,revision,name:id+'.jpg',type:'file',size:12,created_at:'',updated_at:'',
})
const photo = (id,revision=2) => ({node:node(id,revision),metadata:{mime_type:'image/jpeg'},favorite:false})
const bounds = {coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
const cell = {bounds,cell_x:1,cell_y:2,asset_id:5,node_id:10,node_revision:2,photo_count:2}
const privateContext = (kind='baidu-cell') => ({
  kind:'gallery',target:kind==='baidu-cell'
    ? {kind,baiduCell:cell,query:{sort_by:'captured',sort_dir:'desc'}}
    : {kind,baiduViewport:bounds,query:{sort_by:'captured',sort_dir:'desc'}},
  activeIndex:0,totalCount:2,
})
const sessionMod=load('web/src/webViewerContext.ts')

test('private map Cell revocation never falls back to unscoped Node or MediaItem',async()=>{
  const calls = {cell:0,point:0,ordinary:0}
  let revoked=false
  const api = {
    node:async(id)=>{calls.point++;return node(id)},
    mediaItem:async(id)=>{calls.point++;return photo(id)},
  }
  const source = {
    listItemRange:async()=>{calls.ordinary++;throw Error('unscoped source forbidden')},
    listBaiduNativeCellItems:async(_selection,_limit,_offset,_sort,signal)=>{
      calls.cell++
      assert.ok(signal instanceof AbortSignal)
      if(revoked)throw Error('OWNER_SCOPE_REVOKED')
      return {total_count:2,items:[photo(10),photo(11)]}
    },
  }
  const viewer=sessionMod.createXDriveWebViewerSession(api,source,privateContext())
  assert.equal((await viewer.current(10,0,true)).mediaItem.node.id,10)
  assert.equal(calls.point,0)
  revoked=true
  viewer.invalidate(10)
  await assert.rejects(viewer.current(10,0,true),/OWNER_SCOPE_REVOKED/)
  assert.equal(calls.cell,2)
  assert.equal(calls.point,0,'revoked signed range must not create point reads')
  assert.equal(calls.ordinary,0,'must not broaden to full Gallery')
  viewer.dispose()
})

test('map Cell identity/revision/count mismatch fails closed while ordinary direct links still work',async()=>{
  let pointCalls=0
  const api={node:async id=>{pointCalls++;return node(id)},
    mediaItem:async id=>{pointCalls++;return photo(id)}}
  for(const range of [
    {total_count:2,items:[photo(99),photo(11)]},
    {total_count:2,items:[photo(10,4),photo(11)]},
    {total_count:1,items:[photo(10)]},
  ]){
    const reader=sessionMod.createXDriveWebViewerSession(api,{
      listBaiduNativeCellItems:async()=>range,
      listItemRange:async()=>{throw Error('unscoped forbidden')},
    },privateContext())
    // Explicit expected source revision is required for a changed Node.
    await assert.rejects(reader.current(10,0,true,node(10,2)),/地图照片范围已变化/)
    reader.dispose()
  }
  assert.equal(pointCalls,0)
  const direct=sessionMod.createXDriveWebViewerSession(api,{},null)
  assert.equal((await direct.current(10,0,true)).mediaItem.node.id,10)
  assert.equal(pointCalls,1,'no-context direct media is still supported')
  direct.dispose()
})

test('private map viewport failure also cannot fall back to independent media bytes',async()=>{
  let pointCalls=0
  const api={node:async id=>{pointCalls++;return node(id)},
    mediaItem:async id=>{pointCalls++;return photo(id)}}
  const reader=sessionMod.createXDriveWebViewerSession(api,{
    listBaiduNativeViewportItems:async()=>{throw Error('VIEWPORT_CONSENT_REVOKED')},
    listItemRange:async()=>{throw Error('unscoped forbidden')},
  },privateContext('baidu-viewport'))
  await assert.rejects(reader.current(10,0,true),/VIEWPORT_CONSENT_REVOKED/)
  assert.equal(pointCalls,0)
  reader.dispose()
})

test('map Cell and viewport Viewer reject changed opening counts without point fallback',async()=>{
  const calls={scoped:0,point:0,ordinary:0}
  const api={
    node:async id=>{calls.point++;return node(id)},
    mediaItem:async id=>{calls.point++;return photo(id)},
  }
  const source={
    listBaiduNativeCellItems:async()=>{
      calls.scoped++
      return {total_count:2,items:[photo(10),photo(11)]}
    },
    listBaiduNativeViewportItems:async()=>{
      calls.scoped++
      return {total_count:3,items:[photo(10),photo(11),photo(12)]}
    },
    listItemRange:async()=>{
      calls.ordinary++
      throw Error('unscoped Gallery forbidden')
    },
  }
  for(const context of [
    privateContext('baidu-viewport'), // Opened with 2, fresh signed page has 3.
    {...privateContext('baidu-cell'),totalCount:3}, // Cell says 2, route says 3.
  ]){
    const reader=sessionMod.createXDriveWebViewerSession(api,source,context)
    // All three entry points must reject the drift, including metadata
    // exposed in the Viewer filmstrip and previous/next navigation.
    await assert.rejects(reader.candidateAt(0),/地图照片范围已变化/)
    await assert.rejects(reader.neighbor(0,1,()=>true),/地图照片范围已变化/)
    await assert.rejects(reader.current(10,0,true),/地图照片范围已变化/)
    reader.dispose()
  }
  assert.deepEqual(calls,{scoped:6,point:0,ordinary:0})
  // Unchanged signed scope still opens the original Owner media normally.
  const allowed=sessionMod.createXDriveWebViewerSession(api,{
    ...source,
    listBaiduNativeViewportItems:async()=>{
      calls.scoped++
      return {total_count:2,items:[photo(10),photo(11)]}
    },
  },privateContext('baidu-viewport'))
  assert.equal((await allowed.candidateAt(0)).node.id,10)
  assert.equal((await allowed.neighbor(0,1,()=>true)).node.id,11)
  assert.equal((await allowed.current(10,0,true)).mediaItem.node.id,10)
  assert.equal(calls.scoped,7,'unchanged Owner viewport reuses its bounded signed page')
  assert.equal(calls.point,0)
  allowed.dispose()
})

test('a private map Viewer hash loses volatile context on reload without Storage leakage',()=>{
  const original=global.window, stored=new Map()
  global.window={sessionStorage:{
    getItem:k=>stored.get(k)??null,
    setItem:(k,v)=>stored.set(k,v),
    removeItem:k=>stored.delete(k),
  }}
  try{
    const runtime=load('web/src/webAppRuntime.ts')
    const id=runtime.xDriveCreateWebAppBrowseSession(privateContext())
    assert.match(id,/^map-[a-z0-9-]+$/)
    assert.equal(stored.size,0)
    assert.equal(runtime.xDriveReadWebAppBrowseSession(id).target.kind,'baidu-cell')
    const restarted=load('web/src/webAppRuntime.ts')
    assert.equal(restarted.xDriveIsPrivateMapBrowseSessionID(id),true)
    assert.equal(restarted.xDriveReadWebAppBrowseSession(id),null)
    stored.set('xdrive.web_app.session.v1:'+id,JSON.stringify({
      version:1,context:{kind:'gallery',target:{kind:'all',query:{}},totalCount:99,activeIndex:0},
    }))
    assert.equal(restarted.xDriveReadWebAppBrowseSession(id),null)
    assert.equal(stored.has('xdrive.web_app.session.v1:'+id),false)
    const ordinary={kind:'gallery',target:{kind:'all',query:{}},totalCount:2,activeIndex:0}
    const ordinaryID=runtime.xDriveCreateWebAppBrowseSession(ordinary)
    assert.equal(ordinaryID.startsWith('map-'),false)
    assert.equal(restarted.xDriveReadWebAppBrowseSession(ordinaryID).target.kind,'all')
  }finally{global.window=original}
})

test('hard-refresh private map Viewer renders denied state without point fetch',async()=>{
  const original=global.window, stored=new Map()
  global.window={sessionStorage:{
    getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),
    removeItem:k=>stored.delete(k),
  }}
  let renderer
  try{
    const previousRuntime=load('web/src/webAppRuntime.ts')
    const id=previousRuntime.xDriveCreateWebAppBrowseSession(privateContext())
    const restarted=load('web/src/webAppRuntime.ts')
    const hook=load('web/src/useWebViewerNode.ts',{
      './webAppRuntime':restarted,
      './webViewerContext':sessionMod,
    })
    const calls={point:0,range:0}
    const api={
      node:async id=>{calls.point++;return node(id)},
      mediaItem:async id=>{calls.point++;return photo(id)},
    }
    const source={listItemRange:async()=>{calls.range++;return {
      total_count:1,items:[photo(10)]}}}
    let value
    function Probe({contextID}){
      value=hook.useViewerNode({api,gallerySource:source,nodeID:10,contextID,
        predicate:sessionMod.xDriveWebViewerMediaFile,wantsMedia:true,onNavigate() {}})
      return null
    }
    await act(async()=>{renderer=create(React.createElement(Probe,{contextID:id}))})
    assert.equal(value.loading,false)
    assert.equal(value.node,null)
    assert.match(value.error,/地图照片范围已失效/)
    assert.deepEqual(calls,{point:0,range:0})
    // Historical map Viewer routes were issued before the opaque map- marker
    // existed. Missing legacy context must also fail closed on hard refresh.
    await act(async()=>renderer.update(React.createElement(Probe,{contextID:'legacy-map-context'})))
    assert.equal(value.node,null)
    assert.match(value.error,/浏览范围已失效/)
    assert.deepEqual(calls,{point:0,range:0})
    await act(async()=>renderer.update(React.createElement(Probe,{contextID:undefined})))
    assert.equal(value.error,'')
    assert.equal(value.node.id,10,'plain direct link keeps point-file compatibility')
    assert.equal(calls.point,1)
  }finally{
    if(renderer)await act(async()=>renderer.unmount())
    global.window=original
  }
})

test('invalid private map marker blocks filmstrip prefetch and every unscoped Owner read',async()=>{
  // This covers the impossible-to-trust memory/History mismatch, not a normal
  // public Gallery context. A denied current item must not leave filmstrip
  // prefetch running with a broad library target.
  const ordinary={kind:'gallery',activeIndex:0,totalCount:2,
    target:{kind:'library',query:{sort_by:'captured',sort_dir:'desc'}}}
  const fakeRuntime={
    xDriveIsPrivateMapBrowseSessionID:id=>typeof id==='string'&&id.startsWith('map-'),
    xDriveReadWebAppBrowseSession:id=>id==='map-invalid-context'?ordinary:null,
    xDriveWriteWebAppBrowseSession(){assert.fail('invalid private session cannot be persisted')},
  }
  const hook=load('web/src/useWebViewerNode.ts',{
    './webAppRuntime':fakeRuntime,'./webViewerContext':sessionMod,
  })
  const calls={gallery:0,node:0,media:0}
  const api={
    node:async id=>{calls.node++;return node(id)},
    mediaItem:async id=>{calls.media++;return photo(id)},
  }
  const source={listItemRange:async()=>{
    calls.gallery++
    return {total_count:2,items:[photo(10),photo(11)]}
  }}
  let renderer,value
  function Probe(){
    value=hook.useViewerNode({api,gallerySource:source,nodeID:10,
      contextID:'map-invalid-context',predicate:sessionMod.xDriveWebViewerMediaFile,
      wantsMedia:true,onNavigate(){assert.fail('must not navigate')}})
    return null
  }
  try{
    await act(async()=>{renderer=create(React.createElement(Probe))})
    assert.equal(value.loading,false)
    assert.equal(value.node,null)
    assert.equal(value.totalCount,0)
    assert.equal(value.filmstripEntries.length,0)
    assert.equal(value.navigationLoading,false)
    assert.match(value.error,/地图照片范围已失效/)
    assert.deepEqual(calls,{gallery:0,node:0,media:0},
      'invalid map scope cannot prefetch via filmstrip or point fallback')
  }finally{if(renderer)await act(async()=>renderer.unmount())}
})
