'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function transpile(file, injected={}) {
  const output = ts.transpileModule(read(file), {
    fileName:file, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((output.diagnostics || []).filter(x=>x.category===ts.DiagnosticCategory.Error), [])
  const mod={exports:{}}
  new Function('module','exports','require',output.outputText)(mod,mod.exports,key=>{
    if (Object.hasOwn(injected,key)) return injected[key]
    throw Error('unexpected Clipboard Viewer module dependency: '+key)
  })
  return mod.exports
}
const gate={XDriveDesktopClipboardObservationGate:class {
  reset() {} consider(){return null} suppressLocalWrite(){}
}}
const desktop=transpile('desktop/src/renderer/desktopClipboardDataPort.ts', {
  './desktopClipboardObservationGate':gate,
})
const dsm=transpile('web/src/synologyClipboardPort.ts', {
  './browserClipboard':{xDriveBrowserCopyText:async()=>{}},
})
const {xDriveValidateSynologyClipboardFileReference:validate} =
  transpile('ui/shared/src/synology-backup-adapter.ts')
const parent=17
const now='2026-11-09T00:00:00Z'
const reference={
  node:{id:118,parent_id:parent,name:'hello.jpg',type:'file',
    size:1234,revision:4,created_at:now,updated_at:now},
  crumbs:[{id:1,name:'Root'},{id:parent,name:'Pictures'},{id:118,name:'hello.jpg'}],
}
const owner='a'.repeat(64)
const other='b'.repeat(64)

test('DSM Files locator validates exact Node, parent, revision, filename and canonical ancestor chain',()=>{
  assert.deepEqual(validate(reference,118),reference)
  const rejects=[
    {...reference,node:{...reference.node,id:119}},
    {...reference,node:{...reference.node,parent_id:99}},
    {...reference,node:{...reference.node,revision:0}},
    {...reference,node:{...reference.node,type:'dir'}},
    {...reference,node:{...reference.node,size:-1}},
    {...reference,node:{...reference.node,name:'renamed.jpg'}},
    {...reference,node:{...reference.node,created_at:'not a date'}},
    {...reference,crumbs:[{id:1,name:'Root'},{id:118,name:'hello.jpg'}]},
    {...reference,crumbs:[...reference.crumbs,{id:118,name:'duplicate'}]},
    {...reference,crumbs:[...reference.crumbs.slice(0,2),{id:118,name:'hello.jpg',path:'/secret'}]},
    {...reference,crumbs:[...reference.crumbs.slice(0,2),{id:118,name:'hello.jpg'}],token:'secret'},
  ]
  for(const sample of rejects) assert.throws(()=>validate(sample,118))
  for(const id of [0,-1,NaN,1.1,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>validate(reference,id))
})

test('DSM opens only freshly verified Files references and rechecks Owner after CGI',async()=>{
  let scope=owner, lookups=0, opened=0
  const cgi={
    serverConnection:async()=>({
      configured:true,must_change_password:false,server:'https://drive.example/',
      username:'owner',owner_scope:scope,
    }),
    clipboardFileReference:async(id,signal)=>{
      assert.equal(id,118)
      assert.equal(signal.aborted,false)
      lookups++;return reference
    },
  }
  const port=dsm.createXDriveDSMClipboardPort(cgi,owner,async(ref,signal)=>{
    assert.equal(signal.aborted,false)
    assert.equal(ref.node.id,118)
    opened++
  })
  assert.equal(typeof port.openReferencedFile,'function')
  await port.openReferencedFile(118,new AbortController().signal)
  assert.equal(lookups,1)
  assert.equal(opened,1)
  scope=other
  await assert.rejects(port.openReferencedFile(118,new AbortController().signal),/已变化/)
  assert.equal(lookups,1)
  assert.equal(opened,1)
})

test('DSM abort and Owner revocation during file resolution never open previous Owner Viewer',async()=>{
  let scope=owner, lookups=0, opened=0
  const cgi={
    serverConnection:async()=>({
      configured:true,must_change_password:false,server:'https://drive.example/',
      username:'owner',owner_scope:scope,
    }),
    clipboardFileReference:async()=>{lookups++;scope=other;return reference},
  }
  const port=dsm.createXDriveDSMClipboardPort(cgi,owner,async()=>{opened++})
  await assert.rejects(port.openReferencedFile(118,new AbortController().signal),/已变化/)
  assert.equal(lookups,1)
  assert.equal(opened,0)
  scope=owner
  const ctrl=new AbortController()
  ctrl.abort()
  await assert.rejects(port.openReferencedFile(118,ctrl.signal))
  assert.equal(lookups,1)
  assert.equal(opened,0)
})

test('Desktop hands off only safe Node IDs and valid Owner scopes',async()=>{
  let ownerLive=true, opened=0
  const port=desktop.createDesktopClipboardDataPort(
    {},'desktop-owner','https://drive.example/',()=>ownerLive,
    async(id,signal)=>{assert.equal(id,118);assert.equal(signal.aborted,false);opened++})
  for(const id of [-1,0,NaN,1.2]) {
    await assert.rejects(port.openReferencedFile(id,new AbortController().signal))
  }
  assert.equal(opened,0)
  await port.openReferencedFile(118,new AbortController().signal)
  assert.equal(opened,1)
  ownerLive=false
  await assert.rejects(port.openReferencedFile(118,new AbortController().signal),/账号已变化/)
  assert.equal(opened,1)
})

test('No standalone Clip binary viewer, File grant, or automatic upload-triggered send is introduced',()=>{
  const shared=read('ui/shared/src/mui/ClipboardPage.tsx')
  const files=read('ui/shared/src/mui/FileExplorer.tsx')
  const agent=read('cmd/xdrive-agent/cloud_clipboard_device.go')
  const dsmPage=read('web/src/synology.tsx')
  assert.match(shared,/text === 'asset:' \+ record\.node_id/)
  assert.match(shared,/port\.openReferencedFile/)
  assert.match(shared,/record\.target_device_id/)
  assert.match(shared,/openVerifiedReference/)
  assert.match(files,/xDriveFileExplorerVerifiedChildReveal\(\{/)
  assert.match(files,/target\.openPreview === true && current\(\)/)
  assert.match(files,/openQuickLook\(result\.item\)/)
  assert.match(agent,/cli\.Node\(ctx, nodeID\)/)
  assert.match(agent,/cli\.NodeLocation\(ctx, nodeID\)/)
  assert.match(agent,/localbackupipc\.ValidateOwnerClipboardFileReference/)
  assert.match(dsmPage,/XDriveSynologyClipboardReferenceViewer/)
  assert.doesNotMatch(dsmPage,/ClipboardFileWriter|cloudUploadFile/)
})
