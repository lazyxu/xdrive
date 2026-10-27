const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/server-backup-verification.ts'), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
new Function('exports', javascript)(exportsObject)
const summarize = exportsObject.backupVerificationSummary

test('older records do not invent verifier object or byte counts', () => {
  const result = summarize({ action: 'verify', state: 'success' })
  assert.equal(result.available, false)
  assert.equal(result.count, null)
  assert.equal(result.hashedBytes, null)
  assert.match(result.note, /不能推断对象数量/)
})

test('failed CAS report retains partial byte evidence without raw paths', () => {
  const result = summarize({
    action: 'verify', state: 'failed',
    verification: {
      state: 'failed', format: 'v2',
      failure_category: 'object_sha256_mismatch',
      cas_objects_checked: 3, cas_bytes_hashed: 1337,
    },
  })
  assert.equal(result.available, true)
  assert.equal(result.count, 3)
  assert.equal(result.hashedBytes, 1337)
  assert.match(result.category, /SHA-256/)
  assert.match(result.note, /部分计数/)
  assert.equal(JSON.stringify(result).includes('/root/'), false)
})

test('v1 zero CAS counters do not imply that no backup bytes were checked', () => {
  const result = summarize({
    action: 'verify', state: 'success',
    verification: {
      state: 'success', format: 'v1',
      cas_objects_checked: 0, cas_bytes_hashed: 0,
    },
  })
  assert.equal(result.available, true)
  assert.match(result.note, /SHA256SUMS/)
  assert.match(result.title, /历史/)
  const component = fs.readFileSync(path.join(
    root, 'ui/shared/src/mui/BackupVerificationReceipt.tsx'), 'utf8')
  assert.match(component, /data-xdrive-admin-backup-verification-report/)
  assert.match(component, /不代表已完成 PostgreSQL 与文件恢复演练/)
})
