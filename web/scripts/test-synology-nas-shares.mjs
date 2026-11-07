#!/usr/bin/env node
// Executable parser validation and exact DSM share route wiring regression.
// No new source write, browser-provided NAS pathname or Agent bearer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
const base = new URL('../../', import.meta.url)
const read = p => fs.readFileSync(new URL(p, base), 'utf8')
const helper = stripTypeScriptTypes(read('ui/shared/src/synology-nas-share-inventory.ts'), { mode: 'strip' })
const { xDriveValidateSynologyNASShareInventory: verify } =
  await import('data:text/javascript,' + encodeURIComponent(helper))
const a = 'a'.repeat(64), b = 'b'.repeat(64)
assert.deepEqual(verify({ items: [
  { label: '/volume1/photo', selection_id: a },
  { label: '/volume2/Backup Drive', selection_id: b },
]}).map(v => v.label), ['/volume1/photo', '/volume2/Backup Drive'])
assert.deepEqual(verify({ items: [] }), [], 'empty inventory is not a successful Root grant')
for (const bad of [
  { items: [], bearer: 'SECRET' }, { items: null }, { items: new Array(513).fill(null) },
  { items: [{ label: '/etc/passwd', selection_id: a }] },
  { items: [{ label: '/volume0/photos', selection_id: a }] },
  { items: [{ label: '/volume01/photos', selection_id: a }] },
  { items: [{ label: '/volume1/@appdata', selection_id: a }] },
  { items: [{ label: '/volume1/homes', selection_id: a }] },
  { items: [{ label: '/volume1/../etc', selection_id: a }] },
  { items: [{ label: '/volume1/child/leaf', selection_id: a }] },
  { items: [{ label: '/volume1/child', selection_id: 'x'.repeat(64) }] },
  { items: [{ label: '/volume1/child', selection_id: a, path: '/etc' }] },
  { items: [{ label: '/volume1/child', selection_id: a }, { label: '/volume1/child', selection_id: b }] },
  { items: [{ label: '/volume1/photo', selection_id: a }, { label: '/volume2/photo', selection_id: a }] },
]) assert.throws(() => verify(bad), /Invalid|Unsafe/)
const adapter = read('ui/shared/src/synology-backup-adapter.ts')
const panel = read('ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const setup = read('ui/shared/src/mui/SynologyBackupSourceSetup.tsx')
const browser = read('ui/shared/src/mui/SynologyNASShareInventory.tsx')
const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(adapter, /'nas-shares'/)
assert.match(adapter, /xDriveValidateSynologyNASShareInventory/)
assert.match(browser, /client\.nasShares\(controller\.signal\)/)
assert.match(browser, /controller\.abort\(\)/)
assert.match(browser, /share\.label/)
assert.match(browser, /client\.preflightNASShare\(share\.selection_id, controller\.signal\)/)
assert.doesNotMatch(browser, /\{share\.selection_id\}\s*</,
  'opaque share IDs must not be visibly rendered')
assert.doesNotMatch(browser, /AuthorizeLocalRoot|createLocalBackupSource|fetch\(/,
  'native preflight must not grant Root authority')
assert.match(panel, /<XDriveSynologyBackupSourceSetup client=\{client\}\s+onCreated=\{\(\) => \{ if \(isCurrentHost\(\)\) refresh\(\) \}\}/,
  'Source creation must refresh only the current owning Agent Host generation')
assert.match(panel, /hostEpochRef\.current\.epoch === renderedHostEpoch/,
  'returning to an older Agent client must not reactivate stale Source callbacks')
assert.doesNotMatch(panel, /<XDriveSynologyBackupSourceSetup client=\{client\} onCreated=\{refresh\}/,
  'unguarded Source callbacks must not cross DSM Host identity')
assert.match(setup, /<XDriveSynologyNASShareInventory key=\{shareRevision\}\s+client=\{client\} onVerifiedShare=\{onVerifiedShare\}/)
assert.match(setup, /shareRevision !== shareRevisionRef\.current/)
assert.match(setup, /resetShareAuthorization\(\)/)
assert.match(browser, /onVerifiedShare\?\.\(share\)/)
assert.doesNotMatch(browser, /createNASBackupSource\(/)
assert.match(cgi, /"nas-shares"/)
assert.match(gateway, /r\.URL\.Path == "\/v1\/nas-shares"/)
assert.match(workflow, /node web\/scripts\/test-synology-nas-shares\.mjs/)
console.log('DSM NAS share inventory uses one authenticated local Agent and no browser path/Root grants.')

// One shared status-only diagnostic for local Backup, Source setup and share
// inventory. Execute real TypeScript with Node; no API, Cookie or NAS required.
const authSource = stripTypeScriptTypes(read(
  'ui/shared/src/synology-dsm-auth-diagnostics.ts'),{mode:'strip'})
const auth = await import('data:text/javascript,'+encodeURIComponent(authSource))
const code = auth.xDriveDSMSafeFailureCode
const hint = auth.xDriveDSMAuthenticationFailureMessage
for(const [status,allowed] of [
  [401,['dsm-session-rejected']],
  [403,['dsm-principal-unapproved','dsm-authority-unavailable','dsm-csrf-rejected']],
  [503,['dsm-auth-environment','dsm-auth-timeout','dsm-auth-helper-failed',
    'dsm-auth-response-invalid','dsm-auth-unavailable','agent-unavailable',
    'nas-inventory-unavailable','server-connection-unavailable']],
]){
  for(const reason of allowed) assert.equal(code(status,reason),reason)
}
for(const [http,wrong] of [
  [401,'dsm-auth-timeout'],[503,'dsm-session-rejected'],
  [403,'agent-unavailable'],[200,'dsm-auth-helper-failed']]){
  assert.equal(code(http,wrong),'','cross-status diagnostic was accepted')
}
for(const raw of ['../../etc/passwd','dsm-auth-helper-failed\nCookie:secret',
  'dsm-session-rejected ','private-NAS-root','']) {
  assert.equal(code(503,raw),'','untrusted CGI reason reached user')
}
assert.equal(code(503,null),'')
for(const [http,reason,expected] of [
  [401,'dsm-session-rejected','会话未登录'],
  [503,'dsm-auth-timeout','校验超时'],
  [503,'dsm-auth-helper-failed','程序执行失败'],
  [503,'dsm-auth-environment','环境不完整'],
  [503,'dsm-auth-response-invalid','无法安全识别'],
  [503,'dsm-auth-unavailable','程序异常'],
  [403,'dsm-principal-unapproved','套件界面授权'],
  [403,'dsm-authority-unavailable','授权配置缺失'],
  [403,'dsm-csrf-rejected','CSRF 校验失败']]){
  const message=hint(new Error(`DSM backup request rejected (HTTP ${http}) [${reason}]`))
  assert.ok(message?.includes(expected),'unsafe/missing DSM auth diagnosis '+reason)
  assert.match(message,/HTTP (401|403|503)/)
}
assert.match(hint(new Error('DSM backup request rejected (HTTP 401)')),/没有可信/)
assert.match(hint(new Error('DSM backup request rejected (HTTP 403)')),/未能证明/)
const secret='private Cookie=token/volume1/private'
assert.equal(hint(new Error(secret)),null,'raw native error cannot become UI text')
for(const component of [panel,setup,browser]){
  assert.match(component,/xDriveDSMAuthenticationFailureMessage\(failure\)/)
}
assert.match(panel,/dsm-principal-unapproved/)
assert.doesNotMatch(panel,/setPrincipalDenied\(detail === 'DSM backup request rejected \(HTTP 403\)'\)/)
assert.match(adapter,/xDriveDSMSafeFailureCode\(/)
assert.doesNotMatch(authSource,/document\.cookie|localStorage|sessionStorage|fetch\(/)
console.log('DSM native auth outage vs. real session rejection diagnostics are safe and consistent.')
