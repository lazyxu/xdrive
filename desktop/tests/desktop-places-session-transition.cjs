'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const main=fs.readFileSync(path.join(root,'desktop/src/main/index.cts'),'utf8')
const ast=ts.createSourceFile('index.cts',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const selected=['resetDesktopPlacesWebAuth','desktopPlacesWebOwnerStillCurrent',
  'desktopPlacesCurrentLANPin','ensureDesktopPlacesAgentLANPin',
  'ensureDesktopPlacesNetworkRoute']
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&
  n.name&&selected.includes(n.name.text))
assert.deepEqual(declarations.map(n=>n.name.text).sort(),[...selected].sort(),
  'test actual production Main functions, not copied stand-ins')
const body=[
  "let desktopPlacesWebPartition = 'xdrive-places-web-initial'",
  "let desktopPlacesWebGeneration = 0",
  "let desktopPlacesWebReady = null",
  "let desktopPlacesWebPending = null",
  "let desktopPlacesWebQueue = Promise.resolve()",
  "let desktopPlacesNetworkRoute = null",
  "let desktopPlacesAgentLANPin = null",
  "const desktopPlacesWebConfiguredPartitions = new Set()",
  ...declarations.map(n=>n.getText(ast)),
  "return {identity:desktopPlacesWebOwnerStillCurrent, route:ensureDesktopPlacesNetworkRoute,",
  "reset:resetDesktopPlacesWebAuth, pin:desktopPlacesCurrentLANPin,",
  "admit:ensureDesktopPlacesAgentLANPin, current:()=>({",
  "generation:desktopPlacesWebGeneration,partition:desktopPlacesWebPartition,",
  "network:desktopPlacesNetworkRoute,agentPIN:desktopPlacesAgentLANPin,",
  "queue:desktopPlacesWebQueue})}",
].join('\n')
const compiled=ts.transpileModule(body,{fileName:'places-session-transition.cts',
  reportDiagnostics:true,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>
  x.category===ts.DiagnosticCategory.Error),[])
const origin='https://192.168.7.8:8443',owner='session-owner'
class AgentIPCError extends Error{
  constructor(status){super('synthetic IPC status');this.status=status}
}
const id={origin,owner}
function harness({legacy=false,disabled=false,holdProxy=false}={}){
  const events=[],roots=[],routes=[]
  let seq=0,release,receipt={available:true,server:origin,
    username:owner,root_pem:'ca-original'}
  const state={connected:true,status:{configured:true,username:owner,
    server:origin,auth_status:'已登录',connection_ip:'192.168.7.8'}}
  const session={fromPartition:partition=>({
    async setProxy(value){events.push(['set-proxy',partition,value.mode])},
    async resolveProxy(url){return url.includes('api.map.baidu.com')
      ?'DIRECT':'PROXY 127.0.0.1:1122'},
    async closeAllConnections(){events.push(['close-connections',partition])},
    async clearStorageData(v){events.push(['clear-data',partition,
      v.storages.slice().sort().join(',')])},
  })}
  const dependencies={
    exports:{},session,agentState:state,AgentIPCError,
    requireAgentClient:()=>({async desktopMapLANTrust(){
      if(legacy)throw new AgentIPCError(404)
      if(disabled)throw new AgentIPCError(403)
      return receipt
    }}),
    privateLANOrigin:server=>server===origin
      ?{origin,ip:'192.168.7.8',port:8443}:null,
    approvedManualLANPin:()=>undefined,
    privateLANRoots:[],rejectedManualLANOrigins:new Set(),
    privateLANTrustStoreCorrupt:false,
    verifiedLANRootPEM:pem=>pem?.startsWith('ca-')
      ?{pem,sha256:'a'.repeat(64)}:null,
    probeWithTrustedLANRoot:async(_server,pem)=>{roots.push(pem);return 'verified-leaf'},
    xDriveResolveSecureBaiduMapTarget:server=>server===origin?{origin}:null,
    desktopPlacesSelectedRoute:(server,ip)=>server===origin&&
      /^192\.168\.7\.(8|9)$/.test(ip)?{origin,ip}:null,
    createDesktopPlacesPinnedRoute:async(_server,ip,valid)=>{
      if(holdProxy)await new Promise(resolve=>{release=resolve})
      const route={pacURL:'http://127.0.0.1:1122/pac',
        proxyDirective:'PROXY 127.0.0.1:1122',ip,closed:false,valid,
        close(){this.closed=true;events.push(['close-route',ip])},
        isActive(){return !this.closed&&valid()}}
      routes.push(route)
      return route
    },
    randomUUID:()=>String(++seq).padStart(36,'0'),
  }
  const f=new Function(...Object.keys(dependencies),compiled.outputText)(
    ...Object.values(dependencies))
  return {f,state,routes,roots,events,
    setReceipt:r=>{receipt=r},
    releaseProxy:()=>{assert.ok(release);release()},
    async drain(){await f.current().queue}}
}
test('actual Main rejects stale selected-IP route and retires its Cookie partition',async()=>{
  const h=harness(),f=h.f
  assert.equal(await f.route(id,0),true)
  assert.equal(h.routes[0].ip,'192.168.7.8')
  assert.equal(h.routes[0].isActive(),true)
  h.state.status.connection_ip='192.168.7.9'
  assert.equal(h.routes[0].isActive(),false)
  assert.equal(await f.route(id,0),false,
    'cannot silently point old Chromium partition to a new Agent IP')
  const prior=f.current().partition
  f.reset()
  assert.equal(h.routes[0].closed,true)
  assert.notEqual(f.current().partition,prior)
  await h.drain()
  assert.ok(h.events.some(v=>v[0]==='close-connections'&&v[1]===prior))
  assert.ok(h.events.some(v=>v[0]==='clear-data'&&v[1]===prior&&
    v[2]==='cookies,localstorage'))
  assert.equal(await f.route(id,f.current().generation),true)
  assert.equal(h.routes[1].ip,'192.168.7.9')
  assert.equal(h.routes[1].isActive(),true)
})
test('Owner switch and logout revoke the old Main route even if same Server stays',async()=>{
  const h=harness(),f=h.f
  assert.equal(await f.route(id,0),true)
  h.state.status.username='foreign-owner'
  assert.equal(f.identity(id),false)
  assert.equal(h.routes[0].isActive(),false)
  f.reset()
  await h.drain()
  assert.equal(h.routes[0].closed,true)
  assert.equal(f.current().network,null)
  assert.equal(f.current().agentPIN,null)
  assert.equal(await f.route(id,f.current().generation),false)
  h.state.connected=false
  assert.equal(f.identity({...id,owner:'foreign-owner'}),false)
})
test('late route setup cannot restore a canceled Owner/partition',async()=>{
  const h=harness({holdProxy:true}),f=h.f
  const pending=f.route(id,0)
  h.state.status.username='foreign-owner'
  f.reset()
  h.releaseProxy()
  assert.equal(await pending,false)
  assert.equal(h.routes[0].closed,true)
  assert.equal(f.current().network,null)
})
test('older Agent 404 never imports a CA; denied IPC cannot downgrade trust',async()=>{
  const old=harness({legacy:true})
  assert.equal(await old.f.admit(id),true)
  assert.equal(old.f.current().agentPIN,null)
  const revoked=harness({disabled:true})
  assert.equal(await revoked.f.admit(id),false)
  assert.equal(revoked.f.current().agentPIN,null)
})
test('CA rotation demands fresh verified pin and rejects foreign Owner receipt',async()=>{
  const h=harness(),f=h.f
  assert.equal(await f.admit(id),true)
  assert.deepEqual(h.roots,['ca-original'])
  h.setReceipt({available:true,server:origin,username:owner,root_pem:'ca-rotated'})
  assert.equal(await f.admit(id),true)
  assert.deepEqual(h.roots,['ca-original'])
  f.reset()
  await h.drain()
  assert.equal(await f.admit(id),true)
  assert.deepEqual(h.roots,['ca-original','ca-rotated'])
  assert.equal(f.pin(origin,owner).root_pem,'ca-rotated')
  f.reset()
  h.setReceipt({available:true,server:origin,username:'foreign',
    root_pem:'ca-foreign'})
  assert.equal(await f.admit(id),false)
  assert.equal(f.pin(origin,owner),undefined)
})

test('real publishAgentState closes both map windows on selected IP change',()=>{
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&
    n.name?.text==='publishAgentState')
  assert.ok(fn,'must exercise current Main publication path')
  const compiledPublish=ts.transpileModule(fn.getText(ast),{
    fileName:'publish-agent-state.cts',
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  const previous={connected:true,status:{configured:true,username:owner,
    server:origin,connection_ip:'192.168.7.8',auth_status:'已登录'}}
  const calls=[]
  const env={
    exports:{},initial:previous,JSON,
    desktopPlacesGuests:new Map([[9,true]]),
    desktopPlacesPending:null,desktopPlacesWebReady:null,desktopPlacesWebPending:null,
    secureBaiduMapWindow:{},
    closeDesktopPlacesGuests:()=>calls.push('close-guest'),
    closeSecureBaiduMapWindow:()=>calls.push('close-secure'),
    resetSourceRunNotificationState:()=>calls.push('reset-source'),
    notifyAgentTransition:()=>{},rebuildTrayMenu:()=>{},
    updateTaskbarOverlay:()=>{},updateTaskbarProgress:()=>{},
    mainWindow:null,
  }
  const run=new Function(...Object.keys(env),[
    'let agentState=initial',
    compiledPublish.outputText,
    'return next=>{publishAgentState(next);return agentState}',
  ].join('\n'))(...Object.values(env))
  run({connected:true,status:{...previous.status,connection_ip:'192.168.7.9'}})
  assert.deepEqual(calls,['close-guest','close-secure'])
})

test('successful explicit re-login retires old HTTPS map before seeding same Owner',()=>{
  const start=main.indexOf("ipcMain.handle('agent:login',")
  const stop=main.indexOf("ipcMain.handle('agent:logout',",start)
  assert.ok(start>=0&&stop>start)
  const flow=main.slice(start,stop)
  const accepted=flow.indexOf('if (result.ok) {')
  const close=flow.indexOf('closeDesktopPlacesGuests()',accepted)
  const secure=flow.indexOf('closeSecureBaiduMapWindow()',accepted)
  const seed=flow.indexOf('void seedDesktopPlacesWebAuth(server, username, password)',accepted)
  assert.ok(accepted>=0&&close>accepted&&secure>accepted&&seed>close&&seed>secure,
    'same-Owner HTTPS CA/re-login cannot reuse an old guest partition or Cookie')
})


// The real Agent also reports "needs re-login", "password change required"
// and "access denied". None may keep either map window alive; a valid paused
// sync, however, retains the Owner's authenticated map session.
test('published native Agent terminal auth states revoke both map surfaces',()=>{
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&
    n.name?.text==='publishAgentState')
  assert.ok(fn)
  const compiledPublish=ts.transpileModule(fn.getText(ast),{
    fileName:'publish-agent-revocation.cts',
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  const before={connected:true,status:{configured:true,username:owner,
    server:origin,connection_ip:'192.168.7.8',
    auth_status:'已登录',must_change_password:false}}
  const harness=()=>{
    const calls=[]
    const env={
      exports:{},initial:structuredClone(before),JSON,
      desktopPlacesGuests:new Map([[9,true]]),
      desktopPlacesPending:null,desktopPlacesWebReady:null,desktopPlacesWebPending:null,
      secureBaiduMapWindow:{},
      closeDesktopPlacesGuests:()=>calls.push('guest-closed'),
      closeSecureBaiduMapWindow:()=>calls.push('secure-closed'),
      resetSourceRunNotificationState:()=>{},
      notifyAgentTransition:()=>{},rebuildTrayMenu:()=>{},
      updateTaskbarOverlay:()=>{},updateTaskbarProgress:()=>{},
      mainWindow:null,
    }
    const run=new Function(...Object.keys(env),[
      'let agentState=initial',compiledPublish.outputText,
      'return next=>{publishAgentState(next);return agentState}',
    ].join('\n'))(...Object.values(env))
    return {run,calls}
  }
  for(const auth_status of [
    '未登录','需要重新登录','需要修改密码','访问被拒绝',
    '登录已过期','账户已禁用','未知状态',undefined,
  ]){
    const {run,calls}=harness()
    run({connected:true,status:{...before.status,auth_status}})
    assert.deepEqual(calls,['guest-closed','secure-closed'],
      'failed native auth status '+String(auth_status))
  }
  {
    const {run,calls}=harness()
    run({connected:true,status:{...before.status,must_change_password:true}})
    assert.deepEqual(calls,['guest-closed','secure-closed'])
  }
  {
    const {run,calls}=harness()
    run({connected:true,status:{...before.status,
      sync_status:'已暂停',paused:true}})
    assert.deepEqual(calls,[],'sync pause must not revoke valid login')
  }
  {
    const {run,calls}=harness()
    run({connected:true,status:{...before.status,
      connection_ip:'192.168.7.9'}})
    assert.deepEqual(calls,['guest-closed','secure-closed'],
      'old CA, CONNECT and cookies cannot survive Agent selected-IP change')
  }
  {
    const {run,calls}=harness()
    run({connected:true,status:{...before.status,username:'foreign-owner'}})
    assert.deepEqual(calls,['guest-closed','secure-closed'])
  }
})
