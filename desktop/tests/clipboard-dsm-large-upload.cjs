'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const {webcrypto,createHash}=require('node:crypto')
const {File}=require('node:buffer')
const root=path.resolve(__dirname,'../..')
const file=path.join(root,'ui/shared/src/synology-backup-adapter.ts')
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{
  fileName:file,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((code.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
const owner='a'.repeat(64),id='f6cfbf4d-4dda-4992-92a8-b7c502a6809a'
const time='2026-11-11T00:00:00Z'
const requestURL='https://nas.example/webman/3rdparty/xdrivenas/backup.cgi'
const large=new File([Buffer.alloc(4*1_048_576+19,42)],'large.mov')
const stage=[]
const ctx=vm.createContext({
  module:{exports:{}},exports:{},URL,URLSearchParams,Uint8Array,TextEncoder,crypto:webcrypto,
  btoa:input=>Buffer.from(input,'binary').toString('base64'),
  window:{location:{href:requestURL,origin:'https://nas.example'}},
  fetch:async(url,options)=>{
    const request=new URL(url)
    assert.equal(request.origin,'https://nas.example')
    assert.equal(options.credentials,'same-origin')
    assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,undefined)
    const op=request.searchParams.get('op')
    if(op==='bootstrap')return {
      ok:true,headers:{get:()=> 'application/json'},json:async()=>({csrf_token:'f'.repeat(64)})}
    assert.equal(options.method,'POST')
    assert.equal(options.headers['X-CSRF-Token'],'f'.repeat(64))
    const body=JSON.parse(options.body)
    assert.equal(body.owner_scope,owner)
    stage.push(op)
    const result=(value,status=200)=>({
      ok:status===200, status, headers:{get:()=> 'application/json'},json:async()=>value,
    })
    if(op==='cloud-upload-start'){
      assert.equal(body.parent_id,7)
      assert.equal(body.name,'large.mov')
      assert.equal(body.size,large.size)
      return result({id,size:large.size,chunk_size:4*1_048_576,chunk_count:2})
    }
    if(op==='cloud-upload-part'){
      assert.equal(body.id,id)
      const raw=Buffer.from(body.data,'base64')
      assert.equal(raw.length,body.index===0?4*1_048_576:19)
      assert.equal(createHash('sha256').update(raw).digest('hex'),body.sha256)
      return result({index:body.index,size:raw.length,sha256:body.sha256})
    }
    if(op==='cloud-upload-finish'){
      assert.equal(body.id,id)
      assert.equal(body.parent_id,7)
      assert.equal(body.name,'large.mov')
      assert.equal(body.size,large.size)
      return result({id:1234,parent_id:7,name:'large.mov',type:'file',
        size:large.size,revision:2,created_at:time,updated_at:time})
    }
    throw Error('unexpected UploadSession operation: '+op)
  },
})
vm.runInContext(code.outputText,ctx,{filename:file,timeout:1000})
const client=ctx.module.exports.createXDriveSynologyBackupLocalClient(requestURL)
test('DSM Clipboard >4 MiB uses canonical 4 MiB Server UploadSession parts, no second writer',async()=>{
  const result=await client.ownerUploadLargeFile(7,large,owner)
  assert.equal(result.id,1234)
  assert.deepEqual(stage,['cloud-upload-start','cloud-upload-part','cloud-upload-part','cloud-upload-finish'])
})
test('DSM large File upload rejects bad Owner and invalid sizes before network',async()=>{
  const count=stage.length
  await assert.rejects(()=>client.ownerUploadLargeFile(7,large,'wrong-owner'),/Owner/)
  await assert.rejects(()=>client.ownerUploadLargeFile(0,large,owner),/Owner/)
  await assert.rejects(()=>client.ownerUploadLargeFile(7,new File([Uint8Array.of(1)],'small.txt'),owner),/大文件/)
  assert.equal(stage.length,count)
})
test('no Clipboard-specific Server writer or plaintext broadcast added for large uploads',()=>{
  const source=fs.readFileSync(file,'utf8')
  assert.match(source,/ownerUploadLargeFile: async/)
  assert.match(source,/cloud-upload-start/)
  assert.match(source,/cloud-upload-part/)
  assert.match(source,/cloud-upload-finish/)
  assert.match(source,/cloud-upload-abort/)
  assert.doesNotMatch(source,/clipboardUploadChunk|ClipboardCASWriter|xDriveClipboardEncryptForDevice/)
})
