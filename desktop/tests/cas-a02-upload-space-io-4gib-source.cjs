'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=f=>fs.readFileSync(path.join(root,f),'utf8')
const wf=read('.github/workflows/cas-a02-4gib-first-upload-space-io.yml')
const runner=read('desktop/scripts/real-web-cas-transfer-runner.cjs')
const go=read('internal/api/real_web_cas_transfer_fixture_performance_integration_test.go')
const docs=['docs/performance-test-registry.md','docs/performance-platform-coverage.md',
  'docs/file-explorer-performance.md','docs/blob-cas-dedup-architecture-audit.md'].map(read)
test('A02 real 4GiB P044 production high entropy transfer with new IO-only observation',()=>{
 for(const phrase of ["github.head_ref == 'perf/cas-a02-4gib-staging-io-20261016'","XD_REAL_CAS_INCOMPRESSIBLE_PERF: '1'",
  "XD_REAL_CAS_SIZE_GIB: '4'","XD_CAS_A02_UPLOAD_IO_PERF: '1'",
  'postgres:17-alpine','real-web-incompressible-cas-4gib-source.cjs',
  'cas-a02-upload-space-io-4gib-source.cjs','s.casA02Summary.passed',
  'actions/upload-artifact@v4'])
  assert(wf.includes(phrase),'missing source-exact scoped CI: '+phrase)
})
test('A02 counts true st_blocks and native Go /proc physical writes separately from browser source',()=>{
 for(const phrase of ['casA02PhysicalDisk(root)','stat.blocks*512',
  "key.startsWith('.xdrive-uploads/')","key.startsWith('.xdrive-blobs/sha256/')",
  "fs.readFileSync('/proc/'+pid+'/io'","casA02Observe(f.ready.cas_root,f.proc.child.pid)",
  'peakDiskAmplification','kernelWriteAmplification','stageBytesAfterFinalize',
  "casA02Summary.passed","REAL_WEB_CAS_SUMMARY"])
  assert(runner.includes(phrase),'missing real IO metric: '+phrase)
 for(const phrase of ['"cas_root": local.FilesystemRoot()', '"server_pid": os.Getpid()',
  '&meta.LocalPushQuotaHold{}'])
  assert(go.includes(phrase),'missing private actual Go Server dataset contract: '+phrase)
 assert(!runner.includes('TaskCenter.cancel') && !runner.includes('cancelTransfer('))
})
test('A02 registry and six OS/platform columns do not label unknown as measured',()=>{
 for(const d of docs)assert(d.includes('CAS-A02')&&d.includes('Not measured'))
 for(const column of ['Native Desktop','Wide Web','Mobile Web','Desktop installed PWA','Android installed PWA','iOS installed PWA'])
  assert(docs[1].includes(column),'missing separate platform '+column)
})
