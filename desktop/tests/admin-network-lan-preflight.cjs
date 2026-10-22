const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const src = read('ui/shared/src/mui/CaddyPreflightValidation.ts')
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const compiled = { exports: {} }
new Function('module', 'exports', js)(compiled, compiled.exports)
const verify = compiled.exports.verifyCaddyPreflightContract

function base() {
  const states = {
    desired: 'pass', domain: 'not-required', alidns: 'not-required',
    'host-manager': 'pass', ingress: 'pass',
    'restricted-apply': 'blocked', 'public-https': 'unknown',
  }
  return {
    checked_at: '2026-10-18T00:00:00Z', action: 'disable',
    desired_revision: 6, credential_revision: 0, configuration_complete: true,
    host_observed: true, host_ingress_ready: true, host_local_tls_verified: false,
    desired_lan_enabled: true, host_lan_local_tls_verified: true,
    desired_lan_local_match: 'matched-local', ingress_change_risk: 'unverified',
    apply_supported: false,
    checks: Object.entries(states).map(([id, state]) => ({ id, state, detail: 'read-only fixture' })),
  }
}

test('IP-only trusted local check is not rejected as domain TLS unavailable', () => {
  const good = base()
  assert.equal(verify(good), good)
  assert.doesNotThrow(() => verify({ ...good, desired_lan_local_match: 'mismatch-local',
    ingress_change_risk: 'local-lan-switch' }))
  assert.doesNotThrow(() => verify({ ...good, desired_lan_enabled: false,
    desired_lan_local_match: 'mismatch-local', ingress_change_risk: 'local-lan-removal' }))
  // An older Server/Agent may omit all new fields; no fabricated green state.
  const old = { ...good }
  delete old.desired_lan_enabled
  delete old.host_lan_local_tls_verified
  delete old.desired_lan_local_match
  assert.doesNotThrow(() => verify(old))
  for (const changed of [
    { host_lan_local_tls_verified: false },
    { host_lan_local_tls_verified: 'verified' },
    { host_observed: false },
    { host_ingress_ready: false },
    { desired_lan_enabled: undefined },
    { desired_lan_enabled: false, desired_lan_local_match: 'matched-local' },
    { desired_lan_local_match: 'applied' },
    { desired_revision: 0 },
    { ingress_change_risk: 'local-lan-removal' },
    { desired_lan_local_match: 'unverified', ingress_change_risk: 'local-lan-switch' },
    { apply_supported: true },
  ]) {
    assert.throws(() => verify({ ...good, ...changed }), /安全合同/,
      'malformed LAN local-effect proof should fail closed: ' + JSON.stringify(changed))
  }
  assert.throws(() => verify({ ...old, ingress_change_risk: 'local-lan-removal' }), /安全合同/)
})

test('Web/Mobile Web/PWA/Desktop share LAN ingress read-only proof without new Docker control', () => {
  const backend = read('internal/api/admin_caddy_preflight.go')
  const helper = read('internal/api/admin_caddy_lan_desired_match.go')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const agent = read('desktop/src/main/agent_client.cts')
  const client = read('internal/client/admin_caddy_preflight.go')
  assert.match(backend, /caddyDesiredLANLocalMatch\(desired, host, observed, deploymentLANIP\)/)
  assert.match(backend, /caddyIngressChangeRiskDual\(desired, host, observed, deploymentLANIP\)/)
  assert.match(backend, /caddyLANLocalEffectState\(host, observed, deploymentLANIP\)/)
  assert.match(helper, /return "local-lan-removal"/)
  assert.match(helper, /return "local-lan-switch"/)
  for (const contract of [shared, agent, client]) {
    assert.match(contract, /desired_lan_local_match/)
    assert.match(contract, /host_lan_local_tls_verified/)
  }
  for (const contract of [shared, agent]) {
    assert.match(contract, /local-lan-removal/)
  }
  assert.match(client, /IngressChangeRisk/)
  assert.match(panel, /data-xdrive-caddy-desired-lan-local-match/)
  assert.match(panel, /本机 IP HTTPS 与已保存的局域网入口不同/)
  assert.match(panel, /data-xdrive-caddy-ingress-change-risk/)
  assert.match(helper, /return "local-lan-switch"/)
  assert.doesNotMatch(backend, /adminStartCaddyApply|docker\.sock|docker compose/)
  assert.doesNotMatch(panel, /Restart Caddy|Docker Socket/)
})
