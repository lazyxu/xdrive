'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('ui/shared/src/mui/ViewerForegroundPriority.ts')
const compile=(code,name)=>ts.transpileModule(code,{
  fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const mod={exports:{}}
new Function('exports','module',compile(source,'ViewerForegroundPriority.ts'))(mod.exports,mod)
const bus=mod.exports
function newScheduler(loader,options={}){
  const js=compile(read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts'),
    'MediaGalleryThumbnailScheduler.ts')
  const out={exports:{}}
  new Function('exports','module','require',js)(out.exports,out,
    name=>name==='./ViewerForegroundPriority'?bus:require(name))
  return new out.exports.XDriveMediaThumbnailScheduler(loader,options)
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
test('nested viewer leases do not prematurely restore disposable work',()=>{
  const states=[]
  const stop=bus.xDriveObserveViewerForeground(value=>states.push(value))
  const owner={},other={}
  const a=bus.xDriveAcquireViewerForeground(owner)
  const a2=bus.xDriveAcquireViewerForeground(owner)
  const b=bus.xDriveAcquireViewerForeground(other)
  assert.equal(bus.xDriveViewerForegroundActive(),true)
  a();a()
  assert.equal(bus.xDriveViewerForegroundActive(),true)
  a2()
  assert.equal(bus.xDriveViewerForegroundActive(),true)
  b();stop()
  assert.equal(bus.xDriveViewerForegroundActive(),false)
  assert.deepEqual(states,[false,true,false])
})
test('background Gallery scheduling cancels old I/O but preserves current Viewer cache lease',async()=>{
  const pending=new Map(),signals=new Map(),revoked=[]
  const scheduler=newScheduler((id,signal)=>{
    signals.set(id,signal)
    const d=deferred();pending.set(id,d)
    return d.promise
  },{concurrency:2,revokeURL:url=>revoked.push(url)})
  try{
    const warm=scheduler.load(10,0,1)
    await flush()
    pending.get(10).resolve('blob:warm')
    assert.equal(await warm,'blob:warm')
    const borrowed=scheduler.borrowCachedForViewer(10,1)
    assert.equal(borrowed?.url,'blob:warm')
    const cold=scheduler.load(20,0,1)
    await flush()
    assert.equal(signals.get(20)?.aborted,false)
    const release=bus.xDriveAcquireViewerForeground({})
    try{
      assert.equal(await cold,null)
      assert.equal(signals.get(20)?.aborted,true)
      assert.equal(await scheduler.load(10,0,1),'blob:warm')
      assert.equal(await scheduler.load(30,0,1),null)
      pending.get(20).resolve('blob:obsolete')
      await flush()
      assert.ok(revoked.includes('blob:obsolete'))
      assert.equal(revoked.includes('blob:warm'),false)
    }finally{release()}
    const resumed=scheduler.load(40,0,1)
    await flush()
    assert.equal(signals.get(40)?.aborted,false)
    pending.get(40).resolve('blob:resumed')
    assert.equal(await resumed,'blob:resumed')
    borrowed.release()
  }finally{scheduler.dispose()}
})
test('every page transition preempts ONLY its old page; new page and cached Viewer remain usable', async () => {
  bus.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage('web:files')
  const pending=new Map(),signals=new Map(),revoked=[]
  const oldScheduler=newScheduler((id,signal)=>{
    signals.set(id,signal)
    const promise=deferred()
    pending.set(id,promise)
    return promise.promise
  },{concurrency:2,revokeURL:url=>revoked.push(url)})
  let activeScheduler=null
  try {
    const stale=oldScheduler.load(71,0,1)
    await flush()
    assert.equal(signals.get(71)?.aborted,false)
    bus.xDriveEnterForegroundPage('web:files')
    assert.equal(signals.get(71)?.aborted,false,'same page must not cancel current work')
    bus.xDriveEnterForegroundPage('web:gallery')
    assert.equal(await stale,null,'old Files background requests must abort on Gallery navigation')
    assert.equal(signals.get(71)?.aborted,true)
    assert.equal(await oldScheduler.load(72,0,1),null,'Files cannot requeue while Gallery is foreground')
    activeScheduler=newScheduler((id,signal)=>{
      signals.set(id,signal)
      const promise=deferred()
      pending.set(id,promise)
      return promise.promise
    },{concurrency:2,revokeURL:url=>revoked.push(url)})
    const current=activeScheduler.load(73,0,1)
    await flush()
    assert.equal(signals.get(73)?.aborted,false,'new Gallery may load its own visible media')
    pending.get(73).resolve('blob:current')
    assert.equal(await current,'blob:current')
    const viewerBorrow=activeScheduler.borrowCachedForViewer(73,1)
    assert.equal(viewerBorrow?.url,'blob:current')
    const older=activeScheduler.load(74,0,1)
    await flush()
    bus.xDriveEnterForegroundPage('web:media-viewer')
    assert.equal(await older,null)
    assert.equal(signals.get(74)?.aborted,true)
    assert.equal(await activeScheduler.load(73,0,1),'blob:current',
      'routed Viewer borrows the previous page cache without another GET')
    const releaseViewer=bus.xDriveAcquireViewerForeground({})
    bus.xDriveEnterForegroundPage('web:gallery')
    assert.equal(await activeScheduler.load(75,0,1),null,
      'page restoration cannot outrun an overlapping active Viewer lease')
    releaseViewer()
    const resumed=activeScheduler.load(76,0,1)
    await flush()
    assert.equal(signals.get(76)?.aborted,false,'final Viewer close restores current Gallery requests')
    pending.get(76).resolve('blob:resumed')
    assert.equal(await resumed,'blob:resumed')
    viewerBorrow.release()
    pending.get(71).resolve('blob:stale')
    pending.get(74).resolve('blob:stale-video')
    await flush()
    assert.ok(revoked.includes('blob:stale'),'stale old-page bytes must be retired')
    assert.ok(!revoked.includes('blob:current'),'current Viewer lease must remain intact')
  } finally {
    for(const entry of pending.values())entry.resolve(null)
    activeScheduler?.dispose()
    oldScheduler.dispose()
    bus.xDriveEnterForegroundPage(null)
  }
})
test('page identity is adopted at first mount and an obsolete subscriber is never resumed by a later Viewer release', () => {
  bus.xDriveEnterForegroundPage(null)
  const flags=[]
  const stop=bus.xDriveObserveViewerForeground(active=>flags.push(active))
  bus.xDriveEnterForegroundPage('desktop:files')
  const viewer=bus.xDriveAcquireViewerForeground({})
  bus.xDriveEnterForegroundPage('desktop:gallery')
  viewer()
  assert.deepEqual(flags,[false,false,true,true,true],
    'old Files stays suspended after Gallery wins and an overlapping Viewer closes')
  stop()
  bus.xDriveEnterForegroundPage(null)
})
test('all routed and shared inline Viewer entry types share the foreground lease',()=>{
  const web=read('web/src/App.tsx')
  const runtime=read('web/src/webAppRuntime.ts')
  const desktopApp=read('desktop/src/renderer/App.tsx')
  const viewer=read('web/src/WebFileViewerApps.tsx')
  const route=read('web/src/webViewerRoute.ts')
  const modal=read('ui/shared/src/mui/FileOpenPreviewDialog.tsx')
  const files=read('ui/shared/src/mui/FileExplorer.tsx')
  const desktop=read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const cover=read('ui/shared/src/mui/MediaGalleryCoverThumbnail.tsx')
  const thumbnail=read('ui/shared/src/mui/FileExplorerThumbnail.tsx')
  const scheduler=read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  const publicShare=read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  assert.match(runtime,/xDriveEnterForegroundPage\('web:' \+ next\.app\)/)
  assert.match(runtime,/useLayoutEffect\(\(\) => \{\s*xDriveEnterForegroundPage\('web:' \+ route\.app\)/)
  assert.match(desktopApp,/xDriveEnterForegroundPage\('desktop:' \+ next\)/)
  assert.match(desktopApp,/xDriveEnterForegroundPage\('desktop:' \+ view\)/)
  assert.match(web,/xDriveEnterForegroundPage\('web:public-share'\)/)
  assert.match(web,/xDriveEnterForegroundPage\('web:offline'\)/)
  assert.match(web,/xDriveEnterForegroundPage\(null\)/)
  assert.match(web,/const viewerActive = Boolean\(xDriveWebAppViewer\(route\.app\)\)/)
  assert.match(web,/xDriveAcquireViewerForeground\(viewerPriorityOwner\.current\)/)
  for(const app of ["'preview'","'media-viewer'","'text-viewer'","'pdf-viewer'","'audio-player'"])
    assert.ok(viewer.includes('route.app === '+app),'routed Viewer not covered: '+app)
  for(const kind of ["'image'","'video'","'live_photo'","'text'","'pdf'","'audio'"])
    assert.ok(route.includes(kind),'Files/Search classifier missing '+kind)
  assert.match(files,/setQuickLookItemID\(item\.id\)/)
  assert.match(files,/suspended=\{suspendBackgroundThumbnails \|\| quickLookItemID !== null\}/)
  assert.match(desktop,/<XDriveFileExplorer/)
  assert.match(modal,/xDriveAcquireViewerForeground\(viewerPriorityOwner\.current\)/)
  assert.match(publicShare,/const sharePreviewActive = previewEntry !== null && caps.preview/)
  assert.match(publicShare,/xDriveAcquireViewerForeground\(shareViewerOwner\.current\)/)
  assert.match(publicShare,/loadImagePreview=\{/,
    'public Share read-only image Viewer uses the same foreground lease')
  assert.match(gallery,/onOpenViewer\(item, activeIndex\)/)
  assert.match(gallery,/onOpenBaiduNativePhoto=\{onOpenViewer/)
  assert.match(gallery,/onOpenBaiduNativeCellPhoto=\{onOpenViewer/)
  assert.match(gallery,/const thumbnailBackgroundSuspended = suspendBackgroundThumbnails \|\| previewItem !== null \|\| viewerPriorityActive/)
  assert.match(cover,/const coverPaused = suspended \|\| inlineViewerPaused \|\| viewerPriorityActive/)
  assert.match(thumbnail,/const thumbnailsSuspended = suspended \|\| viewerPriorityActive/)
  assert.match(scheduler,/this\.stopObservingViewer = xDriveObserveViewerForeground/)
  assert.doesNotMatch(source,/uploadWith|cancelTransfer|cancelBackup|terminateWorker|abortAll/)
})
