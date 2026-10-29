#!/usr/bin/env node
// Exercise the actual DSM browser transport: no new JWT, no foreign origin,
// no arbitrary URL or downloadable Server ticket.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const file = root + 'ui/shared/src/synology-backup-adapter.ts'
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(compiled.diagnostics?.filter(x=>x.category===ts.DiagnosticCategory.Error)??[],[])
const payload=Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109,1,2,3,4])
const digest=crypto.createHash('sha256').update(payload).digest('hex')
const good={
  node_id:42,revision:7,mime_type:'video/quicktime',size:payload.length,
  sha256:digest,data:Buffer.from(payload).toString('base64'),
}
const calls=[]
let answer=good
const exports={}
const ctx=vm.createContext({
  exports,module:{exports},URL,Uint8Array,TextEncoder,atob,
  window:{location:{
    href:'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin:'https://nas.example',
  }},
  fetch:async (raw,options)=>{
    const url=new URL(raw)
    calls.push({url,options})
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>answer}
  },
})
vm.runInContext(compiled.outputText,ctx,{filename:file,timeout:1000})
const client=exports.createXDriveSynologyBackupLocalClient(
 'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const controller=new AbortController()
const value=await client.ownerLivePhotoMotion(42,7,controller.signal)
assert.equal(value.nodeID,42)
assert.equal(value.revision,7)
assert.equal(value.mimeType,'video/quicktime')
assert.equal(value.sha256,digest)
assert.deepEqual([...value.data],[...payload])
assert.equal(calls.length,1)
assert.equal(calls[0].url.origin,'https://nas.example')
assert.equal(calls[0].url.pathname,'/webman/3rdparty/xdrivenas/backup.cgi')
assert.equal(calls[0].url.search,'?op=cloud-live-motion&node_id=42&revision=7')
assert.equal(calls[0].options.method,'GET')
assert.equal(calls[0].options.credentials,'same-origin')
assert.equal(calls[0].options.redirect,'error')
assert.equal(calls[0].options.mode,'same-origin')
assert.equal(calls[0].options.signal,controller.signal)
assert.equal(calls[0].options.headers.Authorization,undefined)
const before=calls.length
for(const [id,revision] of [[0,7],[42,0],[-1,7],[Number.MAX_SAFE_INTEGER+1,7]]){
  await assert.rejects(client.ownerLivePhotoMotion(id,revision),/Invalid Owner/)
}
assert.equal(calls.length,before,'invalid identity reached DSM CGI')
for(const invalid of [
  {...good,node_id:43},
  {...good,revision:8},
  {...good,mime_type:'text/html'},
  {...good,sha256:'bad'},
  {...good,size:payload.length+1},
  {...good,data:'SGVsbG8='},
  {...good,token:'sneaky'},
]){
 answer=invalid
 await assert.rejects(client.ownerLivePhotoMotion(42,7),/Invalid Owner|signature or size/)
}
answer=good
const denied=new AbortController()
denied.abort()
await assert.rejects(client.ownerLivePhotoMotion(42,7,denied.signal),/no longer available|cancelled/)
assert.throws(()=>exports.createXDriveSynologyBackupLocalClient(
 'https://other.example/webman/3rdparty/xdrivenas/backup.cgi'),/same-origin/)
console.log('DSM Live Motion: same-origin exact Owner request, 4MiB bound and no bearer URL')
