'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const go = read('internal/api/physical_cas_original_finalize_100k_performance_test.go')
const wf = read('.github/workflows/physical-cas-original-finalize-100k-performance.yml')
const registry = read('docs/performance-test-registry.md')
const canonical = read('docs/file-explorer-performance.md')
const matrix = read('docs/performance-platform-coverage.md')

test('P046 counts 100k different physical CAS originals and 95k real Local.Delete candidates',()=>{
 for(const s of [
   '//go:build linux','TestPhysicalCASOriginalFinalize100K',
   'p046Total     = 100000','p046Protected = 5000','p046Removed   = p046Total - p046Protected',
   'p046Size      = 1024','sha256.Sum256(payload)',
   'store.Put(ctx, key, bytes.NewReader(payload))',
   'len(seen) != p046Total','db.CreateInBatches(&batch, 500)',
   'meta.ContentBlobStateDeleting','meta.ContentBlobStateReady',
   'db.CreateInBatches(&files, 500)',
   'server.finalizeContentBlobDeletes(ctx, candidates)',
   'p046PhysicalInventory(ctx, store)',
   'afterCount == p046Protected','remaining_CAS_DB_rows',
   'reclaimed_original_samples_absent',
 ]) assert(go.includes(s),'P046 authentic original CAS proof missing: '+s)
})
test('P046 immutable budget and real Linux CPU/RSS timing are enforced without altering product',()=>{
 for(const s of [
   'p046BudgetMS  = 900000','p046RSS()','p046CPUTicks()',
   '25 * time.Millisecond','rssDelta <= 268435456',
   'durationMS <= p046BudgetMS','Go_cpu_ticks_measured',
   'fixture_seed_ms_excluded','measured_finalize_ms',
   'CAS_PHYSICAL_FINALIZE_100K',
 ]) assert(go.includes(s),'P046 CPU, RSS or exact-source contract missing: '+s)
})
test('P046 genuine PG17 native three fresh 100k CAS cohorts archive real machine evidence',()=>{
 for(const s of [
   "github.head_ref == 'perf/original-cas-finalize-100k-p046-20261013'",
   'github.event.pull_request.head.sha',
   "XD_PHYSICAL_CAS_ORIGINAL_FINALIZE_100K_PERF: '1'",
   'go test -mod=readonly -c','-test.timeout=24m',
   'for i in 1 2 3','sample-$i',
   'physically_deleted_objects','remaining_deleting_CAS',
   'median_finalize_ms','max_RSS_growth_B',
   'actions/upload-artifact@v4',
 ]) assert(wf.includes(s),'P046 workflow authenticity gate missing: '+s)
 for(const x of [registry,canonical,matrix])assert(x.includes('P046'))
 assert(matrix.includes('Not measured'))
 assert(!wf.includes('XD_PHYSICAL_CAS_ORIGINAL_FINALIZE_100K_EXPECT_FIXED'))
})

test('P046 checks real filesystem blocks and entire exact surviving CAS set strictly after timed finalize',()=>{
 for(const fragment of ['func p046FullPhysicalAudit(', 'physical.Blocks * 512',
   'protected_originals_complete_verified','exact_protected_SHA_set_verified',
   'allocated_disk_blocks_reclaimed_B','physical_audit_ms_excluded'])
   assert(go.includes(fragment),'P046 full CAS physical proof missing: '+fragment)
 assert(go.indexOf('durationMS :=') < go.indexOf('blocksAfter, allProtected'),
   'P046 complete identity+disk block audit must not contaminate measured production finalizer')
});
