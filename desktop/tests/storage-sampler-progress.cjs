const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const models = read('internal', 'meta', 'models.go')
const status = read('internal', 'api', 'system_maintenance_status.go')
const tasks = read('internal', 'api', 'system_maintenance_tasks.go')
const history = read('internal', 'api', 'storage_history.go')
const gc = read('internal', 'api', 'storage_intelligence.go')
const staging = read('internal', 'api', 'upload_staging.go')
const inventory = read('internal', 'api', 'storage_inventory.go')
const shared = read('ui', 'shared', 'src', 'background-tasks.ts')
const taskCenter = read('ui', 'shared', 'src', 'mui', 'BackgroundTaskCenter.tsx')
const docs = read('docs', 'background-scheduler.md')

test('Storage sampler persists real Task Center scan telemetry', () => {
  for (const token of [
    'ProgressCurrent',
    'ProgressTotal',
    'ProgressUnit',
    'ProgressBytes',
    'ProgressErrors',
    'ProgressMessage',
  ]) assert.ok(models.includes(token), 'durable maintenance progress field missing: ' + token)

  for (const phase of [
    'storage_sample_stats',
    'storage_sample_gc',
    'storage_sample_health',
    'storage_sample_staging',
    'storage_sample_inventory',
    'storage_sample_persist',
  ]) {
    assert.ok(models.includes(`"${phase}"`), 'storage sampler phase missing: ' + phase)
    assert.ok(shared.includes(`case '${phase}'`), 'shared phase label missing: ' + phase)
  }

  assert.ok(status.includes('"progress_bytes":   progress.BytesCurrent'))
  assert.ok(status.includes('"progress_errors":  progress.Errors'))
  assert.ok(status.includes('progress.BytesCurrent = run.ProgressBytes'))
  assert.ok(status.includes('progress.Errors = run.ProgressErrors'))
})

test('Storage sampler reports real scanner counts without pre-counting streaming walks', () => {
  assert.ok(history.includes('captureStorageSampleWithProgress'))
  assert.ok(history.includes('loadUnreferencedContentBlobSnapshotWithProgress'))
  assert.ok(history.includes('loadUploadStagingInventoryFreshWithProgress'))
  assert.ok(history.includes('scanStorageInventoryWithProgress'))
  assert.ok(gc.includes('Total:       total'), 'known zero-reference Blob set should expose a real total')
  assert.ok(gc.includes('Current:     int64(index + 1)'))
  assert.ok(staging.includes('Current:     stats.StagingFiles'))
  assert.ok(staging.includes('Bytes:       stats.StagingBytes'))
  assert.ok(inventory.includes('Current:     scannedFiles'))
  assert.ok(inventory.includes('Bytes:       scannedBytes'))
  assert.equal(inventory.includes('CountManagedFiles'), false, 'inventory must not pre-scan just to manufacture total')
  assert.ok(tasks.includes('storageSamplerProgressPersistInterval'))
  assert.ok(tasks.includes('500 * time.Millisecond'))
})

test('Task Center renders unknown-total sampler scans as indeterminate with item byte and error telemetry', () => {
  assert.ok(shared.includes("task.kind === 'system.maintenance.storage_sampler'"))
  assert.ok(shared.includes('task.progress?.bytes_current'))
  assert.ok(shared.includes('task.progress?.errors'))
  assert.ok(shared.includes("parts.push(formatBytes(task.progress.bytes_current ?? 0))"))
  assert.ok(taskCenter.includes("variant={percent === undefined && active ? 'indeterminate' : 'determinate'}"))
  assert.ok(docs.includes('must not pre-scan solely to manufacture a percentage'))
})
