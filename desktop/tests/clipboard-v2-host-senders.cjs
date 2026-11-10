'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = filename => fs.readFileSync(path.join(root,filename),'utf8')

function transpile(filename,injected={}) {
  const output=ts.transpileModule(read(filename),{
    fileName:filename,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    reportDiagnostics:true,
  })
  assert.deepEqual((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
  const mod={exports:{}}
  new Function('module','exports','require',output.outputText)(mod,mod.exports,request=>{
    if(Object.hasOwn(injected,request)) return injected[request]
    throw Error('unexpected Clipboard dependency '+request)
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
const recipient={device_id:deviceID,name:'Test iPhone',platform:'ios'}
const payload={
  client_event_id:'dcdf65ec-d439-4875-aa53-c9fcd7a67137',
  target_device_id:deviceID,kind:'image/x-xdrive-node-ref',
  node_id:118,content:'asset:118',
}
const message={
  id:19,created_at:'2026-11-10T06:00:00Z',
  expires_at:'2026-11-11T06:00:00Z',...payload,
}

test('Desktop sends exact plaintext Node metadata over current Owner Agent',async()=>{
  let active=true
  const calls=[]
  const ok=data=>({ok:true,data})
  const agent={
    cloudClipboardDevices:async()=>{calls.push('devices');return ok({devices:[recipient]})},
    cloudClipboardList:async()=>{calls.push('list');return ok({items:[message],next_before:null})},
    cloudClipboardCreate:async value=>{
      calls.push({create:{...value}})
      return ok({...message,...value})
    },
    cloudClipboardEnableDevice:async()=>{calls.push('enroll');return ok(recipient)},
  }
  const port=desktop.createDesktopClipboardDataPort(agent,'desktop-owner','https://drive.example/',()=>active)
  assert.deepEqual(await port.listDevices(),{devices:[recipient]})
  assert.deepEqual(await port.list(),{items:[message],next_before:null})
  assert.deepEqual(await port.enableDeviceRecipient(),recipient)
  assert.equal((await port.create(payload)).content,'asset:118')
  assert.deepEqual(calls,['devices','list','enroll',{create:payload}])
  assert.doesNotMatch(JSON.stringify(calls),/ciphertext|nonce|wrapped_key|ephemeral_key|public_key/)
  await assert.rejects(async()=>port.create({...payload,target_device_id:undefined}),/内容与目标设备不匹配/)
  await assert.rejects(async()=>port.create({...payload,content:'asset:119'}),/内容与目标设备不匹配/)
  assert.equal(calls.length,4)
  active=false
  await assert.rejects(port.listDevices(),/账号已变化/)
  await assert.rejects(port.create(payload),/账号已变化/)
  assert.equal(calls.length,4)
})

test('Desktop enforces current Owner before and after delayed plaintext send',async()=>{
  let active=true
  let resolve
  const pending=new Promise(ok=>{resolve=ok})
  const port=desktop.createDesktopClipboardDataPort({
    cloudClipboardCreate:()=>pending,
  },'owner','https://drive.example/',()=>active)
  const sending=port.create(payload)
  active=false
  resolve({ok:true,data:message})
  await assert.rejects(sending,/账号已变化/)
})

test('DSM enforces Owner scope before and after plaintext CGI operations',async()=>{
  const owner='a'.repeat(64),other='b'.repeat(64)
  const calls=[]
  let current=owner
  const client={
    serverConnection:async()=>({
      configured:true,must_change_password:false,server:'https://drive.example/',
      username:'owner',owner_scope:current,
    }),
    clipboardDevices:async()=>{calls.push('devices');return {devices:[recipient]}},
    clipboardCreate:async(scope,value)=>{
      calls.push({scope,value})
      return {...message,...value}
    },
    clipboardEnableDevice:async scope=>{calls.push({enroll:scope});return recipient},
  }
  const port=dsm.createXDriveDSMClipboardPort(client,owner)
  assert.deepEqual(await port.listDevices(),{devices:[recipient]})
  assert.deepEqual(await port.enableDeviceRecipient(),recipient)
  assert.equal((await port.create(payload)).content,'asset:118')
  assert.deepEqual(calls,['devices',{enroll:owner},{scope:owner,value:payload}])
  await assert.rejects(async()=>port.create({...payload,target_device_id:undefined}),
    /内容与文件引用不匹配/)
  await assert.rejects(async()=>port.create({...payload,node_id:119}),
    /内容与文件引用不匹配/)
  current=other
  await assert.rejects(port.listDevices(),/已变化/)
  await assert.rejects(port.create(payload),/已变化/)
  assert.equal(calls.length,3)
})

test('DSM discards a successful response when Owner changed during CGI',async()=>{
  const owner='a'.repeat(64),other='b'.repeat(64)
  let current=owner
  const client={
    serverConnection:async()=>({
      configured:true,must_change_password:false,server:'https://drive.example/',
      username:'owner',owner_scope:current,
    }),
    clipboardCreate:async(_scope,value)=>{
      current=other
      return {...message,...value}
    },
  }
  const port=dsm.createXDriveDSMClipboardPort(client,owner)
  await assert.rejects(port.create(payload),/已变化/)
})
