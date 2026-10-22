'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const source=fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}}).outputText
const owner={origin:'https://offline.test',userID:42,username:'fixture',
 instanceID:'11111111-1111-4111-8111-111111111111'}
function fixture(){
 const records=new Map(),opens=[],channels=[]
 let puts=0
 const db={
  close(){},
  transaction(){
   const tx={oncomplete:null,onabort:null,onerror:null,error:null,
    abort(){tx.onabort?.()},
    objectStore(){return{
     get(key){const r={};queueMicrotask(()=>{r.result=records.get(key);r.onsuccess?.()});return r},
     put(value){puts++;records.set(value.key,value)},
     delete(key){records.delete(key)},
     clear(){records.clear()}
    }}
   }
   queueMicrotask(()=>tx.oncomplete?.())
   return tx
  }
 }
 const index={open(){const req={result:db};opens.push(req);return req}}
 class Channel{
  constructor(name){assert.equal(name,'xdrive-pwa-offline-purge');channels.push(this)}
  postMessage(){}
  close(){}
 }
 const exports={}
 const win={isSecureContext:true,location:{origin:owner.origin},indexedDB:index}
 new Function('exports','window','BroadcastChannel',code)(exports,win,Channel)
 return {api:exports,records,opens,channels,get puts(){return puts}}
}
async function completeOpen(f,index){
 const req=f.opens[index]
 assert(req,'expected pending authentic open request')
 req.onsuccess()
 await new Promise(resolve=>setImmediate(resolve))
}
test('P0-04 local logout fences a delayed opted-in IndexedDB open before it can recreate consent',async()=>{
 const f=fixture()
 const enable=f.api.xDrivePwaSetOfflineConsent(owner,true)
 assert.equal(f.opens.length,1)
 const purge=f.api.xDrivePwaClearOfflineMetadata()
 assert.equal(f.opens.length,2)
 await completeOpen(f,1)
 await purge
 const before=f.puts
 await completeOpen(f,0)
 await enable
 assert.equal(f.puts,before,'a stale opt-in must not persist owner or relaunch hint')
 assert.equal(f.records.size,0)
})
test('P0-04 peer cross-tab purge invalidates pending opt-in even before storage open resolves',async()=>{
 const f=fixture()
 const unsub=f.api.xDrivePwaObserveOfflinePurge(()=>{})
 const stale=f.api.xDrivePwaSetOfflineConsent(owner,true)
 assert.equal(f.opens.length,1)
 const watcher=f.channels.find(x=>typeof x.onmessage==='function')
 assert(watcher,'peer purge listener missing')
 watcher.onmessage({data:{kind:'xdrive-pwa-offline-purge'}})
 await completeOpen(f,0)
 await stale
 assert.equal(f.puts,0)
 assert.equal(f.records.size,0)
 unsub()
})
test('P0-04 snapshots and nested callbacks fence prior read results across revocation',()=>{
 assert(source.includes('const captureEpoch = offlinePurgeEpoch'))
 const checks=source.match(/captureEpoch !== offlinePurgeEpoch/g)||[]
 assert(checks.length>=5,'both directory/album reads and nested hint callback must be fenced')
 assert(source.includes('if (intentEpoch !== offlinePurgeEpoch)'))
 assert(source.includes('offlinePurgeEpoch += 1'))
 assert(!source.includes('caches.open('))
})
