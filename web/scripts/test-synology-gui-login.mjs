#!/usr/bin/env node
// DSM GUI Server login reuses the owning Agent, not a browser credential store.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const base = new URL('../../', import.meta.url)
const read = path => fs.readFileSync(new URL(path, base), 'utf8')
const gui = read('web/src/synology.tsx')
const preflightSource = read('web/src/synologyLoginPreflight.ts')
const adapter = read('ui/shared/src/synology-backup-adapter.ts')
const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const native = read('internal/localbackupipc/server_login.go')
const schema = read('internal/synologyui/server_login.go')
const workflow = read('.github/workflows/synology-ui.yml')

assert.match(gui, /<XDriveSettingsDialog/)
assert.match(gui, /<TextField label="Server HTTPS 地址"/)
assert.match(gui, /type=\{showPassword \? 'text' : 'password'\}/)
assert.match(gui, /client\.serverConnection\(controller\.signal\)\.then\(/)
assert.match(gui, /client\.loginServer\(requestedServer, requestedUsername, requestedPassword, controller\.signal\)/)
assert.ok(gui.indexOf('xDriveDSMLoginOwnerError(requestedServer') < gui.indexOf('client.loginServer(requestedServer'))
assert.match(gui, /setLoginError\('无法读取本机 Agent[^']*未发送密码/)
const clientEffectCleanup = gui.split("return () => {\n      controller.abort()")[1]
  ?.split("\n  }, [open, client])")[0]
assert.ok(clientEffectCleanup, 'Host replacement effect cleanup missing')
assert.match(clientEffectCleanup, /loginPhaseRef\.current === 'checking'/)
assert.match(clientEffectCleanup, /loginRef\.current\?\.abort\(\)/)
assert.match(clientEffectCleanup, /setLoginState\('idle'\)/)

assert.match(gui, /setPassword\(''\)/)
assert.match(gui, /window\.location\.reload\(\)/)
assert.doesNotMatch(gui, /localStorage\.setItem|sessionStorage\.setItem|console\.log\(password/)

assert.match(adapter, /'\/v1\/server-login', 'POST'/)
assert.match(adapter, /'\/v1\/server-connection', 'GET'/)
assert.match(adapter, /credentials: 'same-origin'/)
assert.match(adapter, /redirect: 'error'/)
assert.match(adapter, /Object\.keys\(raw\)\.length !== 1/)
assert.match(cgi, /"server-connection", "server-login"/)
assert.match(gateway, /parseServerLogin\(r\)/)
assert.match(gateway, /login\.LoginServer\(ctx, input\.Server, input\.Username, input\.Password\)/)
assert.match(gateway, /quotaReader\.OwnerQuota\(ctx\)/)
assert.match(native, /"\/v1\/auth\/login"/)
assert.match(native, /current\.Configured/)
assert.match(schema, /duplicate DSM login field/)
assert.doesNotMatch(schema, /exec\.Command|os\.WriteFile/)
assert.match(workflow, /node web\/scripts\/test-synology-gui-login\.mjs/)
console.log('DSM GUI login stays in shared Settings and requires typed same-Owner Agent verification')


// Execute the actual TypeScript preflight, not a handwritten validation copy.
const compiled = ts.transpileModule(preflightSource, {
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
const preflight = {}
new Function('exports', compiled.outputText)(preflight)
const inputError = preflight.xDriveDSMLoginInputError
const ownerError = preflight.xDriveDSMLoginOwnerError
assert.equal(inputError('https://drive.example:8443', 'owner', 'valid-secret'), '')
for (const origin of ['http://drive.example', 'https://user:pass@drive.example',
  'https://drive.example/path', 'https://drive.example/?token=abc',
  'https://drive.example/#fragment', 'https://drive.example:99999']) {
  assert.notEqual(inputError(origin, 'owner', 'valid-secret'), '', origin)
}
assert.notEqual(inputError('https://drive.example', 'owner\nother', 'secret'), '')
assert.notEqual(inputError('https://drive.example', 'owner', 'abc\nsecret'), '')
assert.notEqual(inputError('https://drive.example', 'owner', 'p'.repeat(4097)), '')
assert.notEqual(inputError('https://drive.example', 'owner', '密'.repeat(1400)), '')
assert.equal(ownerError('https://drive.example', 'owner', { configured: false }), '')
const configured = { configured: true, server: 'https://drive.example:443', username: 'owner' }
assert.equal(ownerError('https://drive.example/', 'owner', configured), '')
assert.notEqual(ownerError('https://drive.example', 'another', configured), '')
assert.notEqual(ownerError('https://192.168.2.4', 'owner', configured), '')
assert.notEqual(ownerError('https://drive.example:8443', 'owner', configured), '')
assert.notEqual(ownerError('https://drive.example', 'owner',
  { configured: true, server: '', username: 'owner' }), '')
assert.doesNotMatch(preflightSource, /localStorage|sessionStorage|document\.cookie|console\.log/)
const loginBlock = gui.split('const login = (event: React.FormEvent<HTMLFormElement>) => {')[1]
  .split('const statusText:')[0]
assert.ok(loginBlock.indexOf('client.serverConnection(controller.signal)') <
  loginBlock.indexOf('client.loginServer(requestedServer'))
assert.ok(loginBlock.indexOf('xDriveDSMLoginOwnerError(requestedServer') <
  loginBlock.indexOf('client.loginServer(requestedServer'))
assert.equal((loginBlock.match(/window\.location\.reload\(\)/g) || []).length, 2)
assert.match(loginBlock, /setPassword\(''\)[\s\S]*setLoginState\('logging'\)/)
assert.match(loginBlock, /setProfileStatus\('unavailable'\)[\s\S]*setLoginError\('无法读取本机 Agent/)
console.log('DSM preflight rejects invalid Server/Owner and unreadable Agent without persisting secrets')
