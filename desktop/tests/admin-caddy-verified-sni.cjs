const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const validator = read('ui/shared/src/mui/CaddyPreflightValidation.ts')
const compiled = ts.transpileModule(validator, {
  fileName: 'CaddyPreflightValidation.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const validatorExports = {}
new Function('exports', 'require', compiled.outputText)(validatorExports, () => {
  throw Error('Caddy readonly validator cannot import a runtime network or control module')
})

const checkIDs = ['desired', 'domain', 'alidns', 'host-manager', 'ingress', 'restricted-apply', 'public-https']
const good = () => ({
  checked_at: '2026-10-16T05:00:00Z',
  action: 'enable',
  desired_revision: 7,
  credential_revision: 9,
  configuration_complete: true,
  host_observed: true,
  host_ingress_ready: true,
  host_local_tls_verified: true,
  apply_supported: false,
  desired_domain_local_match: 'matched-local',
  checks: checkIDs.map(id => ({
    id,
    state: id === 'restricted-apply' ? 'blocked'
      : id === 'public-https' ? 'unknown' : 'pass',
    detail: 'read-only',
  })),
})

test('Caddy hostname comparison is a scoped, backwards-compatible readonly observation', () => {
  for (const state of ['matched-local', 'mismatch-local', 'unverified']) {
    const value = { ...good(), desired_domain_local_match: state }
    assert.equal(validatorExports.verifyCaddyPreflightContract(value).desired_domain_local_match, state)
    assert.equal(value.apply_supported, false)
  }
  const legacy = good()
  delete legacy.desired_domain_local_match
  assert.equal(validatorExports.verifyCaddyPreflightContract(legacy).desired_domain_local_match, undefined)
})

test('Caddy validator rejects forged local SNI status without a verified current host', () => {
  const changes = [
    x => { x.desired_domain_local_match = 'verified' },
    x => { x.desired_domain_local_match = null },
    x => { x.host_local_tls_verified = false },
    x => { x.host_observed = false },
    x => { x.host_ingress_ready = false },
    x => { x.action = 'disable'; x.checks[1].state = 'not-required'; x.checks[2].state = 'not-required' },
    x => { x.checks[1].state = 'missing'; x.configuration_complete = false },
  ]
  for (const mutate of changes) {
    const value = good()
    mutate(value)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(value))
  }
})

test('Caddy read-only ingress-continuity advisory is bounded and old Agent compatible', () => {
  const matched = good()
  matched.ingress_change_risk = 'unverified'
  assert.equal(validatorExports.verifyCaddyPreflightContract(matched).ingress_change_risk, 'unverified')
  const oldServer = good()
  delete oldServer.ingress_change_risk
  assert.equal(validatorExports.verifyCaddyPreflightContract(oldServer).ingress_change_risk, undefined)
  const switchIntent = good()
  switchIntent.desired_domain_local_match = 'mismatch-local'
  switchIntent.ingress_change_risk = 'local-domain-switch'
  assert.equal(validatorExports.verifyCaddyPreflightContract(switchIntent).ingress_change_risk, 'local-domain-switch')
  const disableIntent = good()
  disableIntent.action = 'disable'
  disableIntent.desired_domain_local_match = 'unverified'
  disableIntent.checks[1].state = 'not-required'
  disableIntent.checks[2].state = 'not-required'
  disableIntent.ingress_change_risk = 'local-https-removal'
  assert.equal(validatorExports.verifyCaddyPreflightContract(disableIntent).ingress_change_risk, 'local-https-removal')

  for (const mutate of [
    x => { x.ingress_change_risk = 'safe-to-apply' },
    x => { x.ingress_change_risk = null },
    x => { x.ingress_change_risk = 'local-domain-switch' },
    x => { x.ingress_change_risk = 'local-https-removal' },
    x => { x.ingress_change_risk = 'local-domain-switch'; x.desired_domain_local_match = 'mismatch-local'; x.host_local_tls_verified = false },
    x => { x.ingress_change_risk = 'local-domain-switch'; x.desired_domain_local_match = 'mismatch-local'; x.host_observed = false },
    x => { x.ingress_change_risk = 'local-domain-switch'; x.desired_domain_local_match = 'mismatch-local'; x.host_ingress_ready = false },
    x => { x.ingress_change_risk = 'local-domain-switch'; x.desired_domain_local_match = 'mismatch-local'; x.desired_revision = 0 },
  ]) {
    const forged = good()
    mutate(forged)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(forged))
  }
})

test('the expected domain is compared only to real host-local verified TLS, with no new control action', () => {
  const host = read('scripts/server-control.sh')
  const goHost = read('internal/api/admin_caddy_host_status.go')
  const api = read('internal/api/admin_caddy_preflight.go')
  const compare = read('internal/api/admin_caddy_tls_hostname_match.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const desktop = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  const router = read('internal/api/router.go')

  assert.match(host, /tls_domain_sha256/)
  assert.match(host, /"tls_verified_domain_sha256"/)
  assert.match(host, /sha256sum/)
  assert.match(host, /tls_state="\$\(caddy_local_tls_state "\$domain"\)"/)
  assert.doesNotMatch(host, /"tls_verified_domain":/)
  assert.match(goHost, /TLSVerifiedDomainSHA256/)
  assert.match(goHost, /validCaddyTLSVerifiedDomainDigest/)
  assert.match(compare, /caddyDesiredDomainLocalMatch\(/)
  assert.match(compare, /subtle.ConstantTimeCompare/)
  assert.match(api, /DesiredDomainLocalMatch:\s+caddyDesiredDomainLocalMatch/)
  assert.match(api, /IngressChangeRisk:\s+caddyIngressChangeRisk/)
  assert.match(read('internal/api/admin_caddy_ingress_change_risk.go'), /local-https-removal/)
  assert.match(read('internal/api/admin_caddy_ingress_change_risk.go'), /local-domain-switch/)
  assert.match(client, /IngressChangeRisk/)
  assert.match(desktop, /ingress_change_risk\?:/)
  assert.match(shared, /ingress_change_risk\?:/)
  assert.match(panel, /data-xdrive-caddy-ingress-change-risk/)
  assert.match(panel, /不是应用许可或公网 HTTPS 生效证明/)
  assert.match(client, /DesiredDomainLocalMatch/)
  assert.match(desktop, /desired_domain_local_match\?:/)
  assert.match(shared, /desired_domain_local_match\?:/)
  assert.match(panel, /data-xdrive-caddy-desired-domain-local-match/)
  assert.match(panel, /不代表目标修订已应用或公网可用/)
  // Branches can emit the same fixed row in pass/missing/blocked states.
  // Verify exact unique IDs, not the count of conditional add() branches.
  const observedIDs = [...api.matchAll(/\badd\("([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual([...new Set(observedIDs)].sort(), [...checkIDs].sort())
  assert.match(api, /make\(\[\]adminCaddyPreflightCheck, 0, 7\)/)
  assert.match(api, /ApplySupported:\s+false/)
  assert.doesNotMatch(api + router, /admin\.(?:POST|PUT|DELETE)\(".*services\/caddy\/https\/(?:apply|stop|restart)/)
})
