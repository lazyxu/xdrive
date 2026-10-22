'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const browser=read('desktop/scripts/pwa-cr01b2-reverse-rollback.cjs')
const shell=read('scripts/pwa-cr01b2-reverse-rollback.sh')
const workflow=read('.github/workflows/pwa-cr01b2-reverse-rollback.yml')
const storage=read('internal/storage/local.go')
const upload=read('internal/api/uploads.go')
const worker=read('assets/icon/web/sw.js')
test('real immutable production A/B Go Web and original Browser PUT/CAS checks remain required',()=>{
 for(const phrase of [
   "const origin = 'https://localhost:' + port",
   "assert.equal(negotiated,'h2'",
   "process.kill(pidA, 'SIGKILL')",
   'await verifyDeadOldGo()',
   "await version(context, 'pwa-b2b2b2-B')",
   'await beginNativeStreamedChunk(page)',
   'await waitStableTwoWindowSWWaiting(page, peer)',
   'await finishNativeStreamedChunk(page)',
   'summary.goReadPartialBytes=true',
   'summary.nativeInFlightPut=true',
   "await version(context,'pwa-b2b2b2-A')"
 ])assert(browser.includes(phrase),phrase)
 assert(upload.includes('s.Store.Put(c.Request.Context(), key, io.TeeReader(c.Request.Body, h))'))
 assert(storage.includes('os.CreateTemp(filepath.Dir(full), ".xdrive-upload-*")'))
 assert(shell.includes('TestPWARealGoHotUploadPhysicalPostflight'))
 assert.doesNotMatch(browser,/route\.fulfill\(|context\.route\(|location\.reload\(|skipWaiting\(/)
 assert.doesNotMatch(worker,/self\.skipWaiting\s*\(/)
})
test('physical old server re-enters after B committed and Caddy reverse upstream is real',()=>{
 for(const phrase of [
   'async function startNativeOldGoA2()',
   'env.XD_PWA_HOT_UPLOAD_A_SERVER',
   "XD_LISTEN_ADDR:'127.0.0.1:'+goBackPort",
   "+'/api/v1/readyz'",
   'await startNativeOldGoA2()',
   'realCaddyBack()',
   "spawnSync('docker',['exec',container,'caddy','reload'",
   'await verifyRolledBackOwner(backA',
   'summary.physicalOldGoReentered=true',
   'summary.bToARollbackProven=true',
   'summary.nativeOldGoCanReadCommittedFile=true'
 ]) assert(browser.includes(phrase),phrase)
 const b=browser.indexOf('const sentB = await phaseB(page)')
 const start=browser.indexOf('oldGoA2=await startNativeOldGoA2()',b)
 const reverse=browser.indexOf('realCaddyBack()',start)
 const readback=browser.indexOf('await verifyRolledBackOwner(backA',reverse)
 assert(b>=0&&start>b&&reverse>start&&readback>reverse,
  'actual B finalized upload must precede restart/rollback/readback')
 for(const phrase of [
   'PORT_ROLLBACK=19914','XD_PWA_HOT_UPLOAD_GO_ROLLBACK_PORT="$PORT_ROLLBACK"',
   'XD_PWA_HOT_UPLOAD_PRIVATE_ROOT="$WORK"',
   'result.bToARollbackProven && result.physicalOldGoReentered',
   'result.nativeOldGoCanReadCommittedFile'
 ])assert(shell.includes(phrase),phrase)
})
test('B-to-A public SW is naturally installed with two old-B clients and old lazy JS is immutable',()=>{
 for(const phrase of [
   'function publishWebA()',
   "for(const name of ['index.html','sw.js'])",
   "const oldChunk=await context.request.get(origin+a.path)",
   "assert.equal(digest(await oldChunk.body()),a.sha)",
   'await backB.evaluate(async()=>',
   'await waitWaiting(backB)',
   'await waitStableTwoWindowSWWaiting(backB,backPeer)',
   'assert(await oldWorkerStayed(backB,true))',
   'assert(await oldWorkerStayed(backPeer,true))',
   'await backPeer.close()',
   'await backB.close()',
   'await waitNewActive(backA)',
   'summary.reverseSWWaitingStable=true',
   'summary.oldBWindowsNotReplaced=true',
   'summary.rollbackHistoricalChunkBytesMatch=true',
   'summary.oldSWReactivatedOnlyAfterClientsClose=true'
 ])assert(browser.includes(phrase),phrase)
 assert(!browser.includes('self.skipWaiting('))
})
test('exact-head CI and privacy boundaries do not claim unrelated rollback semantics',()=>{
 for(const phrase of [
   "test/pwa-cr01b2-reverse-rollback-20261022",
   'e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4',
   'postgres:17-alpine','caddy:2.10.2-alpine',
   'playwright-core@1.56.1',
   'github.event.pull_request.head.sha || github.sha',
   'node --test release-b/desktop/tests/pwa-cr01b2-reverse-rollback.cjs',
   'bash release-b/scripts/pwa-cr01b2-reverse-rollback.sh',
   'release-b/desktop/pwa-cr01b2-results/summary.json'
 ])assert(workflow.includes(phrase),phrase)
 for(const phrase of ['!result.twoIndependentWindowUploadsProven','!result.durableTaskCoactivityProven','!result.productionFilePicker'])
   assert(shell.includes(phrase),phrase)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('private-go-A.log'))
 assert(!workflow.includes('private-old-go-restart.log'))
 assert(!workflow.includes('browser-profile'))
 assert.doesNotMatch(workflow,/^\s*path:\s*.*(?:\.har\b|private-go|browser-profile)/mi,'actual artifact upload path must not include private data')
 assert(browser.includes('physicalIOS: false'))
})
