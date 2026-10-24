'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')
const { privateLANOrigin, verifiedLANRootPEM } = require('../dist/main/lan_root_auto.cjs')
const { clearSavedPasswordsForOrigin, normalizeLoginHistory } = require('../dist/main/login_history.cjs')

const mainPath = path.join(__dirname, '../src/main/index.cts')
const required = [
  'loadPrivateLANRoots', 'persistPrivateLANTrustState', 'savePrivateLANRoot',
  'approvedManualLANPin', 'privateLANTrustSummary', 'requiresApprovedLANPin',
  'ensurePrivateLANRoot', 'revokePrivateLANServer', 'beginPrivateLANAuthentication',
]
const parsed = ts.createSourceFile(mainPath, fs.readFileSync(mainPath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const bodies = new Map()
for (const statement of parsed.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name &&
      required.includes(statement.name.text)) {
    bodies.set(statement.name.text, statement.getText(parsed))
  }
}
assert.deepEqual([...bodies.keys()].sort(), [...required].sort())
const embedded = [
  'let privateLANRoots = []',
  'const rejectedManualLANOrigins = new Set()',
  'let privateLANTrustStoreCorrupt = false',
  'let privateLANSaveQueue = Promise.resolve()',
  'const privateLANEnrollments = new Map()',
  'const privateLANAuthentications = new Map()',
  "const privateLANRootsName = 'desktop-private-lan-roots.json'",
  'let loginHistory = normalizeLoginHistory(initialHistory)',
  "let lastAutoLoginError = ''",
  'let mainWindow = null',
  'async function saveLoginHistory() {',
  '  await writeFile(historyPath, JSON.stringify(loginHistory), { mode: 0o600 })',
  '}',
  ...required.map(name => bodies.get(name)),
  'return {',
  '  load: () => loadPrivateLANRoots(),',
  '  get: server => privateLANTrustSummary(server),',
  '  revoke: server => revokePrivateLANServer(server),',
  '  save: pin => savePrivateLANRoot(pin),',
  '  blocked: server => requiresApprovedLANPin(server),',
  '  ensure: (server, username) => ensurePrivateLANRoot(server, username),',
  '  beginAuth: server => beginPrivateLANAuthentication(server),',
  '  history: () => loginHistory,',
  '}',
].join('\n')
const transpiled = ts.transpileModule(embedded, {
  fileName: mainPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function makeHarness(dir, initialHistory, agentState, dialogResponse = 1) {
  const bindings = {
    // index.cts is a CommonJS module. TypeScript emits the __esModule
    // initializer even for extracted Main function bodies.
    exports: {},
    historyPath: path.join(dir, 'history.json'),
    initialHistory, normalizeLoginHistory, clearSavedPasswordsForOrigin,
    privateLANOrigin, verifiedLANRootPEM,
    trustedDomainCandidates: () => [{ hostname: 'drive.example.invalid' }],
    enrollLANRootViaTrustedDomain: async () => {
      throw Error('revoked IP must never re-enroll silently')
    },
    probeWithTrustedLANRoot: async () => '1.0',
    app: { getPath: key => {
      assert.equal(key, 'userData')
      return dir
    } },
    path, readFile: fsp.readFile, writeFile: fsp.writeFile,
    mkdir: fsp.mkdir, rename: fsp.rename, rm: fsp.rm,
    agentState: { connected: true },
    requireAgentClient: () => ({ status: async () => agentState }),
    dialog: { showMessageBox: async () => ({ response: dialogResponse }) },
  }
  const keys = Object.keys(bindings)
  return new Function(...keys, transpiled)(...keys.map(key => bindings[key]))
}
function cert(dir) {
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'root.crt')
  const cmd = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', crt, '-days', '1', '-subj', '/CN=xDrive trusted LAN',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { encoding: 'utf8' })
  assert.equal(cmd.status, 0, cmd.stderr)
  const pem = fs.readFileSync(crt, 'utf8')
  const verified = verifiedLANRootPEM(pem)
  assert.ok(verified)
  return { pem, sha256: verified.sha256 }
}
const origin = 'https://192.168.2.4:8443'
const other = 'https://192.168.2.5:8443'
const fixtureReady = spawnSync('openssl', ['version']).status === 0
const pin = (server, ca, source = 'user-approved-lan') => ({
  server, username: source === 'user-approved-lan' ? '' : 'alice',
  domain: source === 'user-approved-lan' ? '' : 'drive.example.invalid',
  root_pem: ca.pem, sha256: ca.sha256, source,
})
function fakeHistory() {
  return normalizeLoginHistory({ profiles: [
    { server: origin, username: 'alice', last_used_at: '2026-10-24T00:00:02Z',
      encrypted_password: 'secret-a', remember_password: true, auto_login: true },
    { server: origin + '/', username: 'bob', last_used_at: '2026-10-24T00:00:01Z',
      encrypted_password: 'secret-b', remember_password: true, auto_login: false },
    { server: other, username: 'carol', last_used_at: '2026-10-24T00:00:00Z',
      encrypted_password: 'unrelated-secret', remember_password: true, auto_login: false },
  ] })
}

test('revoke persists exact-IP block, clears saved passwords and survives restart', {
  skip: !fixtureReady,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-revoke-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const ca = cert(dir)
  const trustFile = path.join(dir, 'desktop-private-lan-roots.json')
  fs.writeFileSync(trustFile, JSON.stringify({
    version: 1, roots: [pin(origin, ca), pin(other, ca, 'verified-domain')],
  }))
  const agent = { configured: false, server: '' }
  const app = makeHarness(dir, fakeHistory(), agent)
  await app.load()
  assert.deepEqual(app.get(origin), {
    status: 'trusted', sha256: ca.sha256, source: 'user-approved-lan',
  })
  assert.doesNotMatch(JSON.stringify(app.get(origin)), /BEGIN CERTIFICATE/)
  assert.deepEqual(await app.revoke(origin), { ok: true, data: { revoked: true } })
  const saved = JSON.parse(fs.readFileSync(trustFile, 'utf8'))
  assert.deepEqual(saved.blocked_origins, [origin])
  assert.deepEqual(saved.roots.map(p => p.server), [other])
  assert.deepEqual(app.get(origin), { status: 'blocked' })
  assert.equal(app.blocked(origin), true)
  assert.equal(app.get(other).status, 'trusted')
  assert.equal(await app.ensure(origin, 'alice'), null)
  const profiles = app.history().profiles
  for (const p of profiles) {
    if (new URL(p.server).origin === origin) {
      assert.equal(p.remember_password, false)
      assert.equal(p.auto_login, false)
      assert.equal(p.encrypted_password, undefined)
    } else {
      assert.equal(p.encrypted_password, 'unrelated-secret')
    }
  }
  const rebooted = makeHarness(dir, app.history(), agent)
  await rebooted.load()
  assert.equal(rebooted.blocked(origin), true)
  assert.deepEqual(rebooted.get(origin), { status: 'blocked' })
  assert.equal(await rebooted.ensure(origin, 'alice'), null)
  await rebooted.save(pin(origin, ca))
  assert.deepEqual(JSON.parse(fs.readFileSync(trustFile, 'utf8')).blocked_origins, [])
  assert.equal(rebooted.get(origin).status, 'trusted')
})

test('persisted revoke tombstone outranks a stale valid CA entry after restart', {
  skip: !fixtureReady,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-tombstone-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const ca = cert(dir)
  const trustFile = path.join(dir, 'desktop-private-lan-roots.json')
  // May be left by legacy or partial-state migration. Tombstones must be
  // authoritative regardless of whether the old CA certificate is valid.
  fs.writeFileSync(trustFile, JSON.stringify({
    version: 1, blocked_origins: [origin],
    roots: [pin(origin, ca), pin(other, ca, 'verified-domain')],
  }))
  const agent = { configured: false, server: '' }
  const desktop = makeHarness(dir, fakeHistory(), agent)
  await desktop.load()
  assert.equal(desktop.blocked(origin), true)
  assert.deepEqual(desktop.get(origin), { status: 'blocked' })
  assert.equal(await desktop.ensure(origin, 'alice'), null)
  assert.deepEqual(desktop.get(other), {
    status: 'trusted', sha256: ca.sha256, source: 'verified-domain',
  })
  // A new explicit native approval is allowed to replace the tombstone.
  await desktop.save(pin(origin, ca))
  const saved = JSON.parse(fs.readFileSync(trustFile, 'utf8'))
  assert.deepEqual(saved.blocked_origins, [])
  assert.equal(desktop.get(origin).status, 'trusted')
})

test('revoke refuses active session, concurrent login and native-dialog cancellation', {
  skip: !fixtureReady,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-guard-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const ca = cert(dir)
  const trustFile = path.join(dir, 'desktop-private-lan-roots.json')
  fs.writeFileSync(trustFile, JSON.stringify({ version: 1, roots: [pin(origin, ca)] }))
  const agent = { configured: true, server: origin }
  const app = makeHarness(dir, fakeHistory(), agent)
  await app.load()
  let result = await app.revoke(origin)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'lan_trust_logout_first')
  agent.configured = false
  const done = app.beginAuth(origin)
  result = await app.revoke(origin)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'lan_trust_login_in_flight')
  done()
  const cancelled = makeHarness(dir, fakeHistory(), agent, 0)
  await cancelled.load()
  assert.deepEqual(await cancelled.revoke(origin), { ok: true, data: { revoked: false } })
  assert.equal(JSON.parse(fs.readFileSync(trustFile, 'utf8')).roots.length, 1)
})

test('LAN trust status IPC exposes fingerprint only and native revoke remains opt-in', () => {
  const main = fs.readFileSync(mainPath, 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload/index.cts'), 'utf8')
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/App.tsx'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/renderer/global.d.ts'), 'utf8')
  assert.match(main, /ipcMain.handle\('desktop:get-lan-trust'/)
  assert.match(main, /ipcMain.handle\('desktop:revoke-lan-trust'/)
  assert.match(main, /blocked_origins: \[\.\.\.blocked\]\.sort\(\)/)
  assert.match(main, /rejectedManualLANOrigins.add\(target.origin\)/)
  assert.match(main, /clearSavedPasswordsForOrigin\(loginHistory, target.origin\)/)
  assert.match(main, /privateLANAuthentications.has\(target.origin\)/)
  assert.match(preload, /getLANTrust: \(server: string\)/)
  assert.match(preload, /revokeLANTrust: \(server: string\)/)
  assert.match(renderer, /撤销此服务器信任/)
  assert.match(types, /revokeLANTrust: \(server: string\)/)
  const start = main.indexOf('function privateLANTrustSummary(')
  const end = main.indexOf('\nasync function ensurePrivateLANRoot', start)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(main.slice(start, end), /root_pem|encrypted_password|refresh_token/)
  assert.doesNotMatch(main, /setCertificateVerifyProc|ignoreCertificateErrors/)
})
