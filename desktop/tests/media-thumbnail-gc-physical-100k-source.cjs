'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
test('100k real physical cached JPEG GC is opt-in and never original CAS GC',()=>{
  const source=read('internal/maintenance/media_thumbnail_gc_physical_100k_performance_test.go')
  for(const tag of [
    'XD_MEDIA_THUMBNAIL_GC_PHYSICAL_100K_PERF',
    'physicalThumbnailGCFiles100K = 100000',
    'physicalThumbnailGCProtected = 2500',
    'physicalThumbnailGCYoung',
    'GarbageCollectMediaThumbnails(runCtx, db, root, true)',
    'GarbageCollectMediaThumbnails(runCtx, db, root, false)',
    'originalCASIntact',
    'jpeg.DecodeConfig(file)',
    'dryMS > 30000',
    'applyMS > 180000',
    'idempotentMS > 30000',
    'peakGrowth > 256*1024*1024',
    'physicalThumbnailGCReadCPUTicks',
    'native_go_process_cpu_ticks',
  ])assert.ok(source.includes(tag),'missing actual physical-cache scope/gate '+tag)
  assert.match(source, /physicalThumbnailGCYoung\s*=\s*2500/)
  assert.ok(!source.includes('deleteLegacyStorageKeys('))
})
test('native 3-fresh-physical-cohort workflow retains fixed original budgets',()=>{
  const workflow=read('.github/workflows/media-thumbnail-gc-physical-100k-performance.yml')
  assert.ok(workflow.includes('github.event.pull_request.head.sha'))
  assert.ok(workflow.includes('go test -c -o desktop/media-thumbnail-gc-physical-100k-bin/maintenance.test'))
  assert.ok(workflow.includes('for fixture in 1 2 3; do'))
  assert.ok(workflow.includes('dry_run_ms'))
  assert.ok(workflow.includes('apply_ms'))
  assert.ok(workflow.includes('95000'))
})
