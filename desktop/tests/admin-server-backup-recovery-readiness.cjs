const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const js = ts.transpileModule(read('ui/shared/src/server-backup-recovery-readiness.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
new Function('exports', js)(exported)
const assess = exported.assessServerBackupRecoveryReadiness
const trustedDrill = exported.isTrustedServerBackupIsolatedDrill

const id = 'v2-default:xdrive-backup-20261028T030000Z'
const snapshot = { id, name:'xdrive-backup-20261028T030000Z',
  state:'complete', format:'v2', file_data_included:true }
const page = s => ({ inventory:{snapshots:[s]} })
const proof = {
  protocol:'xdrive-host-backup-verify-v1',
  state:'success', format:'v2', scope:'backup_snapshot_and_referenced_cas',
  cas_objects_checked:10, cas_bytes_hashed:2048,
}
const verify = { action:'verify', state:'success', verification:proof }
const drill = {
  action:'drill', snapshot_id:id, state:'success', drill: {
    protocol:'xdrive-host-isolated-drill-v1',
    state:'success', environment:'host_ephemeral_offline_tmpfs',
    snapshot:snapshot.name, files_restored:true, postgresql_restored:true,
    production_verified:false, max_mib:1024, failure_category:'',
    started_at:'2026-10-28T03:00:00Z', finished_at:'2026-10-28T03:02:00Z',
  },
}
const evidence = (v=verify,d=drill) => ({
  snapshotKind:'complete_candidate', lastVerify:v, lastDrill:d,
  lastRestore:null, hostIsolatedDrill:'not_verified', ciDrillForDeployedHost:'not_attested',
})

test('no current snapshot or incomplete content never earns a restore-ready label', () => {
  assert.equal(assess({inventory:{snapshots:[]}},evidence(),id).state,'none')
  assert.equal(assess(page({...snapshot,state:'inconsistent'}),
    evidence(),id).state,'unsafe')
  assert.equal(assess(page({...snapshot,file_data_included:false}),
    evidence(),id).state,'unsafe')
})

test('latest verify failure overrides previous success and old unstructured success', () => {
  assert.equal(assess(page(snapshot),evidence({...verify,state:'failed'}),id).state,'verify_failed')
  assert.equal(assess(page(snapshot),evidence({...verify,verification:{...proof,state:'failed'}}),id).state,
    'verify_failed')
  assert.equal(assess(page(snapshot),evidence({state:'success'},drill),id).state,'verify_unattested')
  assert.equal(assess(page(snapshot),evidence({...verify,verification:{...proof,format:'v1'}}),id).state,
    'verify_unattested')
})

test('v2 needs real file and PostgreSQL isolated recovery proof, not a synthetic success', () => {
  assert.equal(assess(page(snapshot),evidence(verify,null),id).state,'drill_missing')
  assert.equal(assess(page(snapshot),evidence(verify,{...drill,drill:{...drill.drill,postgresql_restored:false}}),id).state,
    'drill_missing')
  assert.equal(assess(page(snapshot),evidence(verify,{...drill,state:'failed'}),id).state,'drill_failed')
  const historical = assess(page(snapshot),evidence(),id)
  assert.equal(historical.state,'v2_historical_only')
  assert.match(historical.action,/正式恢复前必须重新验证/)
})

test('v1 historical verification is separate from v2 RAM recovery drill', () => {
  const v1 = {...snapshot,id:'v1:xdrive-backup-20261028T030000Z',format:'v1'}
  const result=assess(page(v1),evidence({...verify,verification:{
    ...proof,format:'v1',cas_objects_checked:0,cas_bytes_hashed:0,
  }},null),v1.id)
  assert.equal(result.state,'v1_historical_only')
  assert.match(result.action,/只支持 v2/)
})

test('shared UI presents conservative evidence without adding a destructive shortcut', () => {
  const ui=read('ui/shared/src/mui/BackupRecoveryEvidencePanel.tsx')
  assert.match(ui,/assessServerBackupRecoveryReadiness\(page, evidence, snapshotID\)/)
  assert.match(ui,/data-xdrive-admin-backup-recovery-readiness/)
  assert.match(ui,/历史/)
  assert.doesNotMatch(ui,/action: 'restore'/)
})

test('isolated recovery success requires exact snapshot, environment and evidence identity', () => {
  assert.equal(trustedDrill(drill, snapshot), true)
  const invalid = [
    {...drill, snapshot_id:'v2-default:xdrive-backup-20261028T040000Z'},
    {...drill, action:'restore'},
    {...drill, drill:{...drill.drill, snapshot:'another-generation'}},
    {...drill, drill:{...drill.drill, protocol:'unrecognized'}},
    {...drill, drill:{...drill.drill, environment:'production'}},
    {...drill, drill:{...drill.drill, files_restored:false}},
    {...drill, drill:{...drill.drill, postgresql_restored:false}},
    {...drill, drill:{...drill.drill, production_verified:true}},
    {...drill, drill:{...drill.drill, failure_category:'runtime_unavailable'}},
    {...drill, drill:{...drill.drill, max_mib:1025}},
    {...drill, drill:{...drill.drill, started_at:'invalid'}},
    {...drill, drill:{...drill.drill, finished_at:'2026-10-28T02:00:00Z'}},
  ]
  for (const receipt of invalid) {
    assert.equal(trustedDrill(receipt, snapshot), false)
    assert.equal(assess(page(snapshot), evidence(verify, receipt), id).state, 'drill_missing')
  }
  assert.equal(trustedDrill(drill, {...snapshot, format:'v1'}), false)
  assert.equal(trustedDrill(drill, {...snapshot, file_data_included:false}), false)
  assert.equal(trustedDrill(null, snapshot), false)
  const ui = fs.readFileSync(path.join(root, 'ui/shared/src/mui/BackupRecoveryEvidencePanel.tsx'), 'utf8')
  assert.match(ui, /isTrustedServerBackupIsolatedDrill\(event, snapshot\)/)
  assert.match(ui, /drillLabel\(evidence\.lastDrill, selectedSnapshot\)/)
})


test('recovery readiness rejects unverifiable format, protocol and hash counters', () => {
  for (const invalid of [
    { ...proof, protocol: 'legacy' },
    { ...proof, scope: 'metadata_only' },
    { ...proof, cas_objects_checked: -1 },
    { ...proof, cas_bytes_hashed: Number.MAX_SAFE_INTEGER + 1 },
    { ...proof, failure_category: 'object_sha256_mismatch' },
  ]) {
    assert.equal(assess(page(snapshot), evidence({ ...verify, verification: invalid }), id).state,
      'verify_unattested')
  }
  assert.equal(assess(page(snapshot), evidence(verify, drill), id).state, 'v2_historical_only')
})
