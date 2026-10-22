'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const script=read('desktop/scripts/pwa-cr01b1-inflight-sw-waiting.cjs')
const shell=read('scripts/pwa-cr01b1-inflight-sw-waiting.sh')
const workflow=read('.github/workflows/pwa-cr01b1-inflight-sw-waiting.yml')
const go=read('internal/api/uploads.go')
const local=read('internal/storage/local.go')
const worker=read('assets/icon/web/sw.js')

test('synthetic local Caddy uses actual TLS HTTP/2 for Chromium request-body streams',()=>{
  assert(script.includes("const origin = 'https://localhost:' + port"))
  assert(script.includes("assert.equal(negotiated,'h2'"))
  assert(script.includes('ignoreHTTPSErrors: true'))
  assert(shell.includes('localhost:$PORT_CADDY {'))
  assert(shell.includes('tls internal'))
  assert(shell.includes('XD_ALLOWED_ORIGIN="https://localhost:$PORT_CADDY"'))
  assert(shell.includes('curl --insecure --silent --fail --max-time 5'))
  assert(!shell.includes('XD_ALLOWED_ORIGIN="http://127.0.0.1:$PORT_CADDY"'))
  assert(script.includes("page.setDefaultTimeout(30000)"))
  assert(script.includes("peer.setDefaultTimeout(30000)"))
  assert(script.includes("safePhase='wait-primary-native-public-SW'"))
  assert(script.includes("safePhase='wait-peer-native-public-SW'"))
  assert(!script.includes("navigator.serviceWorker.ready"))
  assert(script.includes("PWA_CR01B1_SAFE_WATCHDOG"))
  assert(script.includes("'--ignore-certificate-errors'"))

})

test('native 8MiB HTTP PUT is held mid-body across stable waiting of two original clients',()=>{
  for(const required of [
    'async function beginNativeStreamedChunk(page)',
    'new ReadableStream({',"duplex:'half'",
    'const chunk=8*1024*1024,prefix=512*1024',
    'controller.enqueue(bytes.slice(0,prefix))','await locked',
    'window.__pwaLiveChunk=pending',
    'await beginNativeStreamedChunk(page)',
    'await awaitPartialGoChunk()',
    'await requireInFlight(page)',
    'await waitStableTwoWindowSWWaiting(page, peer)',
    'await finishNativeStreamedChunk(page)',
    'summary.nativeInFlightPut=true','summary.goReadPartialBytes=true',
    'summary.waitingOverlappedInFlight=true',
    'summary.streamedChunkCommitted=true',
    'for (let i = 2; i < 3; i++)'
  ])assert(script.includes(required),required)
  const start=script.indexOf('const streaming=await beginNativeStreamedChunk(page)')
  const publish=script.indexOf('\n    publishWebB()',start)
  const waiting=script.indexOf('await waitStableTwoWindowSWWaiting(page, peer)',publish)
  const finish=script.indexOf('assert(await finishNativeStreamedChunk(page))',waiting)
  assert(start>=0&&publish>start&&waiting>publish&&finish>waiting,
    'single PUT must span publication and stable SW waiting')
  assert.doesNotMatch(script,/context\.route\(|route\.fulfill\(|location\.reload\(|skipWaiting\(/)
  assert.doesNotMatch(worker,/self\.skipWaiting\s*\(/)
})
test('production Gin request body actually writes a PARTIAL private LocalCAS temporary file',()=>{
  assert(go.includes('s.Store.Put(c.Request.Context(), key, io.TeeReader(c.Request.Body, h))'))
  assert(local.includes('os.CreateTemp(filepath.Dir(full), ".xdrive-upload-*")'))
  assert(local.includes('copyWithContext(ctx, tmp, input)'))
  assert(script.includes('fs.realpathSync(env.XD_PWA_HOT_UPLOAD_CAS_ROOT)'))
  assert(script.includes("ent.name.startsWith('.xdrive-upload-')"))
  assert(script.includes('count>=256*1024 && count<8*1024*1024'))
  assert(script.includes('duringWaiting>=256*1024 && duringWaiting<8*1024*1024'))
  assert(shell.includes('XD_PWA_HOT_UPLOAD_CAS_ROOT="$CAS"'))
  assert(shell.includes('XD_STORAGE_ROOT="$CAS"'))
  assert(shell.includes('XD_PWA_B2B2B2_PHYSICAL=1 go test'))
})
test('real PostgreSQL17/Caddy/Go A-to-B 17MiB postflight preserved; no unproven rollback or durable',()=>{
  for(const required of [
    'XD_DATABASE_URL="$XD_TEST_DATABASE_URL"',
    'pwa-archive-assets.sh',
    'TestPWARealGoHotUploadPhysicalPostflight',
    'result.waitingOverlappedInFlight && result.streamedChunkCommitted',
    '!result.bToARollbackProven && !result.twoIndependentWindowUploadsProven',
    '!result.durableTaskCoactivityProven'
  ])assert(shell.includes(required),required)
  for(const required of [
    "process.kill(pidA, 'SIGKILL')",
    'await verifyDeadOldGo()',
    'await version(context,',
    'await oldWorkerStayed(page, true)',
    'summary.originalChunk0NeverReuploaded = sentB.onlyNewChunksOnB',
    'bToARollbackProven: false, twoIndependentWindowUploadsProven: false',
    'durableTaskCoactivityProven: false'
  ])assert(script.includes(required),required)
  assert(script.includes('physicalIOS: false'))
  assert(!script.includes('productionFilePicker: true'))
})
test('accurate SHA CI has native Chrome, PostgreSQL, no mocks or private artifacts',()=>{
  for(const required of [
    "test/pwa-cr01b1-inflight-waiting-20261022",
    'postgres:17-alpine','playwright-core@1.56.1',
    'docker pull caddy:2.10.2-alpine',
    'node --test release-b/desktop/tests/pwa-cr01b1-inflight-sw-waiting.cjs',
    'bash release-b/scripts/pwa-cr01b1-inflight-sw-waiting.sh',
    'release-b/desktop/pwa-cr01b1-results/summary.json',
    'github.event.pull_request.head.sha || github.sha'
  ])assert(workflow.includes(required),required)
  assert(!workflow.includes('continue-on-error:'))
  for(const path of ['private-go-A.log','private-go-B.log','browser-profile','private-admin.log'])
    assert(!workflow.includes(path),'private CI artifacts prohibited '+path)
})
