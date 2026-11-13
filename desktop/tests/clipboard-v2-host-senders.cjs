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


test('Desktop and DSM expose existing Owner Files picker and canonical file upload',async()=>{
  const ok=data=>({ok:true,data})
  const root={id:7,name:'owner',type:'dir',size:0,revision:1}
  const child={id:8,parent_id:7,name:'image.jpg',type:'file',size:3,revision:1}
  const file=new File([Uint8Array.of(1,2,3)],'image.jpg',{type:'image/jpeg'})
  const calls=[]
  const agent={
    cloudRoot:async()=>ok(root),
    cloudChildrenPage:async(parent,options)=>{
      calls.push('desktop-page')
      assert.equal(parent,7)
      assert.deepEqual(options,{limit:50,cursor:undefined,sort:'name',order:'asc'})
      return ok({items:[child],next_cursor:undefined,has_more:false,sort:'name',order:'asc'})
    },
    cloudUploadFile:async(parent,selected,policy)=>{
      calls.push('desktop-upload')
      assert.equal(parent,7);assert.equal(selected,file);assert.equal(policy,'fail')
      return ok({node:child,skipped:false,transferred_bytes:3})
    },
  }
  const port=desktop.createDesktopClipboardDataPort(agent,'desktop-owner','https://drive.example/',()=>true)
  assert.equal((await port.browseFiles.root(new AbortController().signal)).id,7)
  assert.equal((await port.browseFiles.page(7,undefined,new AbortController().signal)).items[0].id,8)
  assert.deepEqual(await port.uploadLocalFile(file,new AbortController().signal),{node_id:8})
  assert.deepEqual(calls,['desktop-page','desktop-upload'])
  let active='a'.repeat(64)
  const dsmCalls=[]
  const cgi={
    serverConnection:async()=>({configured:true,must_change_password:false,
      server:'https://drive.example/',username:'owner',owner_scope:active}),
    ownerFilesRoot:async()=>root,
    ownerFilesPage:async(parent,limit,sort,order,cursor)=>{
      dsmCalls.push('page')
      assert.deepEqual([parent,limit,sort,order,cursor],[7,50,'name','asc',''])
      return {items:[child],has_more:false,sort,order}
    },
    ownerUploadSmallFile:async(parent,selected,scope)=>{
      dsmCalls.push('upload')
      assert.equal(scope,active);assert.equal(parent,7);assert.equal(selected,file)
      return child
    },
  }
  const dsmPort=dsm.createXDriveDSMClipboardPort(cgi,active)
  assert.equal((await dsmPort.browseFiles.root(new AbortController().signal)).id,7)
  assert.equal((await dsmPort.browseFiles.page(7,undefined,new AbortController().signal)).items[0].id,8)
  assert.deepEqual(await dsmPort.uploadLocalFile(file,new AbortController().signal),{node_id:8})
  assert.deepEqual(dsmCalls,['page','upload'])
  const large=new File([new Uint8Array(4*1_048_576+1)],'large.bin')
   // No second Clipboard writer: the existing DSM Files/CAS chunk transport
  // returns the same verified Node shape after finalization.
  const largeCGI={
    ...cgi,
    ownerUploadLargeFile:async(parent,selected,scope)=>{
      assert.equal(parent,7);assert.equal(selected,large);assert.equal(scope,active)
      return {...child,id:9,name:'large.bin',size:large.size}
    },
  }
  const largePort=dsm.createXDriveDSMClipboardPort(largeCGI,active)
  assert.deepEqual(await largePort.uploadLocalFile(large,new AbortController().signal),{node_id:9})
  active='b'.repeat(64)
  await assert.rejects(dsmPort.uploadLocalFile(file,new AbortController().signal),/已变化/)
  await assert.rejects(port.browseFiles.page(0,undefined,new AbortController().signal),/无效/)
})
test('Desktop and DSM use bounded foreground change checking and preserve 15s fallback',()=>{
  const fs=require('node:fs'),path=require('node:path')
  const root=path.resolve(__dirname,'../..')
  for(const file of ['desktop/src/renderer/desktopClipboardDataPort.ts',
    'web/src/synologyClipboardPort.ts']){
    const source=fs.readFileSync(path.join(root,file),'utf8')
    assert.match(source,/watchChanges: async \(onChange, signal\)/)
    assert.match(source,/document\.visibilityState === 'visible'/)
    assert.match(source,/signal\.aborted/)
    assert.match(source,/1800/)
    assert.doesNotMatch(source,/localStorage|sessionStorage/)
  }
  const ui=fs.readFileSync(path.join(root,'ui/shared/src/mui/ClipboardPage.tsx'),'utf8')
  assert.match(ui,/15000/)
})


test('Server-originated Desktop and DSM change cursor triggers one Owner-scoped refresh',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document')
  Object.defineProperty(globalThis,'document',{value:{visibilityState:'visible'},configurable:true})
  try {
    const ok=data=>({ok:true,data})
    const dAbort=new AbortController()
    const dEvents=[]
    const port=desktop.createDesktopClipboardDataPort({
      cloudClipboardNextEvent:async after=>{
        assert.equal(after,0)
        return ok({cursor:14,changed:true})
      },
    },'desktop-owner','https://drive.example/',()=>true)
    await port.watchChanges(()=>{dEvents.push(14);dAbort.abort()},dAbort.signal)
    assert.deepEqual(dEvents,[14])
    const owner='a'.repeat(64),sAbort=new AbortController()
    const sEvents=[]
    const dsmPort=dsm.createXDriveDSMClipboardPort({
      serverConnection:async()=>({configured:true,must_change_password:false,
        server:'https://drive.example/',username:'owner',owner_scope:owner}),
      clipboardNextEvent:async after=>{
        assert.equal(after,0)
        return {cursor:15,changed:true}
      },
    },owner)
    await dsmPort.watchChanges(()=>{sEvents.push(15);sAbort.abort()},sAbort.signal)
    assert.deepEqual(sEvents,[15])
  }finally{
    if(previous)Object.defineProperty(globalThis,'document',previous)
    else delete globalThis.document
  }
})



// Deterministic virtual-time integration through the actual exported Host ports.
// Do not sleep 15 seconds or replace the application reconciling implementation
// with a source-regex assertion: count real SSE calls, GETs and visible refreshes.
async function withVisibleClipboardClock(advance,run){
  const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
  const savedSetTimeout=globalThis.setTimeout
  const savedNow=Date.now
  let now=100000
  Object.defineProperty(globalThis,'document',{
    value:{visibilityState:'visible'},configurable:true,
  })
  globalThis.setTimeout=(callback,delay=0)=>{
    now+=advance(delay)
    queueMicrotask(callback)
    return 1
  }
  Date.now=()=>now
  try{await run()}finally{
    Date.now=savedNow
    globalThis.setTimeout=savedSetTimeout
    if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument)
    else delete globalThis.document
  }
}
function makeClipboardWatchHost(kind,handlers){
  const ok=data=>({ok:true,data})
  if(kind==='desktop'){
    return desktop.createDesktopClipboardDataPort({
      cloudClipboardNextEvent:async after=>ok(await handlers.next(after)),
      cloudClipboardList:async()=>ok(await handlers.list()),
    },'desktop-owner','https://drive.example/',handlers.ownerCurrent||(()=>true))
  }
  const owner='a'.repeat(64)
  return dsm.createXDriveDSMClipboardPort({
    serverConnection:async()=>({
      configured:true,must_change_password:false,
      server:'https://drive.example/',username:'owner',
      owner_scope:handlers.ownerScope?.()||owner,
    }),
    clipboardNextEvent:handlers.next,
    clipboardList:handlers.list,
  },owner)
}
test('Desktop/DSM SSE outage falls back to bounded GET, refreshing only after a true change',async()=>{
  await withVisibleClipboardClock(ms=>ms,async()=>{
    for(const kind of ['desktop','dsm']){
      const abort=new AbortController()
      let sse=0,reads=0,refreshes=0
      const port=makeClipboardWatchHost(kind,{
        next:async()=>{sse++;throw Error('SSE offline')},
        list:async()=>{
          reads++
          const stamp=reads<3?'original':'updated'
          return {items:[{id:1,client_event_id:stamp}],next_before:null}
        },
      })
      await port.watchChanges(()=>{refreshes++;abort.abort()},abort.signal)
      assert.deepEqual({sse,reads,refreshes},{sse:1,reads:3,refreshes:1},
        kind+' must not flash on initial or identical fallback snapshot')
    }
  })
})
test('Desktop/DSM return to Server SSE after 15s fallback without duplicate refresh',async()=>{
  await withVisibleClipboardClock(ms=>ms===1800?15001:ms,async()=>{
    for(const kind of ['desktop','dsm']){
      const abort=new AbortController()
      let sse=0,reads=0,refreshes=0
      const port=makeClipboardWatchHost(kind,{
        next:async after=>{
          sse++
          assert.equal(after,0)
          if(sse===1)throw Error('temporary SSE disconnection')
          return {cursor:52,changed:true}
        },
        list:async()=>{reads++;return {items:[],next_before:null}},
      })
      await port.watchChanges(()=>{refreshes++;abort.abort()},abort.signal)
      assert.deepEqual({sse,reads,refreshes},{sse:2,reads:1,refreshes:1},
        kind+' must resume SSE after one fallback baseline GET')
    }
  })
})
test('Desktop/DSM reject delayed SSE after Owner switch without stale callbacks or list GETs',async()=>{
  await withVisibleClipboardClock(ms=>ms,async()=>{
    const other='b'.repeat(64),owner='a'.repeat(64)
    for(const kind of ['desktop','dsm']){
      let active=true,scope=owner,refreshes=0,reads=0
      const port=makeClipboardWatchHost(kind,{
        ownerCurrent:()=>active,
        ownerScope:()=>scope,
        next:async()=>{
          active=false
          scope=other
          return {cursor:31,changed:true}
        },
        list:async()=>{reads++;return {items:[],next_before:null}},
      })
      await assert.rejects(
        ()=>port.watchChanges(()=>{refreshes++},new AbortController().signal),
        /账号已变化|Owner 已变化/)
      assert.equal(refreshes,0,kind+' exposed old Owner invalidation')
      assert.equal(reads,0,kind+' performed stale Owner GET')
    }
  })
})
test('Desktop/DSM cancellation during in-flight SSE cannot trigger stale refresh',async()=>{
  await withVisibleClipboardClock(ms=>ms,async()=>{
    for(const kind of ['desktop','dsm']){
      const abort=new AbortController()
      let refreshes=0,reads=0
      const port=makeClipboardWatchHost(kind,{
        next:async()=>{abort.abort();return {cursor:40,changed:true}},
        list:async()=>{reads++;return {items:[],next_before:null}},
      })
      await assert.rejects(()=>port.watchChanges(()=>{refreshes++},abort.signal),
        err=>err?.name==='AbortError')
      assert.equal(refreshes,0,kind+' refreshed after disposed page')
      assert.equal(reads,0,kind+' performed GET after page cancellation')
    }
  })
})


test('Desktop refuses same-Owner CAS receipts with unexpected file name or byte count',async()=>{
  const ok=data=>({ok:true,data})
  const root={id:7,name:'owner',type:'dir',size:0,revision:1}
  const file=new File([Uint8Array.of(1,2,3)],'selected.png',{type:'image/png'})
  let received={id:8,parent_id:7,name:'other.png',type:'file',size:3,revision:1}
  const port=desktop.createDesktopClipboardDataPort({
    cloudRoot:async()=>ok(root),
    cloudUploadFile:async(parent,selected,policy)=>{
      assert.deepEqual([parent,selected,policy],[7,file,'fail'])
      return ok({node:received,skipped:false})
    },
  },'desktop-owner','https://drive.example/',()=>true)
  const signal=new AbortController().signal
  await assert.rejects(port.uploadLocalFile(file,signal),/文件上传回执不完整/)
  received={...received,name:file.name,size:4}
  await assert.rejects(port.uploadLocalFile(file,signal),/文件上传回执不完整/)
  received={...received,size:file.size}
  assert.deepEqual(await port.uploadLocalFile(file,signal),{node_id:8})
})

test('Desktop and DSM import explicitly exposed HEIC/HEIF using their existing Owner CAS writer',async()=>{
  const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window')
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  const ok=data=>({ok:true,data})
  const root={id:7,name:'owner',type:'dir',size:0,revision:1}
  const owner='a'.repeat(64)
  const uploaded=[]
  let reads=0
  try {
    Object.defineProperty(globalThis,'window',{
      configurable:true,value:{isSecureContext:true},
    })
    for(const [mime,extension] of [['image/heic','heic'],['image/heif','heif']]){
      Object.defineProperty(globalThis,'navigator',{
        configurable:true,value:{clipboard:{read:()=>{
          reads++
          return Promise.resolve([{
            types:[mime],
            getType:async type=>{
              assert.equal(type,mime)
              return new Blob([Uint8Array.of(1,2,3)],{type:mime})
            },
          }])
        }}},
      })
      const checkFile=(host,file)=>{
        assert.equal(file.type,mime)
        assert.match(file.name,new RegExp('^Clipboard-[0-9a-f-]+\\.'+extension+'$'))
        assert.equal(file.size,3)
        uploaded.push({host,mime})
        return {id:uploaded.length+30,parent_id:7,type:'file',name:file.name,
          size:file.size,revision:1}
      }
      const desktopPort=desktop.createDesktopClipboardDataPort({
        cloudRoot:async()=>ok(root),
        cloudUploadFile:async(parent,file,policy)=>{
          assert.equal(parent,7);assert.equal(policy,'fail')
          return ok({node:checkFile('desktop',file),skipped:false})
        },
      },'desktop-owner','https://drive.example/',()=>true)
      const signal=new AbortController().signal
      assert.ok((await desktopPort.importImageFromClipboard(signal)).node_id>0)
      const dsmPort=dsm.createXDriveDSMClipboardPort({
        serverConnection:async()=>({configured:true,must_change_password:false,
          server:'https://drive.example/',username:'owner',owner_scope:owner}),
        ownerFilesRoot:async()=>root,
        ownerUploadSmallFile:async(parent,file,scope)=>{
          assert.equal(parent,7);assert.equal(scope,owner)
          return checkFile('dsm',file)
        },
      },owner)
      assert.ok((await dsmPort.importImageFromClipboard(signal)).node_id>0)
    }
    assert.equal(reads,4)
    assert.deepEqual(uploaded,[{host:'desktop',mime:'image/heic'},
      {host:'dsm',mime:'image/heic'},{host:'desktop',mime:'image/heif'},
      {host:'dsm',mime:'image/heif'}])
  } finally {
    if(priorWindow)Object.defineProperty(globalThis,'window',priorWindow)
    else delete globalThis.window
    if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator)
    else delete globalThis.navigator
  }
})
