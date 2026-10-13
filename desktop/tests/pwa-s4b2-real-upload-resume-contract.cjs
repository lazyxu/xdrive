const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('S4B2-A: real Gin/postgresql/CAS fixture injects exactly one genuine TCP reset', () => {
  const source = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
  for (const needed of [
    'fileExplorerMediaPerfDatabase(t, dsn)',
    'meta.UploadSession{}, &meta.UploadPart{}',
    'storage.NewLocal(t.TempDir())',
    'resumeMode := os.Getenv("XD_PWA_S4B2_REAL_RESUME") == "1"',
    'faultRecoverySession := int64(2)',
    'if uploadSessions.Load() < faultRecoverySession',
    'w.(http.Hijacker).Hijack()',
    '_ = conn.Close()',
    'expectedSessions := int64(2)',
    'uploadSessions.Load() != expectedSessions',
    'expectedChunk0 := int64(1)',
    'chunk0Requests.Load() != expectedChunk0',
    'expectedChunk2 := int64(1)',
    'expectedAcceptedChunk1 := int64(1)',
    'chunk1Requests.Load() < expectedAcceptedChunk1+1',
    'chunk2Requests.Load() != expectedChunk2',
    'injectedNetworkDrops.Load() != chunk1Requests.Load()-expectedAcceptedChunk1',
    'local.Open(context.Background(), key)',
    'io.Copy(actual, object)',
    'PWA_S4B2_AUTHENTIC_RESUME_VERIFIED',
  ]) assert.ok(source.includes(needed), needed)
  assert.ok(source.includes('blob.RefCount < 1'))
  assert.ok(source.includes('blob.State != meta.ContentBlobStateReady'))
})

test('S4B2-A: native Chrome uses actual Files picker, hard reload and original-file reselect', () => {
  const chrome = read('desktop/scripts/pwa-real-gin-upload-resume-browser.cjs')
  for (const token of [
    'chromium.launch(',
    'page.getByRole(\'button\', { name: \'上传文件\', exact: true })',
    "page.waitForEvent('filechooser')",
    'firstChooser.setFiles(filepath)',
    "'xdrive.web.transfer_history:'",
    "x.state === 'failed' && x.retryable === true",
    "page.reload({ waitUntil: 'domcontentloaded' })",
    "getByRole('button', { name: '重新选择原文件', exact: true })",
    'again.setFiles(filepath)',
    "response.request().method() === 'POST'",
    'final.result?.sha256, expectedHash',
    "cache.resources, ['/offline.html']",
  ]) assert.ok(chrome.includes(token), token)
  assert.ok(chrome.includes('inputBytes: ready.upload_size_bytes'))
  assert.ok(chrome.includes('physicalDevice: false, systemInstalled: false'))
  assert.ok(chrome.includes("summary.stage = 'await-actual-directory'"))
  assert.ok(chrome.includes("summary.targetFolderReady = true"))
  assert.ok(chrome.includes("summary.finalizedInTargetFolder = true"))
  assert.ok(chrome.includes("final.result?.parent_id, ready.target_id"))
  assert.ok(chrome.includes("[data-xdrive-file-explorer-crumb][aria-current=\"page\"]"))
  assert.ok(chrome.includes("[data-mobile-files-compact-title]"))
  assert.ok(chrome.includes("name: '文件操作菜单'"))
  assert.ok(chrome.includes("getByRole('menuitem', { name: '上传文件', exact: true })"))
  assert.ok(!chrome.includes('page.route('))
  assert.ok(!chrome.includes('context.route('))
  assert.ok(!chrome.includes('route.fulfill('))
  assert.ok(!chrome.includes('skipWaiting('))
})

test('S4B2-B1: native Chrome rejects wrong name and equal-metadata changed bytes before Gin', () => {
  const chrome = read('desktop/scripts/pwa-real-gin-upload-resume-browser.cjs')
  for (const token of [
    "wrongNamePath = path.join(temp, 'pwa-s4b2-wrong-name.bin')",
    "alteredContentPath = path.join(temp, 'altered', ready.upload_name)",
    "first[0] ^= 0xff",
    'Math.trunc(changed.mtimeMs), Math.trunc(expected.mtimeMs)',
    'await assertRejectedReselection(wrongNamePath,',
    'await assertRejectedReselection(alteredContentPath,',
    'uploadSessionRequests.length, 0',
    "(await readRequestCounters()).session_posts, 1",
    'x.id === originalTaskID',
    'summary.originalRetryPreserved = true',
    'document.body?.innerText.includes(expected) === true',
    'await again.setFiles(filepath)',
  ]) assert.ok(chrome.includes(token), token)
  assert.doesNotMatch(chrome, /page\.route\(|context\.route\(|route\.fulfill\(/)
  assert.doesNotMatch(chrome, /readFileSync\(filepath\)/)
})

test('S4B2-A: input differs from sparse-zero 1 GiB benchmark; Go and Node agree independently', () => {
  const go = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
  const chrome = read('desktop/scripts/pwa-real-gin-upload-resume-browser.cjs')
  assert.ok(go.includes('buffer[index] = byte((i*31 + (i >> 7)) % 251)'))
  assert.ok(chrome.includes('scratch[n] = (i * 31 + (i >> 7)) % 251'))
  assert.ok(go.includes('const expectedBytes = int64(17 << 20)'))
  assert.ok(chrome.includes('17 * 1024 * 1024'))
  assert.doesNotMatch(chrome, /readFileSync\(filepath\)/)
  assert.doesNotMatch(chrome, /Bearer\s+fixture/)
})

test('S4B2-A: production resume implementation remains strictly same file and only eligible failed task', () => {
  const api = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  const helper = read('web/src/pwaUploadResume.ts')
  for (const marker of [
    'chunkHashes.join(\'\\n\')',
    'manifestSHA256 !== expectedResumeManifestSHA256',
    'session.received_chunks.map',
    'existing.size === expectedSize && existing.sha256 === hash',
  ]) assert.ok(api.includes(marker), marker)
  assert.ok(helper.includes("task.resume_conflict_policy !== 'fail'"))
  assert.ok(app.includes('xDrivePwaResumeFileError(task, file)'))
  assert.ok(app.includes('task.resume_manifest_sha256)'))
  assert.ok(app.includes('webTransferStore.markUploadReselected(task.id)'))
})

test('S4B2-A: real branch scoped CI never archives credentials, profiles or CAS bytes', () => {
  const workflow = read('.github/workflows/pwa-s4b2-real-resume.yml')
  const docs = read('docs/pwa-delivery.md')
  const script = read('desktop/scripts/pwa-real-gin-upload-resume-browser.cjs')
  assert.ok(workflow.includes("github.head_ref == 'test/pwa-upload-wrong-file-reject-s4b2b1-20261013'"))
  assert.ok(workflow.includes('node desktop/scripts/pwa-real-gin-upload-resume-browser.cjs'))
  assert.ok(workflow.includes('XD_PWA_S4B2_REAL_RESUME=1'))
  assert.ok(workflow.includes('git rev-parse HEAD'))
  assert.ok(workflow.includes('desktop/pwa-s4b2-results/summary-*.json'))
  assert.ok(!workflow.includes('pwa-s4b2-private-gin.log\n'))
  assert.ok(script.includes("console.error('PWA_S4B2_FAILED stage='"))
  assert.ok(script.includes('serverRequestCounters'))
  assert.ok(script.includes('observedTransfers'))
  assert.ok(script.includes('summary.serverRequestCounters.session_posts, 2'))
  assert.ok(script.includes('summary.serverRequestCounters.chunk0_puts, 1'))
  assert.ok(workflow.includes("grep -oE 'S4B2 (HTTP resume was not reused"))
  assert.ok(docs.includes('PWA-S4B2-A'))
  assert.ok(docs.includes('真实 Chrome'))
})
