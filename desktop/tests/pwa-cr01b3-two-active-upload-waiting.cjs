'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const base=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(base,p),'utf8')
const browser=read('desktop/scripts/pwa-cr01b3-two-active-upload-waiting.cjs')
const shell=read('scripts/pwa-cr01b3-two-active-upload-waiting.sh')
const workflow=read('.github/workflows/pwa-cr01b3-two-active-upload-waiting.yml')
const goPeer=read('internal/api/pwa_cr01b3_dual_upload_postflight_linux_test.go')
const goUpload=read('internal/api/uploads.go')
const local=read('internal/storage/local.go')
const worker=read('assets/icon/web/sw.js')

test('two real original Owner browsers each keep distinct pending native streaming PUT across B waiting',()=>{
 for(const t of [
  "const origin = 'https://localhost:' + port",
  "assert.equal(negotiated,'h2'",
  'async function beginNativeStreamedChunk(page)',
  'async function beginIndependentPeerStream(peer)',
  'window.__pwaIndependentPeer=pending',
  'summary.twoDistinctDurableSessions=true',
  'summary.twoNativeInFlightPuts=true',
  'await waitTwoDistinctGoPartials()',
  'await requireInFlight(page)',
  'await requirePeerInFlight(peer)',
  'await waitStableTwoWindowSWWaiting(page, peer)',
  'assert(twoDistinctGoPartials()',
  'finishNativeStreamedChunk(page),finishPeerStreamingChunk(peer)',
  'summary.twoIndependentWindowUploadsProven=true',
  "await finalizeIndependentPeer(peer)",
  'summary.secondOwnerSessionFinalized=true',
  "resume_key:'pwa-cr01b3-independent-peer-6m'",
  "name:'pwa-cr01b3-peer-upload.bin'",
  'const body=new Uint8Array(6*1024*1024)',
  "duplex:'half'",
 ])assert(browser.includes(t),'missing dual original Browser proof '+t)
 const original=browser.indexOf('const streaming=await beginNativeStreamedChunk(page)')
 const peer=browser.indexOf('const peerUpload=await beginIndependentPeerStream(peer)',original)
 const publish=browser.indexOf('publishWebB()',peer)
 const waiting=browser.indexOf('await waitStableTwoWindowSWWaiting(page, peer)',publish)
 const finish=browser.indexOf('finishNativeStreamedChunk(page),finishPeerStreamingChunk(peer)',waiting)
 assert(original>=0 && peer>original && publish>peer && waiting>publish && finish>waiting,
  'two independent pending browser PUTs must straddle real B Worker waiting')
 assert.doesNotMatch(browser,/context\.route\(|route\.fulfill\(|location\.reload\(|self\.skipWaiting\s*\(/)
 assert.doesNotMatch(worker,/self\.skipWaiting\s*\(/)
})

test('Go has two *distinct* private physical temporary files, not two CDP sent-request events',()=>{
 for(const t of [
  'fs.realpathSync(env.XD_PWA_HOT_UPLOAD_CAS_ROOT)',
  "entry.name.startsWith('.xdrive-upload-')",
  'info.dev',
  'info.ino',
  'identities.size>=2',
  'info.size>=256*1024 && info.size<8*1024*1024',
  'async function waitTwoDistinctGoPartials()',
  'summary.twoPartialGoCASFiles=true'
 ])assert(browser.includes(t),t)
 assert(goUpload.includes('s.Store.Put(c.Request.Context(), key, io.TeeReader(c.Request.Body, h))'))
 assert(local.includes('os.CreateTemp(filepath.Dir(full), ".xdrive-upload-*")'))
 assert(shell.includes('XD_PWA_HOT_UPLOAD_CAS_ROOT="$CAS"'))
 assert(shell.includes('XD_STORAGE_ROOT="$CAS"'))
})

test('separate real Go SQL and physical CAS postflight requires original 17MiB AND peer 6MiB',()=>{
 for(const t of [
  'TestPWARealGoHotUploadPhysicalPostflight',
  'TestPWACR01B3RealSecondWindowPhysicalPostflight',
  'XD_PWA_CR01B3_DUAL_PHYSICAL=1 go test',
  'result.twoIndependentWindowUploadsProven',
  'result.twoDistinctDurableSessions',
  'result.twoNativeInFlightPuts',
  'result.twoPartialGoCASFiles',
  'result.secondOwnerSessionFinalized',
  'result.secondPhysicalGoCASPostflight',
  '!result.durableTaskCoactivityProven',
  '!result.bToARollbackProven',
  '!result.productionFilePicker'
 ])assert(shell.includes(t),t)
 for(const token of [
  'meta.UploadSession','meta.File','meta.ContentBlob','meta.FileVersion',
  'storage.NewLocal(root)','local.Open(context.Background(), key)',
  '"pwa-cr01b3-independent-peer-6m"',
  'session.ChunkCount != 1','session.TotalSize != size',
  'original[0].ID == session.ID',
  'pwa-cr01b3-peer-upload.bin',
  '(offset*17 + (offset >> 5) + 7) % 251',
  'io.Copy(actual, physical)',
  'blob.RefCount < 1'
 ])assert(goPeer.includes(token),token)
 assert(!goPeer.includes('db.Create('))
 assert(!goPeer.includes('db.Save('))
 assert(!goPeer.includes('db.Update('))
})

test('source-exact isolated CI has PostgreSQL17 real two Go releases and no private archive',()=>{
 for(const t of [
   'test/pwa-cr01b3-two-active-upload-20261022',
   'postgres:17-alpine','caddy:2.10.2-alpine',
   'playwright-core@1.56.1',
   'github.event.pull_request.head.sha || github.sha',
   'node --test release-b/desktop/tests/pwa-cr01b3-two-active-upload-waiting.cjs',
   'bash release-b/scripts/pwa-cr01b3-two-active-upload-waiting.sh',
   'release-b/desktop/pwa-cr01b3-results/summary.json'
 ])assert(workflow.includes(t),t)
 assert(!workflow.includes('continue-on-error:'))
 const artifactPath=workflow.split('actions/upload-artifact@v4')[1]||''
 assert(!/path:\s*[^\n]*(?:private-go|\.har\b|browser-profile)/i.test(artifactPath))
 assert(browser.includes('twoIndependentWindowUploadsProven: false'))
 assert(browser.includes('durableTaskCoactivityProven: false'))
 assert(browser.includes('physicalIOS: false'))
});
