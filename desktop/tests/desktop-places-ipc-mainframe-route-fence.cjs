'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

// Exercise the actual Main IPC callbacks, not independently rewritten mocks.
const main=fs.readFileSync(path.resolve(__dirname,'../src/main/index.cts'),'utf8')
const ast=ts.createSourceFile('index.cts',main,ts.ScriptTarget.Latest,
  true,ts.ScriptKind.TS)
const helperNames=['desktopPlacesWebOwnerStillCurrent',
  'desktopPlacesGuestFrameAllowed']
const helpers=ast.statements.filter(node=>
  ts.isFunctionDeclaration(node)&&helperNames.includes(node.name?.text))
assert.deepEqual(helpers.map(node=>node.name.text).sort(),[...helperNames].sort())

const handlerNames=['desktop:places-embed-expected-owner',
  'desktop:open-baidu-map-secure']
const handlers=new Map()
function walk(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
    node.expression.expression.getText(ast)==='ipcMain'&&
    node.expression.name.text==='handle'&&
    ts.isStringLiteral(node.arguments[0])&&
    handlerNames.includes(node.arguments[0].text)){
    const key=node.arguments[0].text
    assert.equal(handlers.has(key),false,'IPC registered more than once: '+key)
    assert.ok(ts.isArrowFunction(node.arguments[1]),'expected production IPC arrow')
    handlers.set(key,node.arguments[1].getText(ast))
  }
  ts.forEachChild(node,walk)
}
walk(ast)
assert.deepEqual([...handlers.keys()].sort(),[...handlerNames].sort())
const snippets=[
  ...helpers.map(node=>node.getText(ast)),
  'const expectedOwnerHandler='+handlers.get(handlerNames[0]),
  'const secureOpenHandler='+handlers.get(handlerNames[1]),
]
const compiled=ts.transpileModule(snippets.join('\n'),{
  fileName:'places-ipc-frame-fence.cts',reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>
  x.category===ts.DiagnosticCategory.Error),[])

const origin='https://192.168.12.5:8443'
const owner='map-owner'
const canonical=origin+'/?desktop_places_embed=1#/app/gallery?section=places'
function harness(){
  const state={connected:true,status:{
    configured:true,username:owner,server:origin,
    auth_status:'已登录',must_change_password:false,
  }}
  const guests=new Map([[71,{owner,origin,scope:{kind:'all'}}]])
  const parent={webContents:{id:5,mainFrame:{url:'file:///desktop.html'}},
    isDestroyed:()=>false}
  let opened=0
  const env={
    // transpileModule emits a CommonJS module prologue in strict mode;
    // supply its module-local exports rather than changing real IPC logic.
    exports:{},
    desktopPlacesGuests:guests,agentState:state,
    xDriveResolveSecureBaiduMapTarget:server=>
      server===origin?{origin}:null,
    mainWindow:parent,
    openSecureBaiduMapWindow:scope=>{
      opened++
      return {ok:true,data:{scope}}
    },
  }
  const handlers=new Function(...Object.keys(env),
    compiled.outputText+'\nreturn {expectedOwnerHandler,secureOpenHandler}')(
    ...Object.values(env))
  function guestEvent(url=canonical){
    const frame={url}
    return {sender:{id:71,mainFrame:frame},senderFrame:frame}
  }
  return {...handlers,guestEvent,parent,state,guests,opened:()=>opened}
}

test('trusted canonical HTTPS map main frame receives only its live Owner',()=>{
  const h=harness()
  assert.equal(h.expectedOwnerHandler(h.guestEvent()),owner)
  assert.equal(h.expectedOwnerHandler(h.guestEvent(
    origin+'/index.html?desktop_places_embed=1#/app/gallery?section=places')),owner)
})

test('off-route or forged map main frame cannot read expected Owner',()=>{
  const h=harness()
  const invalid=[
    origin+'/?desktop_places_embed=1#/app/files',
    origin+'/?desktop_places_embed=1#/app/gallery',
    origin+'/?desktop_places_embed=1&untrusted=1#/app/gallery?section=places',
    origin+'/?desktop_places_embed=1&desktop_places_embed=1#/app/gallery?section=places',
    origin+'/admin?desktop_places_embed=1#/app/gallery?section=places',
    'https://192.168.12.6:8443/?desktop_places_embed=1#/app/gallery?section=places',
    'http://192.168.12.5:8443/?desktop_places_embed=1#/app/gallery?section=places',
    'about:blank',
  ]
  for(const url of invalid)
    assert.equal(h.expectedOwnerHandler(h.guestEvent(url)),null,url)
  const spoofed=h.guestEvent()
  spoofed.senderFrame={url:canonical}
  assert.equal(h.expectedOwnerHandler(spoofed),null,
    'nested or mismatched frame cannot claim its parent identity')
  h.guests.delete(71)
  assert.equal(h.expectedOwnerHandler(h.guestEvent()),null,
    'detached Guest cannot reuse its one-use identity')
})

test('native revoke, Owner switch and forced password change deny lookup',()=>{
  for(const patch of [
    {auth_status:'未登录'},{auth_status:'需要重新登录'},
    {auth_status:'需要修改密码'},{must_change_password:true},
    {username:'other-owner'},{server:'https://192.168.12.6:8443'},
    {configured:false},
  ]){
    const h=harness()
    Object.assign(h.state.status,patch)
    assert.equal(h.expectedOwnerHandler(h.guestEvent()),null,
      'must fail closed after '+JSON.stringify(patch))
  }
  const disconnected=harness()
  disconnected.state.connected=false
  assert.equal(disconnected.expectedOwnerHandler(disconnected.guestEvent()),null)
})

test('only trusted Desktop main frame can request independent secure map',()=>{
  const h=harness()
  const event={sender:h.parent.webContents,
    senderFrame:h.parent.webContents.mainFrame}
  const scope={kind:'album',albumId:3}
  assert.deepEqual(h.secureOpenHandler(event,scope),
    {ok:true,data:{scope}})
  assert.equal(h.opened(),1)
  const denied=[
    {sender:h.parent.webContents,senderFrame:{url:'file:///desktop.html'}},
    {sender:{id:999,mainFrame:event.senderFrame},senderFrame:event.senderFrame},
  ]
  for(const forged of denied){
    const result=h.secureOpenHandler(forged,scope)
    assert.equal(result.ok,false)
    assert.equal(result.error.code,'map_owner_denied')
  }
  assert.equal(h.opened(),1,'unauthorized frames must never open a window')
})
