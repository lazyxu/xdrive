'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const read=p=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8')
const browser=read('desktop/scripts/pwa-cr01b3-two-active-upload-waiting.cjs')
const shell=read('scripts/pwa-cr01b3-two-active-upload-waiting.sh')
const workflow=read('.github/workflows/pwa-cr01b6-native-picker-sw-waiting.yml')
const go=read('internal/api/pwa_cr01b6_picker_postflight_linux_test.go')

test('native user FileChooser must overlap two real pending PUTs and waiting public SW',()=>{
 for(const token of [
  "pickerMode = env.XD_PWA_CR01B6_PICKER === '1'",
  "page.waitForEvent('filechooser'",
  "getByRole('menuitem',{name:'上传文件',exact:true})",
  "await chooser.setFiles(file)",
  "realProductionFilesPickerWhileWaiting(page)",
  "summary.pickerDuringTwoStreamsWaiting=true",
  "summary.productionFilePicker=true",
  "summary.pickerRealFinalize=true",
  "summary.pickerGoOwnerNodeVisible=true",
  "assert(twoDistinctGoPartials()",
  "await oldWorkerStayed(page,true)"
 ])assert(browser.includes(token),'missing actual picker proof '+token)
 const waiting=browser.indexOf('summary.oldSWWaitingVerified = true')
 const picker=browser.indexOf('await realProductionFilesPickerWhileWaiting(page)',waiting)
 const finish=browser.indexOf('finishNativeStreamedChunk(page),finishPeerStreamingChunk(peer)',picker)
 assert(waiting>=0&&picker>waiting&&finish>picker)
 assert.doesNotMatch(browser,/route\.fulfill\(|context\.route\(|self\.skipWaiting\(/)
})
test('actual PostgreSQL and LocalCAS must have one complete independently verifiable picker file',()=>{
 for(const token of [
  'TestPWACR01B6RealFilesPickerPostflight',
  'XD_PWA_CR01B6_REAL_PICKER_PHYSICAL',
  'pwa-cr01b6-picker-1m.bin',
  'storage.NewLocal(root)',
  'local.Open(context.Background(), key)',
  'io.Copy(got, f)',
  'meta.UploadStatusFinalized',
  'blob.RefCount < 1'
 ])assert(go.includes(token),'missing physical third file proof '+token)
 assert(!go.includes('db.Create('))
 assert(shell.includes('XD_PWA_CR01B6_REAL_PICKER_PHYSICAL=1 go test'))
 assert(shell.includes('XD_PWA_CR01B3_DUAL_PHYSICAL=1 go test'))
 assert(shell.includes('result.productionFilePicker && result.pickerDuringTwoStreamsWaiting'))
})
test('specialty authentic Chrome Caddy Go PG17 CI source exact; no private artifacts',()=>{
 for(const token of [
  'test/pwa-cr01b6-native-files-picker-20261022',
  'postgres:17-alpine',
  'caddy:2.10.2-alpine',
  "XD_PWA_CR01B6_PICKER: '1'",
  'playwright-core@1.56.1',
  'release-b/desktop/pwa-cr01b6-results/summary.json',
  'node --test release-b/desktop/tests/pwa-cr01b3-two-active-upload-waiting.cjs release-b/desktop/tests/pwa-cr01b6-native-picker-sw-waiting.cjs',
  'github.event.pull_request.head.sha'
 ])assert(workflow.includes(token),'CI missing '+token)
 assert(!workflow.includes('continue-on-error:'))
})