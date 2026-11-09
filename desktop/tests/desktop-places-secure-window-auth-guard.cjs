'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const main = fs.readFileSync(path.resolve(
  __dirname, '../src/main/index.cts'), 'utf8')
const ast = ts.createSourceFile('index.cts', main, ts.ScriptTarget.Latest,
  true, ts.ScriptKind.TS)
const names = ['desktopPlacesWebOwnerStillCurrent', 'openSecureBaiduMapWindow']
const functions = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.deepEqual(functions.map(fn => fn.name.text).sort(), [...names].sort(),
  'run real Desktop Main authentication and independent map-window entry')
const compiled = ts.transpileModule(
  functions.map(fn => fn.getText(ast)).join('\n'), {
    fileName: 'desktop-places-secure-window-auth-guard.cts',
    reportDiagnostics: true,
    compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
  })
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error), [])

const origin = 'https://192.168.7.8:8443'
const owner = 'verified-owner'
const scope = {albumKey:'all'}
const release = {release:true}

function fixture(patch = {}) {
  const state = {connected:true, status:{
    configured:true, username:owner, server:origin,
    auth_status:'已登录', must_change_password:false, ...patch,
  }}
  let requested = 0, finishRelease, revoked = 0
  const env = {
    exports:{}, agentState:state,
    xDriveResolveSecureBaiduMapTarget:server =>
      server === origin ? {origin} : null,
    xDriveParseDesktopBaiduMapScope:raw =>
      raw && raw.albumKey === 'all' ? raw : null,
    xDriveReleasedBaiduChildOrigin:(response,server) =>
      response?.release && server === origin
        ? 'https://baidu-child.example' : null,
    requireAgentClient:() => ({mediaBaiduJSAPI4Release() {
      requested++
      return new Promise(resolve => {finishRelease=resolve})
    }}),
    closeSecureBaiduMapWindow:() => {revoked++},
    // These test cases must exit before allocating Electron BrowserWindows.
    BrowserWindow:class {
      constructor() {throw new Error('stale secure map window was created')}
    },
  }
  const open = new Function(...Object.keys(env),
    compiled.outputText + '\nreturn openSecureBaiduMapWindow')(
    ...Object.values(env))
  return {state, open, requested:() => requested,
    finish:value => {assert.ok(finishRelease);finishRelease(value)},
    revoked:() => revoked}
}

test('independent map does not reopen or request a release on invalid Agent auth', async () => {
  for (const patch of [
    {auth_status:'未登录'},
    {auth_status:'需要重新登录'},
    {auth_status:'需要修改密码'},
    {auth_status:'访问被拒绝'},
    {auth_status:'登录已过期'},
    {auth_status:'账户已禁用'},
    {auth_status:undefined},
    {must_change_password:true},
    {configured:false},
    {username:''},
  ]) {
    const h = fixture(patch)
    const pending = h.open(scope)
    // If this regresses, release the synthetic Agent promise so the test
    // fails deterministically rather than leaving a dangling request.
    if (h.requested()) {
      h.finish(release)
      await assert.rejects(pending, /stale secure map window/)
    }
    assert.equal(h.requested(), 0, JSON.stringify(patch))
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'map_login_required')
  }
})

test('async signed-SDK release cannot resurrect an Owner with lost native auth', async () => {
  for (const patch of [
    {auth_status:'未登录'},
    {auth_status:'需要重新登录'},
    {auth_status:'访问被拒绝'},
    {must_change_password:true},
    {configured:false},
    {username:'other-owner'},
    {server:'https://192.168.7.9:8443'},
  ]) {
    const h = fixture()
    const pending = h.open(scope)
    assert.equal(h.requested(), 1, 'an initially valid Agent starts release fetch')
    Object.assign(h.state.status, patch)
    h.finish(release)
    const result = await pending
    assert.equal(result.ok, false, JSON.stringify(patch))
    assert.equal(result.error.code, 'map_signed_child_unavailable')
    assert.equal(h.revoked(), 1, 'stale release closes old map handoff')
  }
})

test('normal paused sync does not masquerade as logout before map admission', async () => {
  const h = fixture({paused:true, sync_status:'已暂停'})
  const pending = h.open(scope)
  assert.equal(h.requested(), 1)
  // A later real auth-loss event still invalidates the in-flight release.
  h.state.status.auth_status = '登录已过期'
  h.finish(release)
  const result = await pending
  assert.equal(result.error.code, 'map_signed_child_unavailable')
})

test('independent map and Guest share native auth predicate after async release', () => {
  const independent = functions.find(fn => fn.name.text === 'openSecureBaiduMapWindow')
  assert.match(independent.getText(ast),
    /const sameOwner = \(\) => desktopPlacesWebOwnerStillCurrent\(\{/)
  const native = functions.find(fn =>
    fn.name.text === 'desktopPlacesWebOwnerStillCurrent')
  assert.match(native.getText(ast), /status\.auth_status === '已登录'/)
  assert.match(native.getText(ast), /status\.must_change_password !== true/)
})
