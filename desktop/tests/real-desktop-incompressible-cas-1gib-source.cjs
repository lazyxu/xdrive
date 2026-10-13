'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..')
const read=f=>fs.readFileSync(path.join(root,f),'utf8')
const runner=read('desktop/scripts/real-desktop-cas-runner.cjs')
const app=read('desktop/scripts/real-desktop-cas-electron-main.cjs')
const wf=read('.github/workflows/real-desktop-incompressible-cas-1gib.yml')
const registry=read('docs/performance-test-registry.md')
const canonical=read('docs/file-explorer-performance.md')
const matrix=read('docs/performance-platform-coverage.md')

test('P043 real Desktop native Renderer/Preload/Main/Go Agent remains intact and high-entropy original is physically allocated',()=>{
 for(const x of [
  "XD_REAL_DESKTOP_INCOMPRESSIBLE_PERF", "crypto.createCipheriv('aes-256-ctr'",
  "fs.writeSync(fd,block,written", "fs.fsyncSync(fd)",
  "allocatedBytes>=bytes*.98", "physicalSeed.sourceSHA256",
  "hashFile(download)", "checksum,physicalSeed.sourceSHA256",
  "row.physicalSource?.sourceSHA256===row.downloadSHA256",
  "fs.ftruncateSync(handle,transferBytes)", // do not modify accepted default zero path
  "new AgentIPCClient(discovery)", "client.cloudRoot()",
  "upload,download:downloaded", // genuine per-session IPC result objects
  "row.server?.cas_valid===true", "row.server?.put_count===putCount"
 ]) assert(runner.includes(x),'P043 missing authentic source/Agent CAS proof: '+x)
 for(const x of ["window.xdriveDesktop.agent.cloudUploadDroppedFiles",
  "window.xdriveDesktop.agent.cloudDownload", "enable-precise-memory-info"])
  assert(app.includes(x),'Native Desktop IPC upload/download path changed: '+x)
})

test('P043 source generation is an opt-in n3, not fake S3/Gin upload or output mocks',()=>{
 for(const x of [
  "github.head_ref == 'perf/desktop-incompressible-cas-1gib-p043-20261013'",
  "XD_REAL_DESKTOP_INCOMPRESSIBLE_PERF: '1'",
  "XD_REAL_CAS_SIZE_GIB: '1'", "github.event.pull_request.head.sha",
  "node --test desktop/tests/real-desktop-incompressible-cas-1gib-source.cjs",
  "go build -o desktop/real-desktop-cas-bin/xdrive-agent",
  "go test -c -o desktop/real-desktop-cas-bin/api.test",
  "xvfb-run -a", "actions/upload-artifact@v4"
 ]) assert(wf.includes(x),'P043 exact-run CI guard missing: '+x)
 for(const doc of [registry,canonical,matrix])assert(doc.includes('P043'))
 assert(matrix.includes('Not measured'))
})

test('P043 AES-CTR keyed sample output is distinct, deterministic and uncompressible-like',()=>{
 const make=(name)=>{
  const key=crypto.createHash('sha256').update('xdrive-p043-desktop-aes256ctr:'+name).digest()
  return crypto.createCipheriv('aes-256-ctr',key,Buffer.alloc(16)).update(Buffer.alloc(1024*1024))
 }
 const a=make('sample-1'),b=make('sample-1'),c=make('sample-2')
 assert.deepEqual(a,b)
 assert.notDeepEqual(a,c)
 const allZero=a.every(x=>x===0)
 assert.equal(allZero,false)
 const distinct=new Set(a.subarray(0,65536)).size
 assert(distinct>250,'encoded stream is not high-entropy-like')
})
