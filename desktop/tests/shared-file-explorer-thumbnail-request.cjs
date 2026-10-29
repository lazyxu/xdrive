'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const typeSource = read('ui/shared/src/file-explorer-read-identity.ts')

const compile = (source, filename) => {
  const output = ts.transpileModule(source, {
    fileName:filename, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\\n')),[])
  return output.outputText
}
const mod={exports:{}}
new Function('module','exports',compile(typeSource,'file-explorer-read-identity.ts'))(mod,mod.exports)
const request=mod.exports.xDriveFileExplorerThumbnailRequest
const file={id:47,kind:'file',revision:8,name:'photo.jpg'}
function productionCallback(path, name, deps) {
  const source=read(path)
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const result=[]
  const visit = node => {
    if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)
      result.push(node.initializer?.getText(file))
    ts.forEachChild(node,visit)
  }
  visit(file)
  assert.equal(result.length,1,'one real '+name+' in '+path)
  return new Function(...Object.keys(deps),
    compile('const callback = '+result[0]+';',path+'.callback.ts')+'\nreturn callback')(...Object.values(deps))
}
function host(which, fallback=false) {
  const calls=[]
  const done=(op,id,revision)=>{calls.push({op,id,revision});return true}
  const poster=new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'})
  const api={
    mediaThumbnail:async (id,_sig,revision)=>{
      done('thumbnail',id,revision)
      if(fallback)throw Error('thumbnail unavailable')
      return poster
    },
    filePreviewURL:async id=>{done('preview',id);return 'blob:video-ticket'},
    mediaVideoPoster:async (id,revision,blob)=>{done('poster',id,revision);assert.equal(blob,poster)},
  }
  const media={
    getMediaThumbnail:async (id,_req,revision)=>{
      done('thumbnail',id,revision)
      return fallback?{ok:false,error:{code:'unknown'}}:{ok:true,data:{content_type:'image/jpeg',data:new Uint8Array([1,2,3])}}
    },
    cloudFilePreviewURL:async id=>{done('preview',id);return {ok:true,data:'blob:video-ticket'}},
    putMediaVideoPoster:async (id,revision,bytes)=>{
      done('poster',id,revision);assert.ok(bytes instanceof ArrayBuffer);return {ok:true,data:{ok:true}}
    },
    releaseCloudFilePreviewURL:async url=>{done('release',url)},
  }
  const desktop=which==='desktop'
  const path=desktop?'desktop/src/renderer/DesktopFileExplorer.tsx':'web/src/WebFileExplorer.tsx'
  const load=productionCallback(path,'loadThumbnail',{
    useCallback:fn=>fn,
    xDriveFileExplorerThumbnailRequest:request,
    xDriveFileKind:(name)=>name.toLowerCase().endsWith('.mp4')?'video':'image',
    xDriveCaptureVideoPosterBlob:async()=>poster,
    previewStreamSupported:true,
    actionGenerationRef:{current:0},
    hostPort:{
      requestViewport:async (_sig,task)=>task('req-1'),
      releaseDiscardedPreviewURL:()=>{},
      media,
    },
    api,
    URL:{createObjectURL:()=> 'blob:verified-thumbnail'},
    Blob,
  })
  return {load,calls}
}
test('bounded shared thumbnail request accepts legitimate projections and strips bad revisions',()=>{
  assert.deepEqual(request(file),{nodeID:47,revision:8})
  assert.deepEqual(request({...file,id:'47',revision:'8'}),{nodeID:47,revision:8})
  for(const revision of [undefined,'bogus',0,-1,1.25,Number.MAX_SAFE_INTEGER+1]){
    assert.deepEqual(request({...file,revision}),{nodeID:47},String(revision))
  }
  for(const invalid of [{...file,kind:'dir'},{...file,id:0},{...file,id:-2},
    {...file,id:NaN},{...file,id:Number.MAX_SAFE_INTEGER+1},{...file,id:'no'}]){
    assert.equal(request(invalid),null,JSON.stringify(invalid))
  }
  assert.equal(request(file,false),null)
})
test('real Web and Desktop callbacks forward current Node/Revision once and reject stale IDs',async()=>{
  for(const hostName of ['desktop','web']){
    const h=host(hostName)
    assert.equal(await h.load(file),'blob:verified-thumbnail')
    assert.deepEqual(h.calls,[{op:'thumbnail',id:47,revision:8}])
    assert.equal(await h.load({...file,revision:'oops'}),'blob:verified-thumbnail')
    assert.deepEqual(h.calls[1],{op:'thumbnail',id:47,revision:undefined})
    const before=h.calls.length
    const cancelled=new AbortController();cancelled.abort()
    assert.equal(await h.load(file,cancelled.signal),null)
    for(const invalid of [{...file,kind:'dir'},{...file,id:'bad'},{...file,id:0}]){
      assert.equal(await h.load(invalid),null)
    }
    assert.equal(h.calls.length,before,'no native/browser call for invalid or aborted item')
  }
})
test('real video fallback uses the same ID, only validates poster revision, and Desktop releases ticket',async()=>{
  for(const hostName of ['desktop','web']){
    const h=host(hostName,true)
    const stages=[]
    assert.equal(await h.load({...file,name:'movie.mp4'},undefined,undefined,s=>stages.push(s)),
      'blob:verified-thumbnail')
    assert.deepEqual(stages,['video_read','poster_capture'])
    assert.deepEqual(h.calls.slice(0,3),[
      {op:'thumbnail',id:47,revision:8},
      {op:'preview',id:47,revision:undefined},
      {op:'poster',id:47,revision:8},
    ])
    if(hostName==='desktop')assert.deepEqual(h.calls[3],{op:'release',id:'blob:video-ticket',revision:undefined})
    const h2=host(hostName,true)
    assert.equal(await h2.load({...file,name:'movie.mp4',revision:'bad'}), 'blob:verified-thumbnail')
    assert.equal(h2.calls.some(x=>x.op==='poster'),false,
      'unknown revision cannot create an unversioned shared poster')
  }
})
test('real Host transport, lease cleanup and Owner-backed media are still independent',()=>{
  const desktop=read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web=read('web/src/WebFileExplorer.tsx')
  for(const source of [desktop,web])
    assert.match(source,/xDriveFileExplorerThumbnailRequest\(item, !signal\?\.aborted\)/)
  assert.match(desktop,/hostPort\.requestViewport\(/)
  assert.match(desktop,/agent\.releaseCloudFilePreviewURL\(preview\.data\)/)
  assert.match(web,/api\.mediaThumbnail\(request\.nodeID, signal, request\.revision, onProgress\)/)
  assert.match(web,/api\.mediaVideoPoster\(request\.nodeID, revision, poster, signal\)/)
  assert.doesNotMatch(typeSource,/window\.|ipcRenderer|fetch\s*\(|agent\.cloudFilePreviewURL/)
})
