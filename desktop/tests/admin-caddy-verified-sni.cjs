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
  host_runtime_tls_alignment: 'matched-local',
  revision_snapshot_consistent: true,
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

test('fixed Caddy container startup domain differs from desired domain and never authorizes apply', () => {
  for (const alignment of ['matched-local', 'mismatch-local', 'unverified']) {
    const value = { ...good(), host_runtime_tls_alignment: alignment }
    assert.equal(validatorExports.verifyCaddyPreflightContract(value).host_runtime_tls_alignment, alignment)
    assert.equal(value.apply_supported, false)
  }
  const legacy = good()
  delete legacy.host_runtime_tls_alignment
  assert.equal(validatorExports.verifyCaddyPreflightContract(legacy).host_runtime_tls_alignment, undefined)
  for (const mutate of [
    x => { x.host_runtime_tls_alignment = 'applied' },
    x => { x.host_runtime_tls_alignment = null },
    x => { x.host_runtime_tls_alignment = false },
    x => { x.host_runtime_tls_alignment = 'matched-local'; x.host_observed = false },
    x => { x.host_runtime_tls_alignment = 'mismatch-local'; x.host_ingress_ready = false },
    x => { x.host_runtime_tls_alignment = 'matched-local'; x.host_local_tls_verified = false },
  ]) {
    const candidate = good()
    mutate(candidate)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(candidate))
  }
  const shell = read('scripts/server-control.sh')
  const runner = read('scripts/test-caddy-host-status.sh')
  const host = read('internal/api/admin_caddy_host_status.go')
  const preflight = read('internal/api/admin_caddy_preflight.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const desktop = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const ui = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(shell, /caddy_container_runtime_tls_alignment/)
  assert.match(shell, /\{\{range \.Config\.Env\}\}/)
  assert.match(shell, /"XD_DOMAIN"/)
  assert.match(shell, /xdrive-caddy 2>\/dev\/null/)
  assert.doesNotMatch(shell, /\{\{json \.Config\.Env\}\}/)
  assert.match(runner, /runtime_tls_alignment/)
  assert.match(host, /RuntimeTLSAlignment/)
  assert.match(host, /validCaddyRuntimeTLSAlignment/)
  assert.match(preflight, /HostRuntimeTLSAlignment:\s+caddyObservedRuntimeTLSAlignment/)
  assert.match(client, /HostRuntimeTLSAlignment/)
  assert.match(desktop, /host_runtime_tls_alignment\?:/)
  assert.match(shared, /host_runtime_tls_alignment\?:/)
  assert.match(ui, /data-xdrive-caddy-host-runtime-tls-alignment/)
  assert.match(ui, /不证明公网访问、AliDNS 生效或可以安全切换网关/)
  assert.match(preflight, /ApplySupported:\s+false/)
})

test('live fixed Caddy active configuration is read-only and never a saved-revision apply receipt', () => {
  const goodLive = good()
  goodLive.host_live_config_state = 'observed-local'
  assert.equal(validatorExports.verifyCaddyPreflightContract(goodLive).host_live_config_state, 'observed-local')
  const oldRunner = good()
  delete oldRunner.host_live_config_state
  assert.equal(validatorExports.verifyCaddyPreflightContract(oldRunner).host_live_config_state, undefined)
  const unknown = good()
  unknown.host_live_config_state = 'unverified'
  assert.equal(validatorExports.verifyCaddyPreflightContract(unknown).host_live_config_state, 'unverified')
  for (const mutate of [
    x => { x.host_live_config_state = 'applied' },
    x => { x.host_live_config_state = null },
    x => { x.host_live_config_state = false },
    x => { x.host_live_config_state = 'observed-local'; x.host_observed = false },
    x => { x.host_live_config_state = 'observed-local'; x.host_ingress_ready = false },
    x => { x.host_live_config_state = 'observed-local'; x.host_local_tls_verified = false },
  ]) {
    const x = good()
    mutate(x)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(x))
  }
  const runner = read('scripts/server-control.sh')
  const shellTest = read('scripts/test-caddy-host-status.sh')
  const host = read('internal/api/admin_caddy_host_status.go')
  const preflight = read('internal/api/admin_caddy_preflight.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const desktop = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(runner, /live_config_before/)
  assert.match(runner, /live_config_after/)
  assert.match(runner, /\$live_config_before" == "\$live_config_after/)
  assert.match(shellTest, /XD_CADDY_LIVE_SHA_NEXT_FIXTURE/)
  assert.match(shellTest, /next_live_sha/)
  assert.match(runner, /docker exec xdrive-caddy \/bin\/sh -ec/)
  assert.match(runner, /http:\/\/127\.0\.0\.1:2019\/config\//)
  assert.match(runner, /set -o pipefail; wget -q -T 2 -O -/)
  assert.match(runner, /\| sha256sum/)
  assert.doesNotMatch(runner, /docker exec xdrive-caddy .*\/config\/.* > \//)
  assert.match(shellTest, /XD_CADDY_LIVE_SHA_FIXTURE/)
  assert.match(host, /LiveConfigSHA256/)
  assert.match(host, /caddyObservedLiveConfigState/)
  assert.match(preflight, /HostLiveConfigState:\s+caddyObservedLiveConfigState/)
  assert.match(client, /HostLiveConfigState/)
  assert.match(desktop, /host_live_config_state\?:/)
  assert.match(shared, /host_live_config_state\?:/)
  assert.match(panel, /data-xdrive-caddy-host-live-config-state/)
  assert.match(panel, /不证明管理员期望修订已经应用/)
  assert.match(preflight, /ApplySupported:\s+false/)
})

test('fixed Caddy generation fences multiple read-only probes without claiming apply', () => {
  const positive = good()
  positive.host_instance_generation = 'same-instance-local'
  assert.equal(validatorExports.verifyCaddyPreflightContract(positive).host_instance_generation, 'same-instance-local')
  const older = good()
  delete older.host_instance_generation
  assert.equal(validatorExports.verifyCaddyPreflightContract(older).host_instance_generation, undefined)
  const neutral = good()
  neutral.host_instance_generation = 'unverified'
  neutral.desired_domain_local_match = 'unverified'
  neutral.host_runtime_tls_alignment = 'unverified'
  assert.equal(validatorExports.verifyCaddyPreflightContract(neutral).host_instance_generation, 'unverified')
  for (const change of [
    x => { x.host_instance_generation = 'applied' },
    x => { x.host_instance_generation = null },
    x => { x.host_instance_generation = true },
    x => { x.host_instance_generation = 'same-instance-local'; x.host_observed = false },
    x => { x.host_instance_generation = 'same-instance-local'; x.host_ingress_ready = false },
    x => { x.host_instance_generation = 'same-instance-local'; x.host_local_tls_verified = false },
    x => {
      x.host_instance_generation = 'unverified'
      x.desired_domain_local_match = 'unverified'
      x.host_runtime_tls_alignment = 'unverified'
      x.host_live_config_state = 'observed-local'
    },
    x => { x.host_instance_generation = 'unverified'; x.host_runtime_tls_alignment = 'matched-local' },
    x => { x.host_instance_generation = 'unverified'; x.desired_domain_local_match = 'mismatch-local' },
  ]) {
    const forged = good()
    change(forged)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(forged))
  }
  const runner = read('scripts/server-control.sh')
  const fixture = read('scripts/test-caddy-host-status.sh')
  const status = read('internal/api/admin_caddy_host_status.go')
  const preflight = read('internal/api/admin_caddy_preflight.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const agent = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(runner, /caddy_container_generation_sample/)
  assert.match(runner, /\{\{\.State\.StartedAt\}\}/)
  assert.match(runner, /\{\{\.State\.Pid\}\}/)
  assert.match(runner, /generation_before/)
  assert.match(runner, /generation_after/)
  assert.match(runner, /same-instance-local/)
  assert.match(runner, /tls_domain_sha256=""/)
  assert.match(runner, /live_config_sha256=""/)
  assert.match(fixture, /XD_CADDY_GENERATION_NEXT_FIXTURE/)
  assert.match(status, /InstanceGenerationState/)
  assert.match(status, /caddyObservedInstanceGeneration/)
  assert.match(preflight, /HostInstanceGeneration:\s+caddyObservedInstanceGeneration/)
  assert.match(preflight, /ApplySupported:\s+false/)
  assert.match(client, /HostInstanceGeneration/)
  assert.match(agent, /host_instance_generation\?:/)
  assert.match(shared, /host_instance_generation\?:/)
  assert.match(panel, /data-xdrive-caddy-instance-generation/)
  assert.match(panel, /不证明 Caddy 配置从未热加载/)
})

test('Caddy rescue option is separate localhost-only and never a grant to apply', () => {
  const compose = read('deploy/docker-compose.yml')
  const caddyfile = read('deploy/Caddyfile.rescue')
  const dockerfile = read('deploy/Caddy.Dockerfile')
  const envExample = read('deploy/.env.example')
  const shellTest = read('scripts/test-caddy-rescue-profile.sh')
  const ci = read('.github/workflows/ci.yml')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  const preflight = read('internal/api/admin_caddy_preflight.go')
  assert.match(compose, /caddy-rescue:\n\s+profiles: \["caddy-rescue"\]/)
  assert.match(compose, /127\.0\.0\.1:\$\{XD_CADDY_RESCUE_PORT:-3080\}:8080\/tcp/)
  assert.match(compose, /\/etc\/caddy\/Caddyfile\.rescue/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /cap_drop:\n\s+- ALL/)
  assert.match(compose, /read_only: true/)
  assert.match(caddyfile, /admin off/)
  assert.match(caddyfile, /auto_https off/)
  assert.match(caddyfile, /:8080/)
  assert.doesNotMatch(caddyfile, /dns alidns|ALIYUN_ACCESS_KEY/)
  assert.match(dockerfile, /COPY deploy\/Caddyfile\.rescue/)
  assert.match(envExample, /XD_CADDY_RESCUE_PORT=3080/)
  assert.match(shellTest, /docker compose --profile caddy-rescue/)
  assert.match(shellTest, /"host_ip"\) == "127\.0\.0\.1"/)
  assert.match(ci, /bash scripts\/test-caddy-rescue-profile\.sh/)
  assert.match(ci, /caddy validate --config \/etc\/caddy\/Caddyfile\.rescue/)
  assert.match(panel, /data-xdrive-caddy-rescue-ingress-advisory/)
  assert.match(panel, /仍未获得运行验证/)
  assert.match(preflight, /ApplySupported:\s+false/)
  assert.match(preflight, /"restricted-apply", "blocked"/)
  assert.match(preflight, /"public-https", "unknown"/)
})

test('optional AliDNS runtime module detection stays read-only and backward compatible', () => {
  for (const state of ['present-local', 'absent-local', 'unverified']) {
    const value = good()
    value.host_alidns_module_state = state
    assert.equal(validatorExports.verifyCaddyPreflightContract(value).host_alidns_module_state, state)
  }
  const legacy = good()
  delete legacy.host_alidns_module_state
  assert.equal(validatorExports.verifyCaddyPreflightContract(legacy).host_alidns_module_state, undefined)
  const httpOnly = good()
  httpOnly.action = 'disable'
  httpOnly.desired_domain_local_match = 'unverified'
  httpOnly.host_runtime_tls_alignment = 'unverified'
  httpOnly.host_local_tls_verified = false
  httpOnly.checks[1].state = 'not-required'
  httpOnly.checks[2].state = 'not-required'
  httpOnly.host_alidns_module_state = 'present-local'
  assert.equal(validatorExports.verifyCaddyPreflightContract(httpOnly).host_alidns_module_state, 'present-local')
  for (const mutate of [
    x => { x.host_alidns_module_state = 'applied' },
    x => { x.host_alidns_module_state = null },
    x => { x.host_alidns_module_state = true },
    x => { x.host_alidns_module_state = 'present-local'; x.host_observed = false },
    x => { x.host_alidns_module_state = 'absent-local'; x.host_ingress_ready = false },
  ]) {
    const forged = good()
    mutate(forged)
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(forged))
  }
  const shell = read('scripts/server-control.sh')
  const fixture = read('scripts/test-caddy-host-status.sh')
  const host = read('internal/api/admin_caddy_host_status.go')
  const preflight = read('internal/api/admin_caddy_preflight.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const agent = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(shell, /caddy list-modules --skip-standard/)
  assert.match(shell, /grep -Fxq dns.providers.alidns/)
  assert.match(shell, /module_generation_before/)
  assert.match(shell, /module_generation_after/)
  assert.match(fixture, /XD_CADDY_MODULE_FIXTURE/)
  assert.match(host, /caddyObservedAliDNSModuleState/)
  assert.match(preflight, /HostAliDNSModuleState:\s+caddyObservedAliDNSModuleState/)
  assert.match(preflight, /ApplySupported:\s+false/)
  assert.match(client, /HostAliDNSModuleState/)
  assert.match(agent, /host_alidns_module_state\?:/)
  assert.match(shared, /host_alidns_module_state\?:/)
  assert.match(panel, /data-xdrive-caddy-alidns-module-state/)
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

test('preflight read-window revision verification is optional for old agents and fail-closed for forged values', () => {
  const goodSnapshot = good()
  assert.equal(validatorExports.verifyCaddyPreflightContract(goodSnapshot).revision_snapshot_consistent, true)
  const legacy = good()
  delete legacy.revision_snapshot_consistent
  assert.equal(validatorExports.verifyCaddyPreflightContract(legacy).revision_snapshot_consistent, undefined)
  for (const invalid of [false, null, 'true', 1, 'applied']) {
    const forged = good()
    forged.revision_snapshot_consistent = invalid
    assert.throws(() => validatorExports.verifyCaddyPreflightContract(forged))
  }
  const snapshot = read('internal/api/admin_caddy_preflight_snapshot.go')
  const api = read('internal/api/admin_caddy_preflight.go')
  const desired = read('internal/api/admin_caddy_https_desired.go')
  const credential = read('internal/api/admin_caddy_alidns.go')
  const client = read('internal/client/admin_caddy_preflight.go')
  const shared = read('ui/shared/src/service-dependencies.ts')
  const desktop = read('desktop/src/main/agent_client.cts')
  const panel = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')
  assert.match(snapshot, /sql\.LevelRepeatableRead,\s*ReadOnly:\s*true/)
  assert.match(snapshot, /sameCaddyPreflightSnapshot/)
  assert.match(snapshot, /subtle\.ConstantTimeCompare/)
  assert.match(desired, /readCaddyHTTPSDesiredDB\(db \*gorm\.DB\)/)
  assert.match(credential, /readCaddyAliDNSSettingDB\(db \*gorm\.DB\)/)
  assert.match(api, /readCaddyPreflightSnapshot\(c\.Request\.Context\(\)\)/)
  assert.match(api, /!sameCaddyPreflightSnapshot\(snapshot,\s*current\)/)
  assert.match(api, /http\.StatusConflict/)
  assert.match(api, /SnapshotStable:\s+true/)
  assert.match(client, /SnapshotStable/)
  assert.match(shared, /revision_snapshot_consistent\?:/)
  assert.match(desktop, /revision_snapshot_consistent\?:/)
  assert.match(panel, /data-xdrive-caddy-preflight-revision-snapshot/)
  assert.match(panel, /不代表宿主机已经应用/)
  assert.doesNotMatch(api + snapshot, /admin\.(?:POST|PUT|DELETE)\(".*services\/caddy\/https\/(?:apply|stop|restart)/)
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
