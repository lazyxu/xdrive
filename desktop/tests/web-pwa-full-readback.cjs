const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.join(__dirname, '../..')
const source = fs.readFileSync(path.join(root,'web/src/pwaFullReadback.ts'),'utf8')
const js = ts.transpileModule(source, { fileName:'pwaFullReadback.ts',
  compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText
const mod={exports:{}}
new Function('exports','module',js)(mod.exports,mod)
const verify=mod.exports.xDriveVerifySparseZeroOPFSFile
test('S4C2 bounded full OPFS zero-file check visits each byte and tail',async()=>{
  const data=new Uint8Array(1048576*2+13)
  const positions=[]
  const file={size:data.byteLength,slice(a,b){positions.push([a,b]);return new Blob([data.subarray(a,b)])}}
  assert.equal(await verify(file,data.byteLength),data.byteLength)
  assert.deepEqual(positions,[[0,1048576],[1048576,2097152],[2097152,2097165]])
})
test('S4C2 detects hidden corruption outside 3MiB spot samples',async()=>{
  const data=new Uint8Array(1048576*4+7)
  data[1048576*3+3]=123
  await assert.rejects(verify(new Blob([data]),data.length),/mismatch at offset 3145728/)
})
test('S4C2 fails closed for wrong file size, malformed bounds and empty object is valid',async()=>{
  assert.equal(await verify(new Blob(),0),0)
  await assert.rejects(verify(new Blob([0]),2),/size/)
  await assert.rejects(verify(new Blob(),-1),/Invalid/)
  await assert.rejects(verify(new Blob(),0,2*1024*1024),/Invalid/)
  await assert.rejects(verify(new Blob(),0,0),/Invalid/)
})
test('S4C2 whole-file check cannot be replaced by byte count without reading',async()=>{
  const file={size:9,slice(){return {async arrayBuffer(){throw Error('OPFS read failed')}}}}
  await assert.rejects(verify(file,9),/OPFS read failed/)
})
test('S4C2 opt-in code keeps actual API/OPFS and unchanged default perf sample design',()=>{
  const read=p=>fs.readFileSync(path.join(root,p),'utf8')
  const harness=read('web/src/LargeTransferPerformanceHarness.tsx')
  const runner=read('desktop/scripts/real-web-cas-transfer-runner.cjs')
  const launcher=read('desktop/scripts/large-transfer-real-web-cas-main.cjs')
  const workflow=read('.github/workflows/pwa-full-opfs-readback.yml')
  assert.ok(harness.includes('xDriveVerifySparseZeroOPFSFile(completeFile, sizeBytes)'))
  assert.ok(harness.indexOf('const endedAt = performance.now()') <
    harness.indexOf('xDriveVerifySparseZeroOPFSFile(completeFile, sizeBytes)'))
  assert.ok(harness.includes('const saved = await api.download({'))
  assert.ok(runner.includes('const trials = fullPwaReadback ? 1 : 3'))
  assert.ok(runner.includes('result.downloadFullVerifiedBytes,sizes.bytes'))
  assert.ok(launcher.includes('xdrivePwaFullReadback=1'))
  assert.ok(workflow.includes('XD_PWA_FULL_OPFS_READBACK:'))
  assert.ok(workflow.includes('go test -c -o'))
  assert.ok(workflow.includes('xvfb-run'))
  assert.ok(workflow.includes('VITE_XDRIVE_LARGE_TRANSFER_PERF=1'))
  assert.ok(workflow.includes('(cd desktop && npm install --no-audit --no-fund)'))
  assert.ok(!workflow.includes('(cd desktop && npm ci --no-audit --no-fund)'))
  assert.ok(workflow.includes('desktop/pwa-full-opfs-results/summary.json'))
  assert.ok(workflow.includes('desktop/pwa-full-opfs-results/sample-*.json'))
  assert.equal(workflow.includes('path: desktop/pwa-full-opfs-results/'),false,
    'unredacted raw Gin logs and download tickets must not be published')
  assert.equal(harness.includes('crypto.subtle.digest('),false,'do not assemble multi-GiB bytes in JS')
})
