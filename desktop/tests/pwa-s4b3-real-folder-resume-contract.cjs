'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8')

test('B3B: isolated opt-in Gin folder fixture preserves other B2 workloads',()=>{
  const go=read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
  for(const token of [
    'folderResumeMode := os.Getenv("XD_PWA_S4B3_REAL_FOLDER") == "1"',
    'if folderResumeMode && (!resumeMode || largeResumeMode)',
    'faultRecoverySession = 3',
    'expectedSessions = 3',
    'expectedChunk0 = 2',
    'expectedChunk2 = 2',
    'expectedAcceptedChunk1 = 2',
    '"pwa-b3b-album"',
    '"00-root-a.bin"',
    '"10-root-b.mov"',
    '"20-nested-c.bin"',
    'committedCount != 2 || missingCount != 1',
    'actualFileListOrderIndependent=true',
    'io.Copy(actual, object)',
    'PWA_S4B3_AUTHENTIC_FOLDER_VERIFIED',
    'request(t, router, http.MethodGet,',
  ]) assert.ok(go.includes(token),token)
  assert.ok(go.includes('resumeExpectedBytes = 1 << 30'), '1 GiB fixture unchanged')
  assert.ok(go.includes('S4B2 complete physical nonzero-file SHA256 mismatch'))
})
test('B3B: actual directory FileChooser + hierarchical failed/resumable/cancelled group',()=>{
  const js=read('desktop/scripts/pwa-real-gin-folder-resume-browser.cjs')
  for(const token of [
    "chooser.setFiles(folderPath)",
    "el.hasAttribute('webkitdirectory')",
    "getByRole('menuitem',{name:'上传文件夹',exact:true})",
    "getByRole('button',{name:'上传文件夹',exact:true})",
    "getByRole('button',{name:'展开子任务'})",
    "getByRole('button',{name:'重新选择原文件',exact:true})",
    "again.setFiles(failedSource)",
    "t.state === 'partial'",
    "t.resume_manifest_sha256||''",
    "t.state==='cancelled' && t.retryable!==true",
    "Number.isSafeInteger(t.cloud_parent_id)",
    "summary.originalParentRemainedPartial=true",
    "summary.counters.session_posts,3",
    "summary.counters.chunk0_puts,2",
    "summary.counters.chunk2_puts,2",
    "summary.counters.tcp_drops,summary.counters.chunk1_puts-2",
    "cache.paths,['/offline.html']",
    "summary.nestedPathPresent",
    "summary.unstartedSiblingNotUploaded",
  ]) assert.ok(js.includes(token),token)
  assert.doesNotMatch(js, /(?:page|context)\.route\(|route\.fulfill\(/)
  assert.doesNotMatch(js, /readFileSync\(failedSource\)/)
  assert.doesNotMatch(js, /skipWaiting\(/)
})
test('B3B: exact-head CI uses real Gin/PG/CAS and archives only sanitized summaries',()=>{
  const flow=read('.github/workflows/pwa-s4b3-real-folder-resume.yml')
  for(const t of [
    "github.head_ref == 'test/pwa-real-folder-resume-s4b2b3b-20261013'",
    'XD_PWA_S4B2_REAL_RESUME=1',
    'XD_PWA_S4B3_REAL_FOLDER=1',
    'node --test desktop/tests/pwa-s4b3-real-folder-resume-contract.cjs',
    'go test -c -o',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'for MODE in desktop mobile',
    'desktop/pwa-s4b3-results/summary-*.json',
    "'originalParentRemainedPartial'",
    "'physicalCASVerified'",
    'required.some(k=>r[k]!==true)',
  ]) assert.ok(flow.includes(t),t)
  assert.ok(!flow.includes('path: $RUNNER_TEMP'))
  assert.ok(!flow.includes('path: *.log'))
  assert.doesNotMatch(flow,/skipWaiting|clients\.claim/)
})
test('B3B: Web and Mobile share a single folder API, child reselect and no private SW cache',()=>{
  const app=read('web/src/App.tsx')
  const explorer=read('web/src/WebFileExplorer.tsx')
  const api=read('web/src/api.ts')
  const sw=read('assets/icon/web/sw.js')
  assert.ok(app.includes('fileUploads.runGroup({'))
  assert.ok(app.includes('api.uploadWithConflictPolicy(task.cloud_parent_id, file'))
  assert.ok(api.includes('webTransferStore.setUploadResumeContext('))
  assert.ok(api.includes('manifestSHA256 !== expectedResumeManifestSHA256'))
  assert.ok(explorer.includes("element.setAttribute('webkitdirectory', '')"))
  assert.ok(sw.includes("const OFFLINE_URL = '/offline.html'"))
  assert.ok(!sw.includes('skipWaiting('))
})
