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

const id = 'v2-default:xdrive-backup-20261028T030000Z'
const snapshot = { id, name:'xdrive-backup-20261028T030000Z',
  state:'complete', format:'v2', file_data_included:true }
const page = s => ({ inventory:{snapshots:[s]} })
const proof = {
  state:'success', format:'v2', scope:'backup_snapshot_and_referenced_cas',
  cas_objects_checked:10, cas_bytes_hashed:2048,
}
const verify = { action:'verify', state:'success', verification:proof }
const drill = {
  action:'drill', state:'success', drill: {
    state:'success', environment:'host_ephemeral_offline_tmpfs',
    snapshot:snapshot.name, files_restored:true, postgresql_restored:true,
    production_verified:false,
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
  const v1 = {...snapshot,format:'v1'}
  const result=assess(page(v1),evidence({...verify,verification:{...proof,format:'v1'}},null),id)
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
