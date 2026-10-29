const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const javascript = ts.transpileModule(
  read('ui/shared/src/server-backup-verification-guidance.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const exported = {}
new Function('exports', javascript)(exported)
const guide = exported.backupVerificationGuidance
const base = {
  action: 'verify', state: 'success', mode: 'fast',
  verification: {
    format: 'v2', state: 'success', scope: 'backup_snapshot_and_referenced_cas',
    cas_objects_checked: 4, cas_bytes_hashed: 400,
  },
}

test('historical success, fast and deep do not assert present recoverability', () => {
  const fast = guide(base)
  assert.match(fast.scope, /不声称已覆盖未引用的仓库 CAS/)
  assert.match(fast.nextAction, /恢复前必须重新验证/)
  assert.equal(fast.needsAttention, false)
  const deep = guide({...base, mode:'deep'})
  assert.match(deep.scope, /额外请求独立仓库对象深查/)
  assert.equal(deep.needsAttention, false)
  assert.match(guide({...base,verification:{...base.verification, format:'v1'}}).scope,/SHA256SUMS/)
})

test('missing Host proof never manufactures integrity or byte coverage', () => {
  const old = guide({ action:'verify', state:'success' })
  assert.equal(old.needsAttention, false)
  assert.match(old.scope,/没有可信的结构化范围凭据/)
  assert.match(old.nextAction,/重新对选中快照运行校验/)
})

test('actual failed CAS categories require operator intervention without printing paths', () => {
  for (const [category, word] of [
    ['missing_object','缺失对象'],
    ['object_sha256_mismatch','SHA-256'],
    ['invalid_legacy_archive','归档路径'],
    ['unsafe_repository','宿主机管理员'],
    ['invalid_object_index','索引'],
  ]) {
    const advice = guide({
      ...base, state:'failed',
      verification:{...base.verification, state:'failed', failure_category:category},
    })
    assert.equal(advice.needsAttention, true)
    assert.ok(advice.nextAction.includes(word), category)
  }
  const unknown = guide({
    ...base, state:'failed',
    verification:{...base.verification, state:'failed',
      failure_category:'/root/private-path-secret'},
  })
  assert.equal(unknown.needsAttention, true)
  assert.equal(JSON.stringify(unknown).includes('/root/'), false)
})

test('failed overall admin operation cannot be hidden by a successful CAS receipt', () => {
  const result=guide({...base,state:'failed',mode:'deep'})
  assert.equal(result.needsAttention,true)
  assert.match(result.nextAction,/整体失败/)
})

test('shared Administrator UI shows bounded guidance and does not expose raw Host logs', () => {
  const panel=read('ui/shared/src/mui/BackupVerificationReceipt.tsx')
  assert.match(panel,/backupVerificationGuidance\(entry\)/)
  assert.match(panel,/data-xdrive-admin-backup-verification-scope/)
  assert.match(panel,/data-xdrive-admin-backup-verification-next-action/)
  assert.doesNotMatch(panel,/console\.(log|error)/)
})
