const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Compile only the dependency-free runtime validator, not JSX. This is a
// behavior test with malformed Agent/Server payloads, not a source grep.
const root = path.join(__dirname, '..', '..')
const load = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const filename = ['ui', 'shared', 'src', 'mui', 'CaddyPreflightValidation.ts']
const source = load(...filename)
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const compiled = { exports: {} }
new Function('module', 'exports', js)(compiled, compiled.exports)
const { verifyCaddyPreflightContract: preflight, verifyCaddyAliDNSReadContract: verifyRead } = compiled.exports

function validPreflight() {
  const states = {
    desired: 'pass', domain: 'pass', alidns: 'pass',
    'host-manager': 'unknown', ingress: 'unknown',
    'restricted-apply': 'blocked', 'public-https': 'unknown',
  }
  return {
    checked_at: '2026-10-11T14:00:00Z', action: 'enable',
    desired_revision: 3, credential_revision: 2, configuration_complete: true,
    host_observed: false, host_ingress_ready: false, host_local_tls_verified: false,
    apply_supported: false,
    checks: Object.entries(states).map(([id, state]) => ({ id, state, detail: 'Safe local-only observation' })),
  }
}

test('Caddy preflight rejects false application, duplicate checks, and contradictory readiness', () => {
  const data = validPreflight()
  assert.deepEqual(preflight(data), data)
  assert.throws(() => preflight({ ...data, apply_supported: true }), /安全合同/)
  assert.throws(() => preflight({ ...data, checks: data.checks.slice(0, 6) }), /安全合同/)
  assert.throws(() => preflight({ ...data, checks: [...data.checks.slice(0, 6), data.checks[0]] }), /安全合同/)
  assert.throws(() => preflight({ ...data, checks: data.checks.map(c =>
    c.id === 'restricted-apply' ? { ...c, state: 'pass' } : c) }), /安全合同/)
  assert.throws(() => preflight({ ...data, checks: data.checks.map(c =>
    c.id === 'public-https' ? { ...c, state: 'pass' } : c) }), /安全合同/)
  assert.throws(() => preflight({ ...data, configuration_complete: true,
    checks: data.checks.map(c => c.id === 'alidns' ? { ...c, state: 'missing' } : c) }), /安全合同/)
  assert.throws(() => preflight({ ...data, host_observed: false, host_ingress_ready: true }), /安全合同/)
  assert.throws(() => preflight({ ...data, desired_revision: NaN }), /安全合同/)
  assert.throws(() => preflight({ ...data, checked_at: 'not-a-date' }), /安全合同/)
  const disable = { ...data, action: 'disable', credential_revision: 0,
    checks: data.checks.map(c => ['domain', 'alidns'].includes(c.id) ? { ...c, state: 'not-required' } : c) }
  assert.doesNotThrow(() => preflight(disable)) // Disabling must not require a new key.
  const unset = { ...disable, action: 'unset', desired_revision: 0, configuration_complete: false,
    checks: disable.checks.map(c => c.id === 'desired' ? { ...c, state: 'missing' } : c) }
  assert.doesNotThrow(() => preflight(unset))
})

test('AliDNS proof only passes read-authorized with an exact current revision and all three false capability flags', () => {
  const expected = { desired_revision: 3, credential_revision: 2 }
  const response = {
    state: 'read_authorized', ...expected, checked_at: '2026-10-11T14:00:00Z',
    read_permission_verified: true, write_permission_verified: false,
    apply_supported: false, public_https_verified: false,
    detail: 'Read only',
  }
  assert.deepEqual(verifyRead(response, expected), response)
  assert.doesNotThrow(() => verifyRead({ ...response, state: 'denied', read_permission_verified: false }, expected))
  for (const bad of [
    { state: 'denied' },
    { read_permission_verified: false },
    { write_permission_verified: true },
    { apply_supported: true },
    { public_https_verified: true },
    { credential_revision: 3 },
    { desired_revision: 4 },
    { checked_at: 'broken' },
  ]) {
    assert.throws(() => verifyRead({ ...response, ...bad }, expected), /安全合同/)
  }
})

test('Both Web and Desktop invalidate sibling Caddy proof on all persisted revisions', () => {
  const page = load('ui', 'shared', 'src', 'mui', 'ServiceDependenciesPage.tsx')
  const https = load('ui', 'shared', 'src', 'mui', 'CaddyHTTPSDesiredPanel.tsx')
  const dns = load('ui', 'shared', 'src', 'mui', 'CaddyAliDNSPanel.tsx')
  const probe = load('ui', 'shared', 'src', 'mui', 'CaddyPreflightPanel.tsx')
  const workspace = load('ui', 'shared', 'src', 'mui', 'CaddyDetailV1.tsx')
  assert.ok(page.includes('caddyEvidenceRevision'))
  // The active Caddy branch delegates to one shared workspace; legacy
  // Accordion JSX is preserved only for other dependency service types.
  const activeCaddy = page.slice(page.indexOf("selectedPage === 'caddy' && selectedItem ? ("),
    page.indexOf(') : (<>', page.indexOf("selectedPage === 'caddy' && selectedItem ? (")))
  assert.ok(activeCaddy.includes('onConfigurationChanged={invalidateCaddyEvidence}'))
  assert.equal((workspace.match(/onConfigurationChanged=\{changed\}/g) || []).length, 2,
    'HTTPS and AliDNS changes invalidate the manual Caddy preflight; Caddy history UI is removed')
  assert.ok(workspace.includes('onConfigurationChanged()'))
  assert.ok(workspace.includes('refreshID={evidenceRevision}'),
    'only persisted Caddy changes refresh sibling preflight, not inventory checks')
  assert.equal(page.includes('refreshID={refreshID + caddyEvidenceRevision}'), false,
    'an inventory-only status refresh must not reissue credential or preflight checks')
  assert.equal((https.match(/onConfigurationChanged\?\.\(\)/g) || []).length, 2)
  assert.equal((dns.match(/onConfigurationChanged\?\.\(\)/g) || []).length, 1)
  assert.ok(probe.includes('verifyCaddyPreflightContract(next)'))
  assert.ok(probe.includes('verifyCaddyAliDNSReadContract(next,'))
  assert.ok(probe.includes('++probeEpochRef.current'))
})
