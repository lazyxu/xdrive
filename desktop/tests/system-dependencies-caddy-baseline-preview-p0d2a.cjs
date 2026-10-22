'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
function moduleFromTS(code, requireFn=()=>{ throw new Error('unexpected dependency') }) {
  const js = ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText
  const moduleRef = { exports: {} }
  new Function('exports','module','require',js)(moduleRef.exports,moduleRef,requireFn)
  return moduleRef.exports
}
const reconciled = moduleFromTS(read('ui/shared/src/caddy-reconciliation.ts'))
const original = read('ui/shared/src/caddy-host-baseline-preview.ts')
const { assessCaddyHostBaselineReadOnly: assess } = moduleFromTS(original, (name) => {
  assert.equal(name,'./caddy-reconciliation')
  return reconciled
})
const config = { revision: 3, source: 'saved', desired_enabled: true, desired_domain: 'files.example.com',
  desired_lan_enabled: true, desired_lan_ip: '192.168.10.2', host_apply_pending: false, host_observed: true }
const preflight = { desired_revision: 3, credential_revision: 1, revision_snapshot_consistent: true,
  host_observed: true, host_ingress_ready: true, host_local_tls_verified: true,
  host_lan_local_tls_verified: true, desired_domain_local_match: 'matched-local',
  desired_lan_local_match: 'matched-local', host_instance_generation: 'same-instance-local',
  host_live_config_state: 'observed-local', ingress_change_risk: 'unverified',
  apply_supported: false }

test('P0-D2a: even all matching local evidence never permits adopt/apply', () => {
  const result = assess(config, preflight)
  assert.equal(result.can_adopt,false)
  assert.equal(result.readonly_mode,true)
  assert.equal(result.desired_revision,3)
  assert.equal(result.domain_comparison,'matched-local')
  assert.equal(result.lan_comparison,'matched-local')
  assert.ok(result.blockers.some(x=>x.includes('数据库 CAS')))
})

test('P0-D2a: Host local mismatch is disclosed only read-only', () => {
  const result=assess(config,{...preflight,desired_domain_local_match:'mismatch-local',
    desired_lan_local_match:'mismatch-local',ingress_change_risk:'local-lan-switch'})
  assert.equal(result.domain_comparison,'mismatch-local')
  assert.equal(result.lan_comparison,'mismatch-local')
  assert.equal(result.ingress_change_risk,'local-lan-switch')
  assert.equal(result.can_adopt,false)
})

test('P0-D2a: revision zero, stale preflight, missing Host witness and older Agent deny proof', () => {
  for (const [cfg,pf] of [
    [{...config,revision:0,source:'default'},preflight],
    [config,{...preflight,desired_revision:4}],
    [config,{...preflight,revision_snapshot_consistent:undefined}],
    [config,{...preflight,host_observed:false}],
    [config,{...preflight,host_lan_local_tls_verified:undefined,
      desired_lan_local_match:undefined}],
    [null,preflight],
  ]) {
    const result=assess(cfg,pf)
    assert.equal(result.can_adopt,false)
    assert.ok(result.blockers.length>0)
    if (!cfg || cfg.revision!==pf.desired_revision ||
        pf.revision_snapshot_consistent!==true || pf.host_observed!==true) {
      assert.equal(result.domain_comparison,'unverified')
      assert.equal(result.lan_comparison,'unverified')
    }
  }
  const pending=assess({...config,host_apply_pending:true},preflight)
  assert.ok(pending.blockers.some(x=>x.includes('Host Pending')))
  assert.equal(pending.can_adopt,false)
})

test('P0-D2a: removed baseline UI cannot accidentally adopt Host state or reflow the form', () => {
  const page = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const legacy = read('ui/shared/src/mui/CaddyHostBaselinePreviewPanel.tsx')
  assert.doesNotMatch(page, /XDriveCaddyHostBaselinePreviewPanel/)
  assert.doesNotMatch(page, /data-xdrive-caddy-v1-runtime-desired-drift/)
  assert.doesNotMatch(page, /运行与目标配置存在差异|caddy-v1-history/)
  assert.match(https, /data-xdrive-caddy-running-lan-ip/)
  assert.match(https, /host_lan_tls_state === 'verified'/)
  assert.match(page, /<XDriveCaddyPreflightPanel source=\{source\}/)
  assert.match(legacy, /verifyCaddyPreflightContract\(await source\.loadCaddyHTTPSPreflight\(\)\)/)
  for (const unsafe of ['saveCaddyHTTPSConfig', 'rollbackCaddyHTTPS',
    'verifyCaddyAliDNSRead', 'revealCaddyAliDNS', 'loadCaddyHTTPSHostPlan',
    'InsecureSkipVerify', 'docker restart', 'applyCaddy']) {
    assert.equal(legacy.includes(unsafe), false, unsafe)
  }
  assert.equal(original.includes('can_adopt: true'), false)
  assert.equal(original.includes('apply_supported = true'), false)
})

test('P0-D2a: page refresh and atomic Save still guard unsaved drafts after UI cleanup', () => {
  const owner = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const legacy = read('ui/shared/src/mui/CaddyHostBaselinePreviewPanel.tsx')
  assert.match(owner, /if \(hasUnsavedEdits\) return/)
  assert.match(owner, /savePendingRef\.current/)
  assert.match(owner, /epoch !== saveEpoch\.current/)
  assert.match(owner, /onDirtyChange=\{onHTTPSDirtyChange\}/)
  assert.match(owner, /onDirtyChange=\{onAliDNSDirtyChange\}/)
  assert.doesNotMatch(owner, /XDriveCaddyHostBaselinePreviewPanel/)
  // Legacy model remains independently inert even though its dialog is no longer mounted.
  assert.match(legacy, /const current = !hasUnsavedEdits &&/)
  assert.match(legacy, /\}, \[source, config, evidenceRevision, active, hasUnsavedEdits\]\)/)
})
