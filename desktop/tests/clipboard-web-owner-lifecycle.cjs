'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const React=require('react'),Renderer=require('react-test-renderer')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const previousWindow=globalThis.window,previousDocument=globalThis.document
globalThis.window={setInterval:()=>1,clearInterval:()=>{},isSecureContext:true}
globalThis.document={visibilityState:'visible'}
test.after(()=>{globalThis.window=previousWindow;globalThis.document=previousDocument})
function transpile(file,injected,jsx=false){
 const text=read(file),result=ts.transpileModule(text,{
  fileName:file,reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
    jsx:ts.JsxEmit.ReactJSX}})
 assert.deepEqual((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
   .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
 const mod={exports:{}}
 new Function('module','exports','require',result.outputText)(mod,mod.exports,name=>{
  if(name==='react')return React
  if(name==='react/jsx-runtime')return require('react/jsx-runtime')
  if(Object.hasOwn(injected,name))return injected[name]
  throw Error('unexpected shared Clipboard dependency: '+name)
 })
 return mod.exports
}
const fence=transpile('ui/shared/src/clipboard-action-fence.ts',{})
const mui=Object.fromEntries(
 ['Alert','Box','Button','Card','Divider','Stack','TextField','Typography',
  'MenuItem','FormControlLabel','Switch'].map(x=>[
  x,({children,...props})=>React.createElement(x,props,children)]))
const Page=transpile('ui/shared/src/mui/ClipboardPage.tsx',{
 '@mui/material':mui,'../clipboard-action-fence':fence,
 './ClipboardFileNodePicker':{ClipboardFileNodePicker:()=>null},
},true).XDriveClipboardPage
async function act(fn){await Renderer.act(async()=>{fn();await Promise.resolve()})}
async function mounted(port){
 let renderer
 await act(()=>{renderer=Renderer.create(React.createElement(Page,{port}))})
 return {
  renderer,
  update:p=>act(()=>renderer.update(React.createElement(Page,{port:p}))),
  unmount:()=>act(()=>renderer.unmount()),
  button:name=>{
   const item=renderer.root.findAllByType('Button').find(x=>x.props.children===name)
   assert.ok(item,'missing Clipboard button: '+name);return item
  },
  field:name=>{
   const item=renderer.root.findAllByType('TextField').find(x=>x.props.label===name)
   assert.ok(item,'missing Clipboard field: '+name);return item
  },
  snapshot:()=>JSON.stringify(renderer.toJSON()),
 }
}
function port(scope,additional={}){
 return {ownerScopeKey:scope,
  list:async()=>({items:[],next_before:null}),create:async item=>({id:1,...item}),
  remove:async()=>{},clear:async()=>{},copyText:async()=>{},
  ...additional}
}
test('current Owner Clipboard renders immediately without unlock or password',async()=>{
 const ui=await mounted(port('ownerA'))
 assert.doesNotMatch(ui.snapshot(),/解锁加密剪贴板|剪贴板口令|独立口令|加密发送/)
 assert.match(ui.snapshot(),/剪贴板内容不会端到端加密/)
 assert.ok(ui.field('输入内容'))
 await ui.unmount()
})
test('manual send passes plaintext payload, UUID and kind to exact Owner port',async()=>{
 const calls=[],ui=await mounted(port('ownerA',{
  create:async item=>{calls.push(item);return {id:3,...item}},
 }))
 await act(()=>ui.field('输入内容').props.onChange({target:{value:'你好 clipboard'}}))
 await act(()=>ui.button('发送').props.onClick())
 assert.equal(calls.length,1)
 assert.equal(calls[0].content,'你好 clipboard')
 assert.equal(calls[0].kind,'text/plain')
 assert.match(calls[0].client_event_id,/^[0-9a-f-]{36}$/i)
 assert.equal('ciphertext' in calls[0],false)
 await ui.unmount()
})
test('Owner remount wipes old visible history and draft instead of unlocking',async()=>{
 const a=port('ownerA',{list:async()=>({items:[{
  id:2,client_event_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  kind:'text/plain',content:'Owner A secret',created_at:new Date().toISOString(),
  expires_at:new Date(Date.now()+10000).toISOString()}],next_before:null})})
 const b=port('ownerB')
 const ui=await mounted(a)
 assert.match(ui.snapshot(),/Owner A secret/)
 await act(()=>ui.field('输入内容').props.onChange({target:{value:'A private draft'}}))
 await ui.update(b)
 assert.doesNotMatch(ui.snapshot(),/Owner A secret|A private draft/)
 assert.equal(ui.field('输入内容').props.value,'')
 await ui.unmount()
})
test('unknown send ACK retries exact same EventID and plaintext, no new payload',async()=>{
 const attempts=[],ui=await mounted(port('ownerA',{
  create:async item=>{
   attempts.push({...item})
   if(attempts.length===1)throw Error('transport ACK unknown')
   return {id:3,...item}
  },
 }))
 await act(()=>ui.field('输入内容').props.onChange({target:{value:'retry me'}}))
 await act(()=>ui.button('发送').props.onClick())
 await act(()=>ui.button('发送').props.onClick())
 assert.equal(attempts.length,2)
 assert.deepEqual(attempts[0],attempts[1])
 await ui.unmount()
})
