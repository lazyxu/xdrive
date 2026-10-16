const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('native Stage leaves a bounded private restart hint without exposing execution', () => {
  const transport = read('internal/localpushstage/native_bytes_transport.go')
  const journal = read('internal/localpushstage/private_recovery_hint.go')
  const tests = read('internal/localpushstage/private_recovery_hint_test.go')
  const api = read('internal/api/router.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const desktop = read('desktop/src/main/index.cts')
  const web = read('web/src/App.tsx')
  const mui = read('ui/shared/src/mui/DeviceBackupPage.tsx')

  assert.match(transport, /SaveLocalOriginalRecoveryHint\(ctx, configDir, grant, receipt, relativePath\)/)
  assert.match(transport, /stageAccepted = true/)
  assert.ok(transport.indexOf('SaveLocalOriginalRecoveryHint(ctx, configDir, grant, receipt, relativePath)') <
    transport.lastIndexOf('stageAccepted = true'), 'hint must be stored before reporting success')
  for (const symbol of [
    'func SaveLocalOriginalRecoveryHint(', 'func ReadLocalOriginalRecoveryHint(',
    'func ListLocalOriginalRecoveryHints(',
    'localpush.LoadRootGrant(', 'localpush.LocalInventoryPathKey(',
    'os.CreateTemp(', 'tmp.Sync()', 'os.Rename(',
  ]) assert.ok(journal.includes(symbol), 'missing local private recovery guard: ' + symbol)
  assert.match(journal, /localStageRecoveryMaxFiles\s+= 128/)
  const disk = journal.split('type localStageRecoveryDisk struct {')[1]?.split('\n}')[0] || ''
  assert.ok(disk.includes('CurrentPathKey') && disk.includes('StageID'))
  assert.doesNotMatch(disk, /\b(?:Server|Account|Token|Password|AbsolutePath|LocalRootPath)\b/)
  assert.match(tests, /TestLocalOriginalRecoveryHintPersistsExactBoundedPrivateStageAfterRestart/)
  assert.match(tests, /TestLocalOriginalRecoveryHintNeverListsUnboundedCandidateQueue/)
  for (const surface of [api, agent, desktop, web, mui]) {
    for (const name of [
      'SaveLocalOriginalRecoveryHint', 'ReadLocalOriginalRecoveryHint',
      'ListLocalOriginalRecoveryHints',
    ]) assert.equal(surface.includes(name), false, 'private recovery hint leaked: ' + name)
  }
  assert.doesNotMatch(journal, /\b(?:BeginSourceRun|CommitSourceRun|StartBackup|TriggerSource|DeleteSource)\(/)
})
