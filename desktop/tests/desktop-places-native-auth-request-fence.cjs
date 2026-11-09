'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.cts'), 'utf8')
const ast = ts.createSourceFile('index.cts', main, ts.ScriptTarget.Latest,
  true, ts.ScriptKind.TS)
const selected = ['desktopPlacesWebOwnerStillCurrent',
  'configureDesktopPlacesWebSession']
const declarations = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && selected.includes(node.name?.text))
assert.deepEqual(declarations.map(fn => fn.name.text).sort(), [...selected].sort(),
  'exercise the production Main auth and HTTPS partition request handlers')
const transpiled = ts.transpileModule(declarations.map(fn => fn.getText(ast)).join('\n'),
  {fileName:'desktop-places-native-auth-request-fence.cts',
    reportDiagnostics:true, compilerOptions:{
      module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}})
assert.deepEqual((transpiled.diagnostics || []).filter(d =>
  d.category === ts.DiagnosticCategory.Error), [])

const origin = 'https://192.168.7.8:8443'
const otherOrigin = 'https://192.168.7.9:8443'
const owner = 'current-owner'
const partition = 'xdrive-places-web-test'
const identity = {owner, origin}

function harness({bound = identity, deferredCertificate = false} = {}) {
  let request, certificate, completeVerify, certificateCalls = 0
  const state = {connected:true,status:{
    configured:true, username:owner, server:origin, auth_status:'已登录',
    must_change_password:false, connection_ip:'',
  }}
  const placesSession = {
    setPermissionRequestHandler(){},
    setPermissionCheckHandler(){},
    webRequest:{onBeforeRequest(fn){request = fn}},
    setCertificateVerifyProc(fn){certificate = fn},
  }
  const env = {
    exports:{}, agentState:state, desktopPlacesWebPartition:partition,
    desktopPlacesWebGeneration:1, desktopPlacesWebReady:null,
    desktopPlacesWebPending:bound && {...bound,promise:Promise.resolve(true)},
    desktopPlacesWebConfiguredPartitions:new Set(),
    desktopPlacesNetworkRoute:null,
    session:{fromPartition:()=>placesSession},
    xDriveResolveSecureBaiduMapTarget:server =>
      [origin,otherOrigin].includes(server) ? {origin:server} : null,
    placesGuestIPRequestAllowed:()=>true,
    privateLANOrigin:server => server===origin
      ? {origin,ip:'192.168.7.8',port:8443} : null,
    requiresApprovedLANPin:()=>false,
    approvedManualLANPin:()=>undefined,
    desktopPlacesCurrentLANPin:()=>({sha256:'pin',root_pem:'test-ca'}),
    privateLANTrustStoreCorrupt:false,
    rejectedManualLANOrigins:new Set(),
    verifyDesktopPlacesLANCertificate:(_request,_pin,_origin,stillCurrent) => {
      certificateCalls++
      if (!deferredCertificate) return Promise.resolve(stillCurrent()?0:-2)
      return new Promise(resolve => {
        completeVerify = () => resolve(stillCurrent()?0:-2)
      })
    },
  }
  const configure = new Function(...Object.keys(env),
    transpiled.outputText + '\nreturn configureDesktopPlacesWebSession')(
    ...Object.values(env))
  configure(partition)
  assert.equal(typeof request, 'function')
  assert.equal(typeof certificate, 'function')
  return {
    state, 
    request(url = 'https://api.map.baidu.com/v3/?qt=tile') {
      let result
      request({url}, response => {result=response})
      return result
    },
    certificate:() => new Promise(resolve =>
      certificate({hostname:'192.168.7.8'}, resolve)),
    completeVerify:() => {
      assert.equal(typeof completeVerify,'function')
      completeVerify()
    },
    certificateCalls:() => certificateCalls,
  }
}

test('live native Owner allows browser requests and verified LAN TLS', async () => {
  const h = harness()
  assert.deepEqual(h.request(), {cancel:false})
  assert.deepEqual(h.request(origin+'/api/v1/auth/desktop-map/session'), {cancel:false})
  assert.equal(await h.certificate(), 0)
  assert.equal(h.certificateCalls(), 1)
})

test('native auth loss denies the existing Cookie partition before state-close cleanup', async () => {
  for (const patch of [
    {auth_status:'未登录'}, {auth_status:'需要重新登录'},
    {auth_status:'需要修改密码'}, {auth_status:'访问被拒绝'},
    {auth_status:'登录已过期'}, {auth_status:'账户已禁用'},
    {auth_status:undefined}, {must_change_password:true},
    {configured:false}, {username:''}, {username:'other-owner'},
  ]) {
    const h = harness()
    Object.assign(h.state.status, patch)
    assert.deepEqual(h.request(), {cancel:true}, JSON.stringify(patch))
    assert.deepEqual(h.request(origin+'/api/v1/auth/desktop-map/session'),
      {cancel:true}, JSON.stringify(patch))
    assert.equal(await h.certificate(), -2, JSON.stringify(patch))
    assert.equal(h.certificateCalls(), 0, 'must not validate stale CA')
  }
  const disconnected = harness()
  disconnected.state.connected=false
  assert.deepEqual(disconnected.request(),{cancel:true})
  assert.equal(await disconnected.certificate(),-2)
})

test('new valid Owner or Origin cannot borrow the previous partition', async () => {
  const foreign = harness()
  foreign.state.status.username='other-owner'
  assert.deepEqual(foreign.request(),{cancel:true})
  assert.equal(await foreign.certificate(),-2)
  const switchedServer = harness()
  switchedServer.state.status.server=otherOrigin
  assert.deepEqual(switchedServer.request(),{cancel:true})
  // A non-matching hostname is delegated to standard Chromium TLS, while
  // the partition request filter already blocks all requests.
  assert.equal(await switchedServer.certificate(),-3)
  const orphan = harness({bound:null})
  assert.deepEqual(orphan.request(),{cancel:true})
  assert.equal(await orphan.certificate(),-2)
})

test('in-flight CA proof denies a late native revoke', async () => {
  const h = harness({deferredCertificate:true})
  const pending = h.certificate()
  assert.equal(h.certificateCalls(),1)
  h.state.status.auth_status='需要重新登录'
  h.completeVerify()
  assert.equal(await pending,-2)
  assert.deepEqual(h.request(),{cancel:true})
})

test('all map embed, attach and independent-scope IPC gates recheck native auth', () => {
  const cases = [
    ["win.webContents.on('will-attach-webview'", "win.webContents.on('did-attach-webview'"],
    ["ipcMain.handle('desktop:prepare-places-embed'", "ipcMain.handle('desktop:places-embed-consume'"],
    ["ipcMain.handle('desktop:places-embed-consume'", "ipcMain.handle('desktop:places-embed-expected-owner'"],
    ["ipcMain.handle('desktop:places-embed-expected-owner'", "ipcMain.handle('desktop:open-baidu-map-secure'"],
    ["ipcMain.handle('desktop:consume-baidu-map-scope'", "ipcMain.handle('desktop:open-external'"],
  ]
  for (const [startMarker,endMarker] of cases) {
    const start=main.indexOf(startMarker)
    const end=main.indexOf(endMarker,start+startMarker.length)
    assert.ok(start>=0 && end>start, 'expected production gate '+startMarker)
    assert.match(main.slice(start,end),/desktopPlacesWebOwnerStillCurrent\(/,
      'native auth must be checked before exposing map scope: '+startMarker)
  }
})
