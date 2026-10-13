'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {createHash, createCipheriv, webcrypto} = require('node:crypto')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const main = read('desktop/scripts/large-transfer-real-web-cas-main.cjs')
const runner = read('desktop/scripts/real-web-cas-transfer-runner.cjs')
const browser = read('web/src/LargeTransferPerformanceHarness.tsx')
const verifier = read('web/src/realCasIncompressibleReadback.ts')
const wf = read('.github/workflows/real-web-cas-incompressible-4gib.yml')
const reg = read('docs/performance-test-registry.md')
const canonical = read('docs/file-explorer-performance.md')
const matrix = read('docs/performance-platform-coverage.md')

test('P044 authentic physical CSPRNG upload uses bounded AES-CTR output and true SHA-256, never sparse zero', () => {
  for(const x of ["XD_REAL_CAS_INCOMPRESSIBLE_PERF", "createCipheriv('aes-256-ctr'",
    "fs.writeSync(fd, payload, written", "fs.fsyncSync(fd)", "sourceAllocatedBytes",
    "physicalSeedSHA256", "stats.file_sha256 !== combined.uploadedSHA256",
    "xdriveCasIncompressible=1"]) assert(main.includes(x),x)
  for(const x of ["highEntropyIncompressible", "uploadSeedSHA256",
    "downloadDeterministicVerifiedBytes", "full downloaded OPFS bytes",
    "serverRssPeakDeltaBytes", "nativeGoServerCpuMsP50"]) assert(runner.includes(x),x)
})
test('P044 browser performs 3 timed spots PLUS bounded complete OPFS byte parity after download clock', () => {
  for(const x of ["xdriveCasIncompressible", "xDriveVerifyDeterministicHighEntropyOPFS",
    "downloadDeterministicVerifiedBytes", "downloadVerificationElapsedMs",
    "downloaded, sizeBytes, sample, ranges", "completeFile, sizeBytes, sample",
    "xDriveVerifySparseZeroOPFSFile"]) assert(browser.includes(x),x)
  assert(verifier.includes('Uint8Array<ArrayBuffer>') &&
    verifier.includes('new Uint8Array(new ArrayBuffer(16))'),
    'P044 WebCrypto AES-CTR counter requires owned ArrayBuffer BufferSource')
  for(const x of ["AES-CTR", "SHA-256", "new Uint8Array(count)",
    "file.slice(offset, offset + count)", "counterForByteOffset(offset)",
    "actual[i] !== expected[i]", "maxChunk = 1024 * 1024"])
    assert(verifier.includes(x),x)
})
test('AES-CTR deterministic 256-bit physical seed matches Web Crypto at real 4GiB-adjacent random access offsets', async () => {
  const sample='sample-2'
  const seed='xdrive-p044-cas-aes256ctr:'+sample
  const key=createHash('sha256').update(seed).digest()
  const subtleKey=await webcrypto.subtle.importKey('raw',key,'AES-CTR',false,['encrypt'])
  for(const offset of [0, 1024*1024, 1024*1024*1024, 4*(2**30)-1024*1024]){
    let ctr=BigInt(offset)/16n
    const iv=Buffer.alloc(16)
    for(let i=15;i>=8;i--){iv[i]=Number(ctr&255n);ctr >>=8n}
    assert.equal(ctr,0n)
    const expected=createCipheriv('aes-256-ctr',key,iv).update(Buffer.alloc(256))
    const actual=Buffer.from(await webcrypto.subtle.encrypt(
      {name:'AES-CTR',counter:iv,length:64},subtleKey,new Uint8Array(256)))
    assert.deepEqual(actual,expected)
  }
})
test('P044 uses fresh independent native Gin/PG17/physical CAS Web XDriveApi upload and download with correct separate identity',()=>{
  assert(wf.includes("github.head_ref == 'perf/real-web-incompressible-cas-4gib-p044-20261013'"))
  assert(wf.includes("XD_REAL_CAS_INCOMPRESSIBLE_PERF: '1'"))
  assert(wf.includes("XD_REAL_CAS_SIZE_GIB: '4'"))
  assert(wf.includes('github.event.pull_request.head.sha'))
  assert(wf.includes('VITE_XDRIVE_LARGE_TRANSFER_PERF=1'))
  assert(wf.includes('go test -c'))
  assert(wf.includes('xvfb-run -a'))
  assert(wf.includes('actions/upload-artifact@v4'))
  for(const d of [reg,canonical,matrix])assert(d.includes('P044'))
  assert(matrix.includes('Not measured'))
  assert(runner.includes('fullPwaReadback ? 1 : 3'))
  assert(!wf.includes('XD_PWA_FULL_OPFS_READBACK'))
})

test('P044 original authentic 4GiB high entropy n3 contract requires every-byte verified OPFS and 512 real PUTs', () => {
  for (const fragment of [
    's.n===3',
    's.bytesPerDirection===4294967296',
    'x.nativeServer.put_count===512',
    'x.upload.uploadSourcePhysicallyAllocatedBytes>=4294967296*.98',
    'x.download.downloadDeterministicVerifiedBytes===4294967296',
    'x.download.downloadSpotCheckedBytes===3145728',
    'sourceHashes.size===3',
    'x.serverRssPeakDeltaBytes<=268435456',
    's.maxRendererWorkingSetDeltaKB<=262144',
  ]) assert(wf.includes(fragment), 'P044 frozen authentic 4GiB gate missing: '+fragment)
  for (const fragment of [
    'sizeGiB === 4 ? 360000 : 240000',
    'assert(free>=required',
    'const trials = fullPwaReadback ? 1 : 3',
    'assert.equal(final.cas_valid,true)',
    'assert.equal(final.file_sha256,rows[0].uploadSeedSHA256,',
  ]) assert(runner.includes(fragment), 'P044 production native run contract missing: '+fragment)
  assert(verifier.includes('expectedSize > 4 * (2 ** 30)'))
});
