'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
function loadOriginal(relative, dependencies) {
  const filename = path.join(root,relative)
  const js = ts.transpileModule(read(relative),{fileName:filename,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
  }}).outputText
  const mod = new Module(filename,module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root,'desktop'))
  const original = mod.require.bind(mod)
  mod.require = key => Object.hasOwn(dependencies,key) ? dependencies[key] : original(key)
  mod._compile(js,filename)
  return mod.exports
}
const mui = Object.fromEntries(
  ['Box','Button','Chip','Paper','Stack','Typography'].map(k=>[k,k.toLowerCase()]))
const icons = new Proxy({},{get:(_,key)=>key==='__esModule'?false:'icon'})
const shared = {
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/material':mui,'@mui/icons-material':icons,
  './MediaGalleryCoverThumbnail':{XDriveMediaGalleryCoverThumbnail:'thumbnail'},
}
const Memories=loadOriginal('ui/shared/src/mui/MediaGalleryMemories.tsx',shared)
  .XDriveMediaGalleryMemories
const Cleanup=loadOriginal('ui/shared/src/mui/MediaGalleryCleanup.tsx',{
  ...shared,
  '../format':{formatBytes:()=> '0 B'},
  './MediaGalleryCleanupIndexStatus':{XDriveMediaGalleryCleanupIndexStatus:'index-status'},
  './useDeferredLoading':{useXDriveDeferredPendingLoading:()=>false},
}).XDriveMediaGalleryCleanup
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const textOf=value=>{
  if(value==null||typeof value==='boolean')return ''
  if(Array.isArray(value))return value.map(textOf).join('')
  if(typeof value==='string'||typeof value==='number')return String(value)
  return textOf(value.props?.children)
}
function hasText(view,text) {
  return view.root.findAll(n=>n.type==='typography'&&textOf(n.props.children)===text).length>0
}
function slot(view,id){
  const found=view.root.findAll(n=>Object.hasOwn(n.props,id))
  assert.equal(found.length,1,'expected one true P73 first-read slot')
  return found[0]
}
async function mounted(Component,base,verify){
  let view
  try{
    await act(async()=>{view=Renderer.create(React.createElement(Component,base))})
    const update=async next=>{await act(async()=>{
      view.update(React.createElement(Component,{...base,...next}))
    })}
    await verify(view,update)
  }finally{
    if(view)await act(async()=>{view.unmount()})
  }
}
test('P73 mounted Memories: unrequested false Loading never flashes false empty; accepted zero only after receipt',async()=>{
  let retries=0
  const props={memories:[],loading:false,readState:'unverified',
    onRetry:()=>{retries++},loadThumbnail:async()=>null}
  await mounted(Memories,props,async(view,update)=>{
    const id='data-xdrive-gallery-memories-first-read'
    assert.equal(slot(view,id).props['aria-busy'],true)
    assert.equal(slot(view,id).props.sx.minHeight,180)
    assert.equal(hasText(view,'还没有可生成的回忆'),false)
    await update({loading:true,readState:'unverified'})
    await act(async()=>{await sleep(365)})
    assert.equal(slot(view,id).props['aria-busy'],true)
    assert.equal(view.root.findAll(n=>n.type==='circularprogress').length,0)
    assert.equal(hasText(view,'还没有可生成的回忆'),false)
    await update({loading:false,readState:'error'})
    assert.equal(slot(view,id).props['aria-busy'],undefined)
    assert.equal(hasText(view,'回忆索引读取失败，请重试。'),true)
    const retry=view.root.findAll(n=>n.type==='button'&&n.props.children==='重试')[0]
    assert.ok(retry)
    await act(async()=>{retry.props.onClick()})
    assert.equal(retries,1)
    await update({loading:false,readState:'ready'})
    assert.equal(hasText(view,'还没有可生成的回忆'),true)
    assert.equal(view.root.findAll(n=>Object.hasOwn(n.props,id)).length,0)
    await update({loading:true,readState:'ready'})
    assert.equal(hasText(view,'还没有可生成的回忆'),true,
      'verified empty is content and remains throughout a refresh')
  })
})
test('P73 mounted Cleanup: unrequested null never invents failure; error retry and canonical zero remain',async()=>{
  let retries=0
  const props={bursts:null,readState:'unverified',loading:false,
    loadThumbnail:async()=>null,onRefresh:()=>{retries++}}
  await mounted(Cleanup,props,async(view,update)=>{
    const id='data-xdrive-gallery-cleanup-first-read'
    assert.equal(slot(view,id).props['aria-busy'],true)
    assert.equal(slot(view,id).props.sx.minHeight,180)
    assert.equal(hasText(view,'连拍清理结果尚未确认，请重新检查。'),false)
    await update({loading:true,readState:'unverified'})
    await act(async()=>{await sleep(365)})
    assert.equal(slot(view,id).props['aria-busy'],true)
    assert.equal(hasText(view,'连拍清理结果尚未确认，请重新检查。'),false)
    await update({loading:false,readState:'error'})
    assert.equal(slot(view,id).props['aria-busy'],undefined)
    assert.equal(hasText(view,'连拍清理结果尚未确认，请重新检查。'),true)
    const retry=view.root.findAll(n=>n.type==='button'&&n.props.children==='重新检查')[0]
    assert.ok(retry)
    await act(async()=>{retry.props.onClick()})
    assert.equal(retries,1)
    await update({loading:false,readState:'ready',
      bursts:{groups:[],total_groups:0,total_items:0,potential_cleanup_bytes:0,physical_reclaimable_bytes:0}})
    assert.equal(hasText(view,'当前已索引素材暂时没有连拍清理建议'),true)
  })
})
test('P73 original Gallery Page binds Owner+source accepted receipts, never a false cold zero or index spinner',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  for(const token of [
    'memoryIndexReceipt?.owner === preferenceScope',
    'memoryIndexReceipt.dataSource === source',
    'cleanupIndexReceipt?.owner === preferenceScope',
    'cleanupIndexReceipt.dataSource === source',
    "state: 'ready' })",
    "state: 'error' })",
    "memories={memoriesReadState === 'ready' ? memories : []}",
    "burstReviews={cleanupReadState === 'ready' ? burstReviews : null}",
    'setMemoryIndexReceipt(null)',
    'setCleanupIndexReceipt(null)',
    'setCleanupIndexReceipt({ owner: preferenceScope, dataSource: source, state: \'ready\' })',
    'readState={memoriesReadState}',
    'readState={cleanupReadState}',
    'const request = ++requestID.current',
    'if (request !== requestID.current) return',
    'data-xdrive-gallery-unverified-facet-index',
    'data-xdrive-gallery-places-first-read',
    'showDelayedPlacesPage',
    'XDriveMediaAsyncThumbnail',
    'XDriveMediaAsyncVideoPoster',
  ])assert.ok(gallery.includes(token),token)
  assert.equal(gallery.includes('showDelayedPlacesInitial'),false)
  assert.equal(gallery.includes('showDelayedColdFacetRead'),false)
  assert.equal(gallery.includes('正在读取人物…'),false)
  assert.equal(gallery.includes('正在加载地点…'),false)
})
