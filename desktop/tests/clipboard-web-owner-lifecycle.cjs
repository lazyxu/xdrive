'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const root=path.resolve(__dirname,'../..')
const file=path.join(root,'ui/shared/src/mui/ClipboardPage.tsx')
const source=fs.readFileSync(file,'utf8')
const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window')
const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
globalThis.window={isSecureContext:true,setInterval:()=>1,clearInterval:()=>{}}
globalThis.document={visibilityState:'visible'}
test.after(()=>{
  for(const [name,desc] of [['window',previousWindow],['document',previousDocument]]) {
    if(desc) Object.defineProperty(globalThis,name,desc)
    else delete globalThis[name]
  }
})

function loadTS(filename,sourceText,injected={}) {
  const compiled=ts.transpileModule(sourceText,{
    fileName:filename,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
      jsx:ts.JsxEmit.ReactJSX},
  })
  assert.deepEqual((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
  const output={exports:{}}
  new Function('module','exports','require',compiled.outputText)(output,output.exports,request=>{
    if(request==='react')return React
    if(request==='react/jsx-runtime')return require('react/jsx-runtime')
    if(Object.hasOwn(injected,request))return injected[request]
    throw Error('Unexpected Clipboard module '+request)
  })
  return output.exports
}
const fenceFile=path.join(root,'ui/shared/src/clipboard-action-fence.ts')
const fence=loadTS(fenceFile,fs.readFileSync(fenceFile,'utf8'))
const mui=Object.fromEntries(
  ['Alert','Box','Button','Card','Divider','Stack','TextField','Typography',
    'MenuItem','FormControlLabel','Switch'].map(name=>
    [name,({children,...props})=>React.createElement(name,props,children)]))
const Page=loadTS(file,source,{
  '@mui/material':mui,
  '../clipboard-action-fence':fence,
  './ClipboardFileNodePicker':{ClipboardFileNodePicker:()=>null},
}).XDriveClipboardPage

function deferred(){
  let resolve,reject
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
function port(scope,extra={}){
  return {
    ownerScopeKey:scope,
    list:async()=>({items:[],next_before:null}),
    create:async item=>({id:42,created_at:'2026-11-10T07:00:00Z',
      expires_at:'2026-11-11T07:00:00Z',...item}),
    remove:async()=>{},clear:async()=>{},
    readText:async()=> 'local clipboard text',
    copyText:async()=>{},
    ...extra,
  }
}
function item(content,rest={}){
  return {
    id:1,client_event_id:'dfc9f493-775a-44a6-9f3a-2f5f5e4f0ce3',
    kind:'text/plain',content,
    created_at:'2026-11-10T07:00:00Z',
    expires_at:'2026-11-11T07:00:00Z',...rest,
  }
}
async function act(fn){await Renderer.act(async()=>{fn();await Promise.resolve()})}
async function mount(owner){
  let renderer
  await act(()=>{renderer=Renderer.create(React.createElement(Page,{port:owner}))})
  return {
    update:next=>act(()=>renderer.update(React.createElement(Page,{port:next}))),
    unmount:()=>act(()=>renderer.unmount()),
    button(label){
      const found=renderer.root.findAllByType('Button').find(b=>b.props.children===label)
      assert.ok(found,'expected Clipboard button: '+label)
      return found
    },
    field(label){
      const found=renderer.root.findAllByType('TextField').find(f=>f.props.label===label)
      assert.ok(found,'expected Clipboard field: '+label)
      return found
    },
    snapshot:()=>JSON.stringify(renderer.toJSON()),
    buttons:()=>renderer.root.findAllByType('Button').map(b=>b.props.children),
  }
}
const click=(app,label)=>act(()=>app.button(label).props.onClick())
const type=(app,label,value)=>act(()=>app.field(label).props.onChange({target:{value}}))
const deviceID='a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'

test('Clipboard is usable immediately with no independent passphrase or unlock button',async()=>{
  const app=await mount(port('owner'))
  try{
    assert.ok(app.button('发送'))
    assert.ok(app.field('输入内容'))
    assert.doesNotMatch(app.snapshot(),/剪贴板口令|加密发送|解锁加密剪贴板/)
    assert.match(app.snapshot(),/Server 保存明文/)
  }finally{await app.unmount()}
})

test('Owner A→B→A rejects a delayed A history and never paints another Owner',async()=>{
  const old=deferred()
  let aReads=0
  const a=port('Owner A',{list:()=>{aReads++;return aReads===1?old.promise:
    Promise.resolve({items:[],next_before:null})}})
  const b=port('Owner B',{list:async()=>({items:[item('visible only to B')],next_before:null})})
  const app=await mount(a)
  try{
    await app.update(b)
    assert.match(app.snapshot(),/visible only to B/)
    old.resolve({items:[item('stale Owner A data')],next_before:null})
    await act(()=>{})
    assert.doesNotMatch(app.snapshot(),/stale Owner A data/)
    await app.update(a)
    assert.doesNotMatch(app.snapshot(),/visible only to B|stale Owner A data/)
  }finally{await app.unmount()}
})

test('plaintext send preserves immutable EventID and exact content after unknown ACK',async()=>{
  const sent=[]
  const app=await mount(port('send',{
    create:async value=>{
      sent.push({...value})
      if(sent.length===1)throw Error('server committed; ACK lost')
      return {id:1,...value}
    },
  }))
  try{
    await type(app,'输入内容','hello from iPhone')
    await click(app,'发送')
    assert.match(app.snapshot(),/发送未确认/)
    await click(app,'发送')
    assert.equal(sent.length,2)
    assert.deepEqual(sent[1],sent[0])
    assert.equal(sent[0].content,'hello from iPhone')
    assert.equal(sent[0].kind,'text/plain')
    assert.doesNotMatch(JSON.stringify(sent),/ciphertext|nonce|wrapped_key|ephemeral_key/)
    assert.equal(app.field('输入内容').props.value,'')
  }finally{await app.unmount()}
})

test('changed payload after unknown ACK requires explicit abandon and fresh EventID',async()=>{
  const sent=[]
  const app=await mount(port('retry',{
    create:async value=>{
      sent.push({...value})
      if(sent.length===1)throw Error('unknown result')
      return {id:2,...value}
    },
  }))
  try{
    await type(app,'输入内容','first')
    await click(app,'发送')
    await type(app,'输入内容','different')
    await click(app,'发送')
    assert.equal(sent.length,1)
    assert.match(app.snapshot(),/上一条发送回执仍未确认/)
    await click(app,'放弃待确认回执')
    await click(app,'发送')
    assert.equal(sent.length,2)
    assert.notEqual(sent[0].client_event_id,sent[1].client_event_id)
    assert.equal(sent[1].content,'different')
  }finally{await app.unmount()}
})

test('late success never erases a newer typed draft',async()=>{
  const ack=deferred()
  const app=await mount(port('delayed',{create:()=>ack.promise}))
  try{
    await type(app,'输入内容','before send')
    await click(app,'发送')
    await type(app,'输入内容','newer draft')
    ack.resolve({id:42})
    await act(()=>{})
    assert.equal(app.field('输入内容').props.value,'newer draft')
  }finally{await app.unmount()}
})

test('changing MIME kind clears selected CAS Node and cannot auto-send',async()=>{
  const sent=[]
  const owner=port('mime',{
    listDevices:async()=>({devices:[{device_id:deviceID,name:'iPhone',platform:'ios'}]}),
    create:async value=>{sent.push({...value});return {id:42,...value}},
  })
  const app=await mount(owner)
  try{
    await act(()=>{})
    await type(app,'发送范围',deviceID)
    await type(app,'内容类型','image')
    await type(app,'已上传的云端文件 ID','118')
    await type(app,'内容类型','file')
    assert.equal(app.field('已上传的云端文件 ID').props.value,'')
    assert.equal(app.button('发送').props.disabled,true)
    assert.equal(sent.length,0)
    await type(app,'已上传的云端文件 ID','119')
    await click(app,'发送')
    assert.equal(sent.length,1)
    assert.deepEqual({
      kind:sent[0].kind,content:sent[0].content,node_id:sent[0].node_id,
      target_device_id:sent[0].target_device_id,
    },{
      kind:'application/x-xdrive-node-ref',content:'asset:119',
      node_id:119,target_device_id:deviceID,
    })
  }finally{await app.unmount()}
})

test('directed Node with a mismatching content identity cannot offer Viewer',async()=>{
  const malformed=item('asset:118',{
    kind:'application/x-xdrive-node-ref',target_device_id:deviceID,node_id:119,
  })
  let opens=0
  const app=await mount(port('bad-viewer',{
    list:async()=>({items:[malformed],next_before:null}),
    openReferencedFile:async()=>{opens++},
  }))
  try{
    assert.match(app.snapshot(),/消息内容无效或文件引用不匹配/)
    assert.equal(app.buttons().filter(x=>x==='在文件 Viewer 中打开').length,0)
    assert.equal(opens,0)
  }finally{await app.unmount()}
})

test('valid Node only opens via explicit verified Viewer callback',async()=>{
  const valid=item('asset:118',{
    kind:'image/x-xdrive-node-ref',target_device_id:deviceID,node_id:118,
  })
  const opened=[]
  const app=await mount(port('good-viewer',{
    list:async()=>({items:[valid],next_before:null}),
    openReferencedFile:async(id,signal)=>{
      assert.equal(signal.aborted,false)
      opened.push(id)
    },
  }))
  try{
    assert.equal(opened.length,0)
    await click(app,'在文件 Viewer 中打开')
    assert.deepEqual(opened,[118])
  }finally{await app.unmount()}
})

test('permission denial preserves manually edited draft',async()=>{
  const app=await mount(port('paste',{readText:async()=>{throw Error('NotAllowedError')}}))
  try{
    await type(app,'输入内容','manual text remains')
    await click(app,'从系统剪贴板读取')
    assert.equal(app.field('输入内容').props.value,'manual text remains')
    assert.match(app.snapshot(),/浏览器未允许读取剪贴板/)
  }finally{await app.unmount()}
})

test('Owner switch cannot resurrect late OS pasteboard content',async()=>{
  const read=deferred()
  const a=port('paste-owner-a',{readText:()=>read.promise})
  const b=port('paste-owner-b')
  const app=await mount(a)
  try{
    await click(app,'从系统剪贴板读取')
    await app.update(b)
    read.resolve('stale pasteboard data')
    await act(()=>{})
    assert.doesNotMatch(app.snapshot(),/stale pasteboard data/)
  }finally{await app.unmount()}
})
