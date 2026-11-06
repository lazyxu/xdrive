'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const {randomUUID}=require('node:crypto')
const ts=require('typescript')

const root=path.resolve(__dirname,'../..')
function loadRealMainAuthFlow({probeOK=true,grantOK=true,onProbe}={}) {
  const source=fs.readFileSync(path.join(root,'desktop/src/main/index.cts'),'utf8')
  const start=source.indexOf('type DesktopPlacesWebIdentity = ')
  const end=source.indexOf('function closeDesktopPlacesGuests()',start)
  assert.ok(start>0&&end>start,'execute actual Main Cookie/cache flow')
  const compiled=ts.transpileModule(source.slice(start,end),{
    fileName:'desktop/src/main/index.cts',
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const stats={probes:0,grants:0,redeems:0,clears:0}
  const owner={origin:'https://drive.example.test:8443',owner:'owner'}
  const connection={connected:true,status:{
    configured:true,username:'owner',server:owner.origin,auth_status:'已登录',
  }}
  const jar={
    clearStorageData:async()=>{stats.clears++},
    closeAllConnections:async()=>{},
    setPermissionRequestHandler:()=>{},
    setPermissionCheckHandler:()=>{},
    setCertificateVerifyProc:()=>{},
    webRequest:{onBeforeRequest:()=>{}},
    cookies:{get:async()=>[{httpOnly:true,secure:true}]},
    fetch:async(url,opts)=>{
      assert.equal(opts.credentials,'include')
      assert.equal(opts.redirect,'error')
      assert.equal(opts.headers.Origin,owner.origin)
      if(url.endsWith('/api/v1/auth/desktop-map/session')){
        stats.probes++
        assert.equal(opts.headers['X-XDrive-Browser-Owner'],owner.owner)
        if(onProbe) onProbe(connection)
        return {ok:probeOK,json:async()=>({username:owner.owner,browser_session:true})}
      }
      if(url.endsWith('/api/v1/auth/desktop-map/redeem')){
        stats.redeems++
        return {ok:true,json:async()=>({
          username:owner.owner,browser_session:true,refresh_token:'',
        })}
      }
      throw Error('unexpected browser request: '+url)
    },
  }
  const sandbox={
    // TypeScript's CommonJS transpiler emits __esModule on exports.
    exports:{},module:{exports:{}},
    Promise,AbortSignal,randomUUID,
    privateLANOrigin:()=>null,
    agentState:connection,
    session:{fromPartition:name=>{
      assert.match(name,/^xdrive-places-web-[0-9a-f-]{36}$/)
      return jar
    }},
    xDriveResolveSecureBaiduMapTarget:server=>({origin:new URL(server).origin}),
    requireAgentClient:()=>({desktopMapGuestGrant:async()=>{
      stats.grants++
      if(!grantOK) throw Error('native grant revoked')
      return {ticket:'a'.repeat(64),username:owner.owner,expires_in:30}
    }}),
    securePasswordStorageAvailable:()=>false,
    loginHistory:{profiles:[]},
    findLoginProfile:()=>null,
  }
  const exports=vm.runInNewContext(compiled.outputText+
    '\n({ensureDesktopPlacesWebAuth,setReady:v=>{desktopPlacesWebReady=v},getReady:()=>desktopPlacesWebReady})',
    sandbox)
  return {auth:exports,stats,owner,connection}
}

test('stale cached browser Cookie triggers a fresh native grant on Retry',async()=>{
  const {auth,stats,owner}=loadRealMainAuthFlow({probeOK:false})
  auth.setReady(owner)
  assert.equal(await auth.ensureDesktopPlacesWebAuth(owner),true)
  assert.equal(stats.probes,1)
  assert.equal(stats.clears,1)
  assert.equal(stats.grants,1)
  assert.equal(stats.redeems,1)
  assert.equal(auth.getReady().owner,'owner')
})

test('valid Cookie is reused after Server verification without rotation',async()=>{
  const {auth,stats,owner}=loadRealMainAuthFlow({probeOK:true})
  auth.setReady(owner)
  assert.equal(await auth.ensureDesktopPlacesWebAuth(owner),true)
  assert.equal(stats.probes,1)
  assert.equal(stats.clears,0)
  assert.equal(stats.grants,0)
  assert.equal(stats.redeems,0)
})

test('revoked Cookie and invalid native grant cannot reuse a stale ready state',async()=>{
  const {auth,stats,owner}=loadRealMainAuthFlow({probeOK:false,grantOK:false})
  auth.setReady(owner)
  assert.equal(await auth.ensureDesktopPlacesWebAuth(owner),false)
  assert.equal(auth.getReady(),null)
  assert.equal(stats.grants,1)
  assert.ok(stats.clears>=1)
})

test('Owner change during Cookie probe invalidates cached ready state',async()=>{
  const {auth,stats,owner}=loadRealMainAuthFlow({
    probeOK:true,onProbe:state=>{state.status.username='another-owner'},
  })
  auth.setReady(owner)
  assert.equal(await auth.ensureDesktopPlacesWebAuth(owner),false)
  assert.equal(auth.getReady(),null)
  assert.equal(stats.grants,0)
  assert.ok(stats.clears>=1)
})
