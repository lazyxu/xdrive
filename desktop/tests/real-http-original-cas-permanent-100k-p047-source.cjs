'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const read=p=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8')
const go=read('internal/api/trash_permanent_physical_cas_100k_performance_integration_test.go')
const normalizedGo=go.replace(/\s+/g,' ')
const productionContent=read('internal/api/content_blobs.go')
const wf=read('.github/workflows/real-http-original-cas-permanent-100k-p047.yml')
const reg=read('docs/performance-test-registry.md')
const perf=read('docs/file-explorer-performance.md')
const matrix=read('docs/performance-platform-coverage.md')
test('P047 genuine 100k SHA-distinct 1KiB original Local CAS with 2 metadata references each',()=>{
 for(const s of ['p047SourceCount = 100000','p047SourceBytes = 1024','p046Bytes(index, "p047-"+sample)',
  'store.Put(ctx, key, bytes.NewReader(payload))','len(unique) != p047SourceCount',
  'RefCount: 2','meta.FileVersion','p046PhysicalInventory(ctx, store)'])
  assert(normalizedGo.includes(s),'real 100k physical original CAS missing '+s)
})
test('P047 signed real HTTP permanent trash route and owner/revision audit',()=>{
 for(const s of ['httptest.NewServer(router)','http.MethodDelete','/api/v1/trash/%d',
  'createTestUser(t, db, router','foreignCode != http.StatusNotFound',
  'staleCode != http.StatusConflict','beforeCount-afterCount == p047SourceCount',
  'selectedNodes == 0','fileRows == 1','versionRows == 0','blobRows == 1',
  'onlyProtectedPhysical','auth_audit_rows','P047_REAL_HTTP_PERMANENT_CAS_100K'])
  assert(normalizedGo.includes(s),'full HTTP permanent original CAS proof missing '+s)
})
test('P047 frozen original CURRENT n3, test-only and no fake synchronous benchmark',()=>{
 for(const s of ['p047HTTPMaxMS = 1200000','p047RSSGrowthMaxB = 536870912',
  '25 * time.Millisecond','httpMS <= p047HTTPMaxMS',
  'rssGrowth <= p047RSSGrowthMaxB','seed_ms_excluded','post_timer_audit_ms'])
  assert(normalizedGo.includes(s),'immutable P047 original gate missing '+s)
 for(const s of ["github.head_ref == 'perf/real-http-permanent-original-cas-100k-p047-20261013'",
  "XD_P047_REAL_HTTP_ORIGINAL_CAS_PERF: '1'",'github.event.pull_request.head.sha',
  'for i in 1 2 3','go test -mod=readonly -c','median_HTTP_ms',
  'P047_REAL_HTTP_PERMANENT_CAS_100K','actions/upload-artifact@v4'])
  assert(wf.includes(s),'P047 real source CI missing '+s)
 for(const s of [reg,perf,matrix]) assert(s.includes('P047'))
 assert(matrix.includes('Not measured'))
})
test('P047 measured RED: existing ContentBlob row locking stays while transaction-scoped 100k hash locks are removed',()=>{
 assert(productionContent.includes('clause.Locking{Strength: "UPDATE"}'),'persistent ContentBlob row lock required')
 assert(productionContent.includes('rows, err := loadContentReferenceBatchTx(tx, batch)'),'row locking must bound shared advisory memory')
 assert(!productionContent.includes('lockContentReferenceBatchTx('),'unbounded advisory lock should not be retained')
 const perf=read('internal/api/content_reference_release_performance_integration_test.go')
 assert(perf.includes('if statementCount != 2'),'batch round trips need new exact structural budget')
})

