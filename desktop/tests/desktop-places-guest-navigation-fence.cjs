'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.cts'), 'utf8')
const ast = ts.createSourceFile('index.cts', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const selected = [
  'desktopPlacesGuestFrameAllowed',
  'desktopPlacesWebOwnerStillCurrent',
  'desktopPlacesGuestNavigationAllowed',
]
const functions = ast.statements.filter(stmt =>
  ts.isFunctionDeclaration(stmt) && selected.includes(stmt.name?.text))
assert.deepEqual(functions.map(fn => fn.name.text).sort(), [...selected].sort(),
  'execute production Main URL and current-Owner predicates, not reimplemented mocks')
const transpiled = ts.transpileModule(functions.map(fn => fn.getText(ast)).join('\n'), {
  fileName: 'desktop-places-guest-navigation-fence.cts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((transpiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error), [])

const origin = 'https://192.168.7.8:8443'
const owner = 'guest-owner'
const route = '#/app/gallery?section=places'
const simple = origin + '/?desktop_places_embed=1' + route

function fixture() {
  const state = {connected:true,status:{
    configured:true, username:owner, server:origin, auth_status:'已登录',
  }}
  // TS CommonJS output writes to exports even when functions are invoked
  // directly from this source-executed harness; supply a local module target.
  const run = new Function('exports', 'agentState', 'xDriveResolveSecureBaiduMapTarget',
    transpiled.outputText + '\nreturn {frame:desktopPlacesGuestFrameAllowed,' +
    'navigate:desktopPlacesGuestNavigationAllowed}')
  const f = run({}, state, server => server === origin ? {origin} : null)
  return {state, ...f}
}

test('the default map and signed isolated-mode handoff remain valid navigation', () => {
  const {frame, navigate} = fixture()
  const identity = {owner, origin}
  const allowed = [
    simple,
    origin + '/index.html?desktop_places_embed=1' + route,
    origin + '/?desktop_places_embed=1&places_map_mode=prototype' + route,
    origin + '/?desktop_places_embed=1&places_map_mode=isolated' +
      '&places_map_scope_required=1&places_map_handoff=' + 'a'.repeat(64) + route,
  ]
  for (const url of allowed) {
    assert.equal(frame(url, origin), true, url)
    assert.equal(navigate(url, identity), true, url)
  }
})

test('same-Origin but non-map navigations and hostile redirects are denied', () => {
  const {navigate} = fixture()
  const identity = {owner, origin}
  const denied = [
    origin + '/?desktop_places_embed=1&unreviewed=1' + route,
    origin + '/?desktop_places_embed=1&desktop_places_embed=1' + route,
    origin + '/?desktop_places_embed=0' + route,
    origin + '/?desktop_places_embed=1#/app/files',
    origin + '/?desktop_places_embed=1#/app/gallery?section=files',
    origin + '/admin?desktop_places_embed=1' + route,
    origin + '/api/v1/files?desktop_places_embed=1' + route,
    origin + '/?desktop_places_embed=1&places_map_mode=other' + route,
    origin + '/?desktop_places_embed=1&places_map_scope_required=0' + route,
    origin + '/?desktop_places_embed=1&places_map_handoff=' + 'b'.repeat(63) + route,
    origin + '/?desktop_places_embed=1&places_map_handoff=' + 'g'.repeat(64) + route,
    origin + '/?desktop_places_embed=1&places_map_mode=isolated&places_map_mode=prototype' + route,
    'https://elsewhere.example/?desktop_places_embed=1' + route,
    'http://192.168.7.8:8443/?desktop_places_embed=1' + route,
    'https://192.168.7.8:8444/?desktop_places_embed=1' + route,
    'https://login:secret@192.168.7.8:8443/?desktop_places_embed=1' + route,
    simple + 'x'.repeat(4096),
    null, {}, undefined,
  ]
  for (const url of denied)
    assert.equal(navigate(url, identity), false, String(url).slice(0, 120))
})

test('Owner switch, logout, expired Agent, disabled account and Server change revoke navigation', () => {
  const identity = {owner, origin}
  for (const update of [
    state => { state.connected = false },
    state => { state.status.configured = false },
    state => { state.status.username = 'other-owner' },
    state => { state.status.auth_status = '登录已过期' },
    state => { state.status.auth_status = '账户已禁用' },
    state => { state.status.auth_status = '需要重新登录' },
    state => { state.status.auth_status = '需要修改密码' },
    state => { state.status.auth_status = '访问被拒绝' },
    state => { state.status.auth_status = '未登录' },
    state => { state.status.auth_status = '未知状态' },
    state => { state.status.auth_status = undefined },
    state => { state.status.must_change_password = true },
    state => { state.status.server = 'https://192.168.7.9:8443' },
  ]) {
    const {state, navigate} = fixture()
    assert.equal(navigate(simple, identity), true)
    update(state)
    assert.equal(navigate(simple, identity), false)
  }
})

test('paused sync or transport faults do not revoke a legitimately logged-in map', () => {
  const {state, navigate} = fixture()
  state.status.sync_status = '已暂停'
  state.status.paused = true
  assert.equal(navigate(simple, {owner, origin}), true)
  state.status.sync_status = '连接失败'
  assert.equal(navigate(simple, {owner, origin}), true)
})

test('actual Electron Guest navigation AND redirects use the same strict scope allowlist', () => {
  const begin = main.indexOf("win.webContents.on('did-attach-webview'")
  const end = main.indexOf("win.webContents.on('will-navigate'", begin)
  assert.ok(begin >= 0 && end > begin)
  const wiring = main.slice(begin, end)
  assert.match(wiring,
    /desktopPlacesWebOwnerStillCurrent\(\{owner,origin:target\.origin\}\)/,
    'late WebView attach must reject a native Agent that lost its login')
  assert.match(wiring,
    /const authorized=\(rawURL:string\)=>\s*desktopPlacesGuestNavigationAllowed\(rawURL,identity\)/)
  assert.match(wiring,
    /guest\.on\('will-navigate',\(event,url\)=>\{if\(!authorized\(url\)\)event\.preventDefault\(\)\}\)/)
  assert.match(wiring,
    /guest\.on\('will-redirect',\(event,url\)=>\{if\(!authorized\(url\)\)event\.preventDefault\(\)\}\)/)
  assert.match(main, /desktopPlacesGuestFrameAllowed\(event.senderFrame.url,guest.origin\)/,
    'scope consume and navigation must share the same narrow frame allowlist')
  assert.match(wiring,/guest\.on\('did-start-navigation',details=>\{/,
    'React hash/history navigation requires a main-frame early revocation fence')
  assert.match(wiring,/if\(details\.isMainFrame && details\.isSameDocument\)/)
  assert.match(wiring,/guest\.on\('did-navigate-in-page',\(_event,url,isMainFrame\)=>\{/)
  assert.match(wiring,/if\(isMainFrame\)revokeInPageNavigation\(url\)/)
  assert.match(wiring,/if\(desktopPlacesGuests\.get\(guest\.id\)===identity\)closeDesktopPlacesGuests\(\)/,
    'revoke Cookie partition only for the matching current Guest')
  assert.match(wiring,/if\(!guest\.isDestroyed\(\)\)guest\.destroy\(\)/,
    'force-close unauthorized in-page document, ignoring beforeunload')
})

test('hash and history.pushState cannot escape map-only routes',()=>{
  const {navigate}=fixture()
  const identity={owner,origin}
  const urls=[
    simple,
    origin+'/?desktop_places_embed=1&places_map_mode=isolated'+route,
    origin+'/index.html?desktop_places_embed=1'+route,
  ]
  for(const url of urls)assert.equal(navigate(url,identity),true)
  const escaped=[
    origin+'/?desktop_places_embed=1#/app/files',
    origin+'/?desktop_places_embed=1#/app/notes',
    origin+'/?desktop_places_embed=1#/app/media-viewer?node=42',
    origin+'/?desktop_places_embed=1#/app/gallery?section=library',
    origin+'/?desktop_places_embed=1#/app/gallery?section=places&owner=foreign',
    origin+'/?desktop_places_embed=1&new_route=1'+route,
    origin+'/?places_map_mode=isolated'+route,
  ]
  for(const url of escaped)assert.equal(navigate(url,identity),false,url)
  const {state,navigate:stale}=fixture()
  state.status.username='other-owner'
  assert.equal(stale(simple,identity),false,'stale Owner cannot navigate history')
})
