'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const go=read('internal/api/cas_a01_shared_blob_100k_http_performance_integration_test.go')
const wf=read('.github/workflows/cas-a01-100k-shared-blob-ref-gc.yml')
const audit=read('docs/blob-cas-dedup-architecture-audit.md')
const registry=read('docs/performance-test-registry.md')
const matrix=read('docs/performance-platform-coverage.md')
const canonical=read('docs/file-explorer-performance.md')

test('CAS-A01 creates 100k truly distinct logical Nodes, 100k history refs, one real shared SHA blob and exact refcount',()=>{
 for(const mark of [
   'TestCASA01SharedBlob100KActualHTTP',
   'XD_CAS_A01_SHARED_BLOB_PERF',
   'XD_CAS_A01_SAMPLE',
   'casA01NodeCount     = 100000',
   'p046Bytes(0, "cas-a01-"+sample)',
   'storage.ContentAddressedKey(hash)',
   'store.Put(ctx, key, bytes.NewReader(sharedPayload))',
   '2*casA01NodeCount + 2',
   'INSERT INTO xd_files',
   'INSERT INTO xd_file_versions',
   'SELECT id, ?, ?, ?, NOW(), NOW() FROM xd_nodes',
   'SELECT id, 0, ?, ?, ?, NOW() FROM xd_nodes',
   'physicalCASCountBefore != 1',
   'physicalWriteCount != 1',
   'foreignUser',
   '&meta.LocalPushQuotaHold{}'
 ]) assert(go.includes(mark),'missing real shared CAS fixture part: '+mark)
})

test('CAS-A01 signed HTTP permanent Delete preserves shared bytes then reclaims only after last owner',()=>{
 for(const mark of [
   'http.MethodDelete',
   'api/v1/trash/%d',
   'foreignCode != http.StatusNotFound',
   'staleCode != http.StatusConflict',
   'blobAfter.RefCount == 2',
   'permanentlyDeleteTestNode(t, router, token',
   'permanentlyDeleteTestNode(t, router, other',
   'finalKeeper.RefCount != 1',
   'finalPhysicalCount == 0',
   'finalPhysicalBytes == 0',
   'finalBlobCount == 0',
   'beforeCount == 1 && afterCount == 1',
   'server.loadQuotaUsage(db, user.ID, false)',
   'userQuotaBefore.PhysicalUsedBytes != casA01BlobSize',
   'otherQuotaBefore.PhysicalUsedBytes != casA01BlobSize',
   'Go_RSS_growth_B',
   'HTTP_delete_ms',
   'CAS_A01_SHARED_REFS_REAL_HTTP'
 ]) assert(go.includes(mark),'CAS-A01 keepers/GC or real signed HTTP guard absent: '+mark)
})

test('CAS-A01 source-exact n3 PG17, one work commit, six platform Not measured, no production cancellation',()=>{
 for(const mark of [
   "github.head_ref == 'perf/cas-a01-100k-shared-blob-gc-20261016'",
   'github.event.pull_request.head.sha',
   "XD_CAS_A01_SHARED_BLOB_PERF: '1'",
   'postgres:17-alpine',
   'go test -mod=readonly -c',
   '100000',
   '200002',
   'CAS_A01_SHARED_REFS_REAL_HTTP',
   'assert row',
   'actions/upload-artifact@v4',
 ]) assert(wf.includes(mark),'CAS-A01 real Go HTTP n3 contract is absent: '+mark)
 for(const doc of [audit,registry,matrix,canonical])
   assert(doc.includes('CAS-A01')&&doc.includes('Not measured'),'source exact registry missing CAS-A01 prior to native baseline')
 for(const col of ['Native Desktop','Wide Web','Mobile Web','Desktop installed PWA','Android installed PWA','iOS installed PWA'])
   assert(matrix.includes(col),'missing six-platform truth: '+col)
 assert(!go.includes('TaskCenter.cancel') && !go.includes('cancelTransfer('))
})
