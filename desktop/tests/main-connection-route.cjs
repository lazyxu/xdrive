const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const routes = require('../dist/main/connection_route.cjs')
const history = require('../dist/main/login_history.cjs')

function handler(bindings, name = 'agent:login') {
  const filename = path.join(__dirname, '../src/main/index.cts')
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let callback
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' &&
        node.arguments[0]?.text === name) callback = node.arguments[1].getText(source)
    ts.forEachChild(node, walk)
  }
  walk(source); assert.ok(callback)
  const code = ts.transpileModule(`const callback=${callback};return callback`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings))
}
function fixture(routeFailure, gate) {
  const events = []; let stored
  const bindings = {
    desktopLoginIntents: new (require('../dist/main/login_intents.cjs').DesktopLoginIntents)(),
    ...routes, ...history, lastAutoLoginError: '', loginHistory: { version: 1, profiles: [] },
    securePasswordStorageAvailable: () => true,
    beginPrivateLANAuthentication: () => () => {}, ensurePrivateLANRoot: async () => null,
    requiresApprovedLANPin: () => false,
    selectConnectionRoute: async (server, route) => {
      events.push(['probe', server, route])
      if (gate) await gate
      if (routeFailure) throw routeFailure
      return { ip: '192.168.2.4', kind: 'lan', version: 'fixture' }
    },
    decryptLoginPassword: () => { events.push(['decrypt']); return 'fixture-password' },
    encryptLoginPassword: () => 'synthetic-ciphertext',
    runAgentAction: action => action(), closeSecureBaiduMapWindow: () => {},
    requireAgentClient: () => ({ login: async input => { events.push(['login', input]); return { ok: true, data: {} } }, logout: async () => { events.push(['logout']); return { ok: true, data: {} } } }),
    recordSuccessfulLogin: (current, input) => { stored = input; return history.recordSuccessfulLogin(current, input) },
    persistLoginHistoryBestEffort: async () => {},
  }
  return { login: handler(bindings), logout: handler(bindings, 'agent:logout'), events, stored: () => stored }
}
test('manual Desktop login passes the verified IP to Agent and persists origin-scoped route, not rewritten URL', async () => {
  const f = fixture()
  const route = { mode: 'auto', lan_ip: '192.168.2.4', public_ip: '' }
  const result = await f.login(null, { server: 'https://drive.example:8443/', username: 'owner', password: 'fixture-password', connection_route: route })
  assert.equal(result.ok, true)
  assert.deepEqual(f.events.map(event => event[0]), ['probe', 'login'])
  assert.equal(f.events[1][1].connection_ip, '192.168.2.4')
  assert.equal(f.events[1][1].server, 'https://drive.example:8443/')
  assert.deepEqual(f.stored().connection_route, route)
  assert.equal(f.stored().password, undefined)
})
test('TLS denial or invalid route prevents actual Agent credential request and leaves login history unchanged', async () => {
  for (const failure of [new routes.ConnectionRouteError('server_tls_trust'), new routes.ConnectionRouteError('server_tls_name')]) {
    const f = fixture(failure)
    const result = await f.login(null, { server: 'https://drive.example/', username: 'owner', password: 'fixture-password', connection_route: { mode: 'lan', lan_ip: '192.168.2.4' } })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, failure.code)
    assert.deepEqual(f.events.map(event => event[0]), ['probe'])
    assert.equal(f.stored(), undefined)
  }
  const f = fixture()
  const result = await f.login(null, { server: 'https://drive.example/', username: 'owner', password: 'fixture-password', connection_route: { mode: 'public', public_ip: '127.0.0.1' } })
  assert.equal(result.ok, false); assert.deepEqual(f.events, [])
})
test('default connection explicitly clears an older selected IP without adding route history', async () => {
  const f = fixture()
  const result = await f.login(null, { server: 'https://drive.example/', username: 'owner', password: 'fixture-password' })
  assert.equal(result.ok, true)
  assert.deepEqual(f.events.map(event => event[0]), ['login'])
  assert.equal(f.events[0][1].connection_ip, '')
  assert.equal(f.stored().connection_route, undefined)
})
test('logout during an original Main pending probe prevents late credential send and history write', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(null, gate)
  const pending = f.login(null, { server: 'https://drive.example/', username: 'old-owner', password: 'fixture-password', connection_route: { mode: 'lan', lan_ip: '192.168.2.4' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.events[0][0], 'probe')
  await f.logout(); release()
  const result = await pending
  assert.equal(result.ok, false)
  assert.deepEqual(f.events.map(event => event[0]), ['probe', 'logout'])
  assert.equal(f.stored(), undefined)
})
