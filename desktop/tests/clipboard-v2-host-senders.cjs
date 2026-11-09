'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = filename => fs.readFileSync(path.join(root,filename),'utf8')

function transpile(filename,injected) {
  const source=read(filename)
  const output=ts.transpileModule(source,{
    fileName:filename,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    reportDiagnostics:true,
  })
  assert.deepEqual((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
  const mod={exports:{}}
  new Function('module','exports','require',output.outputText)(mod,mod.exports,request=>{
    if(Object.hasOwn(injected,request)) return injected[request]
    throw Error('unexpected v2 Clipboard dependency '+request)
  })
  return mod.exports
}
const desktop=transpile('desktop/src/renderer/desktopClipboardDataPort.ts',{
  './desktopClipboardObservationGate':{
    XDriveDesktopClipboardObservationGate:class {
      reset() {}
      consider() { return null }
      suppressLocalWrite() {}
    },
  },
})
const dsm=transpile('web/src/synologyClipboardPort.ts',{
  './browserClipboard':{ xDriveBrowserCopyText:async()=>{} },
})
const deviceID='a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
const payload={
  client_event_id:'dcdf65ec-d439-4875-aa53-c9fcd7a67137',
  target_device_id:deviceID,kind:'image/x-xdrive-node-ref',node_id:118,
  nonce:Buffer.alloc(12,1).toString('base64'),
  ciphertext:Buffer.alloc(50,2).toString('base64'),
  ephemeral_key:Buffer.alloc(32,3).toString('base64'),
  wrapped_key:Buffer.alloc(60,4).toString('base64'),
}
const recipient={device_id:deviceID,name:'Test iPhone',platform:'ios',
  public_key:Buffer.alloc(32,5).toString('base64')}

test('Desktop sends exact v2 fields over an Owner-only Agent channel and never falls back to broadcast',async()=>{
  let active=true
  const calls=[]
  const ok=data=>({ok:true,data})
  const agent={
    cloudClipboardDevices:async()=>{calls.push('devices');return ok({devices:[recipient]})},
    cloudClipboardCreate:async value=>{
      calls.push({create:{...value}})
      return ok({id:19,created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+50000).toISOString(),...value})
    },
  }
  const port=desktop.createDesktopClipboardDataPort(agent,'desktop-owner','https://drive.example/',()=>active)
  assert.deepEqual(await port.listDevices(),{devices:[recipient]})
  const receipt=await port.create(payload)
  assert.equal(receipt.node_id,118)
  assert.equal(calls.length,2)
  assert.deepEqual(calls[1].create,payload,'do not strip authenticated v2 envelope fields')
  await assert.rejects(async () => port.create({...payload,target_device_id:undefined}),
    /不允许把定向内容降级/)
  assert.equal(calls.length,2,'cannot forward targetless media as v1')
  active=false
  await assert.rejects(port.listDevices(),/账号已变化/)
  await assert.rejects(port.create(payload),/账号已变化/)
  assert.equal(calls.length,2,'stale Owner must never reach Agent')
})
test('DSM enforces Owner scope before and after v2 CGI operations',async()=>{
  const ownerScope='a'.repeat(64)
  const otherScope='b'.repeat(64)
  const calls=[]
  let current=ownerScope
  const client={
    serverConnection:async()=>({
      configured:true,must_change_password:false,
      server:'https://drive.example/',username:'owner',
      owner_scope:current,
    }),
    clipboardDevices:async()=>{calls.push('devices');return {devices:[recipient]}},
    clipboardCreate:async(scope,value)=>{
      calls.push({scope,value})
      return {id:19,created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+50000).toISOString(),...value}
    },
  }
  const port=dsm.createXDriveDSMClipboardPort(client,ownerScope)
  assert.deepEqual(await port.listDevices(),{devices:[recipient]})
  await port.create(payload)
  assert.equal(calls.length,2)
  assert.deepEqual(calls[1].value,payload)
  assert.equal(calls[1].scope,ownerScope)
  await assert.rejects(async () => port.create({...payload,target_device_id:undefined}),
    /不允许把设备定向密文降级/)
  current=otherScope
  await assert.rejects(port.listDevices(),/已变化/)
  await assert.rejects(port.create(payload),/已变化/)
  assert.equal(calls.length,2)
})

test('Desktop explicit local enrollment and decrypt expose no installation private key',async()=>{
  let owner=true
  const calls=[]
  const ok=data=>({ok:true,data})
  const agent={
    cloudClipboardEnableDevice:async()=>{
      calls.push('enable')
      return ok(recipient)
    },
    cloudClipboardDecrypt:async id=>{
      calls.push({decrypt:id})
      return ok({text:'asset:118'})
    },
  }
  const port=desktop.createDesktopClipboardDataPort(agent,
    'desktop-owner','https://drive.example/',()=>owner)
  assert.deepEqual(await port.enableDeviceRecipient(),recipient)
  assert.equal(await port.decryptTarget(19),'asset:118')
  assert.deepEqual(calls,['enable',{decrypt:19}])
  await assert.rejects(async()=>port.decryptTarget(-1),/Invalid Clipboard item ID/)
  owner=false
  await assert.rejects(port.enableDeviceRecipient(),/账号已变化/)
  await assert.rejects(port.decryptTarget(19),/账号已变化/)
  assert.equal(calls.length,2)
  assert.doesNotMatch(JSON.stringify(recipient),/private|credential|device_token/i)
})

test('DSM decrypt and enrollment reject Owner switch after a successful CGI operation',async()=>{
  const owner='a'.repeat(64)
  const different='b'.repeat(64)
  let current=owner
  let changedDuringDecryption=false
  const calls=[]
  const cgi={
    serverConnection:async()=>({
      configured:true,must_change_password:false,server:'https://drive.example/',
      username:'owner',owner_scope:current,
    }),
    clipboardEnableDevice:async scope=>{
      calls.push({enable:scope})
      return recipient
    },
    clipboardDecrypt:async(scope,id)=>{
      calls.push({decrypt:{scope,id}})
      if(changedDuringDecryption) current=different
      return {text:'asset:118'}
    },
  }
  const port=dsm.createXDriveDSMClipboardPort(cgi,owner)
  assert.deepEqual(await port.enableDeviceRecipient(),recipient)
  assert.equal(await port.decryptTarget(19),'asset:118')
  assert.equal(calls.length,2)
  await assert.rejects(async()=>port.decryptTarget(0),/Invalid recipient ID/)
  changedDuringDecryption=true
  await assert.rejects(port.decryptTarget(20),/已变化/)
  assert.equal(calls.length,3)
  await assert.rejects(port.enableDeviceRecipient(),/已变化/)
  assert.equal(calls.length,3)
})
