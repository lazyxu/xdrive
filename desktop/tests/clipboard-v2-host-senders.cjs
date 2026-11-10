'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
function transpile(filename,injected){
 const source=read(filename)
 const output=ts.transpileModule(source,{fileName:filename,
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
   reportDiagnostics:true})
 assert.deepEqual((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
 const mod={exports:{}}
 new Function('module','exports','require',output.outputText)(mod,mod.exports,request=>{
   if(Object.hasOwn(injected,request))return injected[request]
   throw Error('unexpected Clipboard dependency: '+request)
 })
 return mod.exports
}
const desktop=transpile('desktop/src/renderer/desktopClipboardDataPort.ts',{
 './desktopClipboardObservationGate':{
  XDriveDesktopClipboardObservationGate:class{
   reset(){} consider(){return null} suppressLocalWrite(){}
  },
 },
})
const dsm=transpile('web/src/synologyClipboardPort.ts',{
 './browserClipboard':{xDriveBrowserCopyText:async()=>{}},
})
const deviceID='a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
const recipient={device_id:deviceID,name:'iPhone',platform:'ios'}
const payload={client_event_id:'dcdf65ec-d439-4875-aa53-c9fcd7a67137',
 target_device_id:deviceID,kind:'image/x-xdrive-node-ref',node_id:118,content:'asset:118'}

test('Desktop transports plaintext through authenticated Agent and rechecks Owner',async()=>{
 let active=true
 const received=[]
 const ok=data=>({ok:true,data})
 const agent={
  cloudClipboardDevices:async()=>ok({devices:[recipient]}),
  cloudClipboardCreate:async value=>{
   received.push({...value})
   return ok({id:1,...value})
  },
 }
 const port=desktop.createDesktopClipboardDataPort(agent,'desktop-owner',
  'https://drive.example/',()=>active)
 assert.deepEqual(await port.listDevices(),{devices:[recipient]})
 const item=await port.create(payload)
 assert.equal(item.content,'asset:118')
 assert.deepEqual(received,[payload])
 await assert.rejects(port.create({...payload,target_device_id:undefined}),/内容与目标设备不匹配/)
 await assert.rejects(port.create({...payload,content:'asset:119'}),/内容与目标设备不匹配/)
 active=false
 await assert.rejects(port.create(payload),/账号已变化/)
 assert.equal(received.length,1)
})
test('DSM checks same current Owner on both sides of plaintext CGI mutation',async()=>{
 const owner='a'.repeat(64), other='b'.repeat(64)
 let active=owner
 const writes=[]
 const cgi={
  serverConnection:async()=>({configured:true,must_change_password:false,
    server:'https://drive.example/',username:'owner',owner_scope:active}),
  clipboardDevices:async()=>({devices:[recipient]}),
  clipboardCreate:async(scope,value)=>{writes.push({scope,value});return {id:1,...value}},
 }
 const port=dsm.createXDriveDSMClipboardPort(cgi,owner)
 assert.deepEqual(await port.listDevices(),{devices:[recipient]})
 await port.create(payload)
 assert.deepEqual(writes,[{scope:owner,value:payload}])
 await assert.rejects(port.create({...payload,node_id:119}),/内容与文件引用不匹配/)
 active=other
 await assert.rejects(port.create(payload),/已变化/)
 assert.equal(writes.length,1)
})
test('Enrollment/revocation stay separate from message text and device keys',async()=>{
 const ok=data=>({ok:true,data})
 let count=0
 const port=desktop.createDesktopClipboardDataPort({
  cloudClipboardEnableDevice:async()=>{count++;return ok(recipient)},
  cloudClipboardRevokeDevice:async()=>{count++;return ok(undefined)},
 },'desktop-owner','https://drive.example/',()=>true)
 assert.deepEqual(await port.enableDeviceRecipient(),recipient)
 await port.revokeDevice(deviceID)
 assert.equal(count,2)
 assert.equal('public_key' in recipient,false)
})
