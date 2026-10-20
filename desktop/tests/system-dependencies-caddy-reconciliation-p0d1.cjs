'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const code = fs.readFileSync(path.join(root, 'ui/shared/src/caddy-reconciliation.ts'), 'utf8')
const output = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const moduleRef = { exports: {} }
new Function('exports', 'module', output)(moduleRef.exports, moduleRef)
const { hasPersistedCaddyIntent, caddyLANLocalMatch } = moduleRef.exports
const verified = {
  revision: 1, source: 'saved', host_observed: true,
  host_lan_configured: true, host_lan_tls_state: 'verified',
  host_lan_ip: '192.168.10.8', desired_lan_enabled: true,
  desired_lan_ip: '192.168.10.8',
}
const check = (patch) => caddyLANLocalMatch({ ...verified, ...patch })

test('P0-D1: revision zero and default hints never become a saved target or drift', () => {
  assert.equal(hasPersistedCaddyIntent({ ...verified, revision: 0 }), false)
  assert.equal(check({ revision: 0, desired_lan_enabled: false, desired_lan_ip: '' }), 'unverified')
  assert.equal(check({ revision: 0, desired_lan_ip: '192.168.10.9' }), 'unverified')
  assert.equal(check({ revision: 1, source: 'default' }), 'unverified')
  assert.equal(check({ revision: 1.5 }), 'unverified')
  assert.equal(check({ revision: Number.MAX_SAFE_INTEGER + 1 }), 'unverified')
  assert.equal(caddyLANLocalMatch(null), 'unverified')
})

test('P0-D1: only verified local Host TLS permits a read-only LAN comparison', () => {
  assert.equal(check({}), 'matched-local')
  assert.equal(check({ source: 'host-import' }), 'matched-local')
  assert.equal(check({ desired_lan_enabled: false, desired_lan_ip: '' }), 'mismatch-local')
  assert.equal(check({ desired_lan_ip: '192.168.10.9' }), 'mismatch-local')
  assert.equal(hasPersistedCaddyIntent(verified), true)
  assert.equal(code.includes('applied_revision'), false)
  assert.equal(code.includes('apply_supported = true'), false)
})

test('P0-D1: absent/failed Host evidence or legacy partial LAN targets remain unknown', () => {
  for (const patch of [
    { host_observed: false }, { host_lan_configured: false },
    { host_lan_tls_state: 'unavailable' }, { host_lan_tls_state: 'failed' },
    { host_lan_ip: '' }, { desired_lan_enabled: undefined },
    { desired_lan_ip: undefined }, { desired_lan_ip: '' },
    { desired_lan_ip: ' 192.168.10.8' },
  ]) assert.equal(check(patch), 'unverified', JSON.stringify(patch))
})
