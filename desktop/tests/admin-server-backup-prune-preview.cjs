const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const js = ts.transpileModule(read('ui/shared/src/server-backup-prune-preview.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
new Function('exports', js)(exported)
const { canPruneServerBackup } = exported

const requestID = '0123456789abcdef01234567'
const preview = (mode = 'fast') => ({ requestID, keepLast: 7, mode })
const page = (mode = 'fast') => ({
  supported: true,
  operation: { action: 'plan', state: 'success', request_id: requestID },
  retention: {
    mode: 'read_only', delete_enabled: false, keep_last: 7,
    validation: mode === 'fast' ? 'snapshot_sha256_and_cas_size' :
      'snapshot_sha256_and_full_cas_sha256',
    drop_candidates: ['xdrive-backup-20261024T120000Z'],
    unreferenced_objects: 0,
  },
})

test('v2 deletion is gated by exact successful Host preview from this UI session', () => {
  assert.equal(canPruneServerBackup(page(), 7, 'fast', preview()), true)
  assert.equal(canPruneServerBackup(page('deep'), 7, 'deep', preview('deep')), true)
  assert.equal(canPruneServerBackup(page(), 7, 'fast', null), false)
  assert.equal(canPruneServerBackup(page(), 8, 'fast', preview()), false)
  assert.equal(canPruneServerBackup(page(), 7, 'deep', preview()), false)
  assert.equal(canPruneServerBackup(page(), 7, 'fast', { ...preview(), requestID: 'old' }), false)
})

test('stale, failed, unsupported or non-deleteable Host results never authorize pruning', () => {
  const variations = [
    { supported: false },
    { operation: { ...page().operation, state: 'running' } },
    { operation: { ...page().operation, state: 'failed' } },
    { operation: { ...page().operation, action: 'create' } },
    { operation: { ...page().operation, request_id: 'another-request' } },
    { retention: { ...page().retention, mode: 'write' } },
    { retention: { ...page().retention, delete_enabled: true } },
    { retention: { ...page().retention, keep_last: 8 } },
    { retention: { ...page().retention, validation: 'unknown' } },
    { retention: { ...page().retention, drop_candidates: [], unreferenced_objects: 0 } },
    { retention: undefined },
  ]
  for (const change of variations) {
    assert.equal(canPruneServerBackup({ ...page(), ...change }, 7, 'fast', preview()), false)
  }
  assert.equal(canPruneServerBackup(page(), 0, 'fast', preview()), false)
  assert.equal(canPruneServerBackup(page(), 1001, 'fast', preview()), false)
})

test('backup admin clears old Host/Owner responses and preview after a port change', () => {
  const panel = read('ui/shared/src/mui/ServerBackupManagementPanel.tsx')
  assert.match(panel, /const page = loaded\?\.port === port \? loaded\.page : null/)
  assert.match(panel, /generation !== sessionGeneration\.current \|\| read !== latestRead\.current/)
  assert.match(panel, /setLoaded\(null\)/)
  assert.match(panel, /setPrunePreview\(null\)/)
  assert.match(panel, /page\.operation\.request_id !== preview\.requestID|canPruneServerBackup\(page/)
  assert.match(panel, /disabled=\{disabled \|\| !canPrune\}/)
  assert.match(panel, /data-xdrive-admin-backup-prune-preview-guard/)
})
