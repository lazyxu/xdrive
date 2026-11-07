'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const root=path.resolve(__dirname,'../..')
const main=fs.readFileSync(path.join(root,'desktop/src/main/index.cts'),'utf8')
const parsed=ts.createSourceFile('index.cts',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const names=['desktopPlacesCurrentLANPin','ensureDesktopPlacesAgentLANPin']
const parts=parsed.statements.filter(node=>ts.isFunctionDeclaration(node)&&
  node.name&&names.includes(node.name.text)).map(node=>node.getText(parsed))
assert.equal(parts.length,2,'execute the actual Main native CA-admission helpers')
const compiled=ts.transpileModule('let desktopPlacesAgentLANPin=null;\n'+parts.join('\n'),{
    fileName:'index.cts',
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText

const origin='https://192.168.2.4:8443'
const owner='owner'
const identity={origin,owner}
class AgentIPCError extends Error{
  constructor(status){super('synthetic IPC failure');this.status=status}
}
function makeHarness({receipt,agentError=null,rootOK=true,probeOK=true,
  blocked=false,corrupt=false,switchOwner=false,withStoredPin=false}={}){
  const state={connected:true,status:{configured:true,username:owner,
    server:origin,auth_status:'已登录'}}
  let calls=0,probes=0
  const stored=withStoredPin?{
    source:'user-approved-lan',server:origin,username:'',domain:'',
    root_pem:'trusted-manual',sha256:'manual'
  }:undefined
  const bindings={
    exports:{},module:{exports:{}},AgentIPCError,
    privateLANOrigin:server=>server===origin?{origin,ip:'192.168.2.4',port:8443}:null,
    privateLANRoots:[],
    approvedManualLANPin:()=>stored,
    rejectedManualLANOrigins:new Set(blocked?[origin]:[]),
    privateLANTrustStoreCorrupt:corrupt,
    desktopPlacesWebOwnerStillCurrent:expected=>state.connected &&
      state.status.configured===true&&state.status.username===expected.owner&&
      state.status.server===expected.origin&&state.status.auth_status==='已登录',
    requireAgentClient:()=>({desktopMapLANTrust:async()=>{
      calls++
      if(agentError)throw agentError
      return receipt
    }}),
    verifiedLANRootPEM:value=>rootOK&&value==='synthetic-validated-public-ca'
      ?{pem:value,sha256:'a'.repeat(64)}:null,
    probeWithTrustedLANRoot:async(server,pem)=>{
      probes++
      assert.equal(server,origin)
      assert.equal(pem,'synthetic-validated-public-ca')
      if(switchOwner)state.status.username='foreign'
      return probeOK?'fixture-version':null
    },
  }
  const keys=Object.keys(bindings)
  const admission=new Function(...keys,compiled+
    '\nreturn ({get:()=>desktopPlacesAgentLANPin,'+
    'lookup:desktopPlacesCurrentLANPin,admit:ensureDesktopPlacesAgentLANPin})'
  )(...keys.map(k=>bindings[k]))
  return {admission,state,calls:()=>calls,probes:()=>probes}
}

const valid={available:true,server:origin,username:owner,
  root_pem:'synthetic-validated-public-ca'}

test('native public CA is admitted only for current authenticated Owner/IP and remains memory-only',async()=>{
  const h=makeHarness({receipt:valid})
  assert.equal(await h.admission.admit(identity),true)
  assert.equal(h.calls(),1)
  assert.equal(h.probes(),1)
  const pin=h.admission.lookup(origin,owner)
  assert.equal(pin?.sha256,'a'.repeat(64))
  assert.equal(pin?.root_pem,valid.root_pem)
  assert.equal(h.admission.lookup(origin,'foreign'),undefined)
  assert.equal(h.admission.lookup('https://192.168.2.5:8443',owner),undefined)
  assert.equal(await h.admission.admit(identity),true)
  assert.equal(h.calls(),1,'current Owner reuses one memory-only verified pin')
})

test('Desktop revocation and malformed CA override all native trust recovery',async()=>{
  for(const settings of [{blocked:true},{corrupt:true},{rootOK:false},{probeOK:false},
    {switchOwner:true}]){
    const h=makeHarness({receipt:valid,...settings})
    assert.equal(await h.admission.admit(identity),false)
    assert.equal(h.admission.get(),null)
  }
})

test('native Agent receipt cannot replace Owner, Server or identity after asynchronous probe',async()=>{
  for(const proof of [
    {...valid,server:'https://192.168.2.5:8443'},
    {...valid,username:'other-owner'},
    {...valid,root_pem:'not-a-valid-CA'},
    {available:true,server:origin,username:owner},
  ]){
    const h=makeHarness({receipt:proof})
    assert.equal(await h.admission.admit(identity),false)
    assert.equal(h.admission.get(),null)
  }
})

test('system-CA and legacy missing Agent API preserve default verified Chromium TLS only',async()=>{
  const absent=makeHarness({receipt:{available:false}})
  assert.equal(await absent.admission.admit(identity),true)
  assert.equal(absent.admission.get(),null)
  assert.equal(absent.probes(),0)
  const old=makeHarness({agentError:new AgentIPCError(404)})
  assert.equal(await old.admission.admit(identity),true)
  assert.equal(old.admission.get(),null)
  const fail=makeHarness({agentError:new AgentIPCError(403)})
  assert.equal(await fail.admission.admit(identity),false)
  assert.equal(fail.admission.get(),null)
})

test('an already-approved Desktop CA never silently replaces with an Agent CA',async()=>{
  const h=makeHarness({receipt:valid,withStoredPin:true})
  assert.equal(await h.admission.admit(identity),true)
  assert.equal(h.calls(),0)
  assert.equal(h.admission.lookup(origin,owner)?.root_pem,'trusted-manual')
})

test('public CA IPC stays in Main only, not preloads, Renderer, or third-party SDK',()=>{
  const read=file=>fs.readFileSync(path.join(root,file),'utf8')
  assert.match(main,/desktopMapLANTrust\(\)/)
  assert.match(read('desktop/src/main/agent_client.cts'),
    /'GET', '\/v1\/cloud\/desktop-map-lan-trust'/)
  for(const file of ['desktop/src/preload/index.cts','desktop/src/preload/places_embed.cts',
    'desktop/src/renderer/App.tsx','web/src/App.tsx']){
    assert.doesNotMatch(read(file),/desktop-map-lan-trust|desktopMapLANTrust/,
      'private LAN CA must not enter '+file)
  }
})
