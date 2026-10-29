'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const modules = new Map()
const compile = (source,p) => {
  const out = ts.transpileModule(source,{
    fileName:p,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  })
  assert.deepEqual((out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
  return out.outputText
}
const common = p => {
  if(modules.has(p))return modules.get(p)
  const mod={exports:{}}
  modules.set(p,mod.exports)
  new Function('module','exports','require',compile(read(p),p))(mod,mod.exports,id=>{
    assert.ok(id.startsWith('./'))
    return common(path.posix.normalize(path.posix.join(path.posix.dirname(p),id))+'.ts')
  })
  return mod.exports
}
const plan = common('ui/shared/src/file-explorer-preview-request.ts').xDriveFileExplorerPreviewRequest
const item={id:42,kind:'file',name:'image.jpg',revision:7}
function extracted(file,name,deps){
  const source=read(file)
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const found=[]
  const walk=node=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name){
      found.push(node.initializer?.getText(ast))
    }
    ts.forEachChild(node,walk)
  }
  walk(ast)
  assert.equal(found.length,1)
  return new Function(...Object.keys(deps),compile('const cb='+found[0]+';',file+'.preview.ts')+'\nreturn cb')(...Object.values(deps))
}
const makeHost=kind=>{
  const calls=[]
  const callsByName=(name,nodeID)=>{calls.push([name,nodeID]);return name}
  const api={
    filePreviewURL:async id=>callsByName('file-stream',id),
    mediaLivePhotoStillURL:async id=>callsByName('live-still',id),
    mediaAnalysisPreviewURL:async id=>callsByName('analysis-image',id),
  }
  const hostPort={
    media:{
      getMediaAnalysisPreview:async id=>{calls.push(['analysis-image',id]);return {ok:true,data:{data:new Uint8Array([1]),content_type:'image/jpeg'}}},
      getMediaLivePhotoStill:async id=>{calls.push(['live-still',id]);return {ok:true,data:'localhost:live'}},
      cloudFilePreviewURL:async id=>{calls.push(['file-stream',id]);return {ok:true,data:'localhost:file'}},
      releaseCloudFilePreviewURL:async()=>{},
    },
    requestViewport:async(_signal,task)=>task('req-1'),
    leasePreviewURL:url=>url,
    releaseDiscardedPreviewURL:()=>{},
  }
  const file=kind==='desktop'?'desktop/src/renderer/DesktopFileExplorer.tsx':'web/src/WebFileExplorer.tsx'
  const load=extracted(file,'loadPreviewURL',{
    useCallback:callback=>callback, xDriveFileExplorerPreviewRequest:plan,
    previewStreamSupported:true, hostPort, api,
  })
  return {load,calls}
}
test('shared plan keeps HEIC/HEIF/RAW derivatives and never streams a Live ZIP as video',()=>{
  for(const name of ['photo.heic','photo.heif','photo.arw','photo.cr3','photo.dng','photo.nef']){
    assert.deepEqual(plan({...item,name},'image'),{mode:'analysis-image',nodeID:42})
  }
  for(const kind of ['image','video','audio','pdf']){
    assert.deepEqual(plan(item,kind),{mode:'file-stream',nodeID:42})
  }
  assert.deepEqual(plan({...item,name:'photo.livp'},'live_photo'),{mode:'live-still',nodeID:42})
  assert.equal(plan(item,'text'),null)
  assert.equal(plan(item,'none'),null)
})
test('invalid or disabled FileExplorer rows never enter a Host preview',()=>{
  for(const bad of [{...item,kind:'dir'},{...item,id:0},{...item,id:-1},
    {...item,id:'bogus'},{...item,id:1.5},{...item,id:Number.MAX_SAFE_INTEGER+1}]){
    assert.equal(plan(bad,'image'),null,JSON.stringify(bad))
  }
  assert.equal(plan(item,'image',false),null)
  assert.deepEqual(plan({...item,id:'42'},'image'),{mode:'file-stream',nodeID:42})
})
test('real Desktop and Web preview callbacks use exactly the same read strategy',async()=>{
  for(const host of ['desktop','web']){
    const {load,calls}=makeHost(host)
    for(const [filename,kind,route] of [
      ['photo.heic','image','analysis-image'],['photo.livp','live_photo','live-still'],
      ['photo.jpg','image','file-stream'],['clip.mp4','video','file-stream'],
      ['sound.m4a','audio','file-stream'],['report.pdf','pdf','file-stream'],
    ]){
      const r=await load({...item,name:filename},kind)
      assert.ok(r,host+': '+filename)
      assert.deepEqual(calls.at(-1),[route,42])
    }
    const count=calls.length
    const signal=new AbortController();signal.abort()
    assert.equal(await load(item,'image',signal.signal),null)
    assert.equal(await load({...item,kind:'dir'},'image'),null)
    assert.equal(await load(item,'text'),null)
    assert.equal(calls.length,count,'no native network/Agent read for invalid request')
  }
})
test('the native/Desktop URL lease and Viewer activity cancellation stay Host-owned',()=>{
  const desk=read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web=read('web/src/WebFileExplorer.tsx')
  for(const src of [desk,web]){
    assert.match(src,/xDriveFileExplorerPreviewRequest\(item, kind,/)
    assert.match(src,/plan\.mode === 'analysis-image'/)
    assert.match(src,/plan\.mode === 'live-still'/)
  }
  assert.match(desk,/hostPort\.requestViewport\(/)
  assert.match(desk,/hostPort\.leasePreviewURL\(/)
  assert.match(desk,/hostPort\.releaseDiscardedPreviewURL\(/)
  assert.match(web,/api\.mediaAnalysisPreviewURL\(plan\.nodeID/)
  assert.doesNotMatch(read('ui/shared/src/file-explorer-preview-request.ts'),
    /window\.|ipcRenderer|fetch\s*\(|backup\.cgi|createObjectURL/)
})
