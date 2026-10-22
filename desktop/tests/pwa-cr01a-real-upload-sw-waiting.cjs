'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = path => fs.readFileSync(require('node:path').join(root, path), 'utf8')
const workflow = read('.github/workflows/pwa-cr01a-real-upload-sw-waiting.yml')
const browser = read('desktop/scripts/pwa-cr01a-real-upload-sw-waiting.cjs')
const script = read('scripts/pwa-cr01a-real-upload-sw-waiting.sh')
const go = read('internal/api/pwa_b2b2b2_hot_upload_postflight_linux_test.go')
const uploads = read('internal/api/uploads.go')
const caddy = read('deploy/Caddyfile.common')
const doc = read('docs/pwa-cr01a-real-upload-sw-waiting.md')

test('two actual production Go/Web SHAs and a single PostgreSQL17/Local CAS are mandatory', () => {
  for (const term of [
    'e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4',
    'npm --prefix release-a/web run build',
    'npm --prefix release-b/web run build',
    'cd release-a && go build',
    'cd release-b && go build',
    './cmd/server', 'postgres:17-alpine',
    'github.event.pull_request.head.sha || github.sha',
    'pwa-b2b2b2-A', 'pwa-b2b2b2-B'
  ]) assert.ok(workflow.includes(term), term)
  for (const term of [
    'XD_DATABASE_URL="$XD_TEST_DATABASE_URL"',
    'XD_STORAGE_ROOT="$CAS"',
    'XD_JWT_SECRET="pwa-b2b2b1-synthetic-shared-ci-key-only-2026"',
    'admin create --username pwa-b2b2b1-owner --password-stdin',
    'wait_ready "$PORT_A"', 'wait_ready "$PORT_B"',
    'pwa-archive-assets.sh'
  ]) assert.ok(script.includes(term), term)
  assert.ok(caddy.includes('handle /api/*'))
  assert.ok(caddy.includes('handle /assets/*'))
})

test('actual Chromium creates and uploads the first 8 MiB over genuine HTTP to Go A', () => {
  for (const term of [
    "const size = 17 * 1024 * 1024",
    'const chunk = 8 * 1024 * 1024',
    "crypto.subtle.digest('SHA-256'",
    "'/api/v1/uploads'",
    "'/chunks/0'",
    "'X-Chunk-SHA256': firstHash",
    'response.status !== 201',
    'snapshot.received_chunks?.length !== 1',
    'window.__pwaHotUpload =',
    "page.locator('#web-login-username')",
    "page.locator('#web-login-password')",
    'navigator.serviceWorker.controller',
  ]) assert.ok(browser.includes(term), term)
  assert.ok(uploads.includes('func (s *Server) createUploadSession(c *gin.Context)'))
  assert.ok(uploads.includes('func (s *Server) putUploadChunk(c *gin.Context)'))
  assert.doesNotMatch(browser, /context\.route\(|route\.fulfill\(/)
})

test('the old Go process is actually SIGKILLed, dead upstream returns 502, Caddy really reloads', () => {
  for (const term of [
    "process.kill(pidA, 'SIGKILL')",
    'await verifyDeadOldGo()',
    "assert.equal(interrupted.status(), 502",
    "spawnSync('docker', ['exec', container, 'caddy', 'reload'",
    'await version(context, ' + "'pwa-b2b2b2-B'",
    'summary.actualGoASigkill = true',
    'summary.first8MiBCommittedBeforeGoDeath = true',
    "authentic Caddy reload A->B failed"
  ]) assert.ok(browser.includes(term), term)
  assert.doesNotMatch(browser, /skipWaiting\(|location\.reload\(|fakeUpload|mockServer/)
  assert.ok(script.includes('XD_PWA_HOT_UPLOAD_GO_A_PID="$A_PID"'))
})

test('Go B reuses same JWT/session/chunk0, uploads only chunks 1-2, idempotently finalizes', () => {
  for (const term of [
    "localStorage.getItem('xdrive.access_token') !== state.token",
    "'/api/v1/uploads/' + id",
    'resume.status !== 200',
    'reused.id !== id',
    'for (let i = 1; i < 3; i++)',
    "response.status !== 201",
    "'/finalize'",
    'second.result?.id !== answer.result.id',
    'again.status !== 200',
    'summary.originalChunk0NeverReuploaded = sentB.onlyNewChunksOnB',
    'summary.originalUploadSessionReused = sentB.sameOriginalID'
  ]) assert.ok(browser.includes(term), term)
  assert.ok(uploads.includes('req.ResumeKey'))
  assert.ok(uploads.includes('session.Status == meta.UploadStatusFinalized'))
})

test('separate Go process verifies every nonzero physical byte and real CAS references', () => {
  for (const term of [
    'TestPWARealGoHotUploadPhysicalPostflight',
    'meta.UploadStatusFinalized',
    'session.ResultNodeID == nil',
    'storage.NewLocal(root)',
    'local.Open(context.Background(), key)',
    'io.Copy(actualHash, physical)',
    'offset*31 + (offset >> 7)',
    'expected != found || expected != file.SHA256',
    'blob.State != meta.ContentBlobStateReady',
    'blob.RefCount < 1',
    'PWA_B2B2B2_REAL_POSTFLIGHT_OK'
  ]) assert.ok(go.includes(term), term)
  assert.ok(uploads.includes('if currentSession.NodeID == nil'))
  assert.ok(uploads.includes('tx.Create(&meta.FileVersion{'))
  assert.ok(go.includes('versions != 0 || node.Revision != 1'))
  assert.ok(go.includes('new file must be live revision 1 with zero old history rows'))
  assert.ok(script.includes("XD_PWA_B2B2B2_PHYSICAL=1 go test"))
  assert.ok(script.includes('s.physicalGoCASPostflight = true'))
  assert.ok(script.includes('PWA_CR01A_REAL_17M_GO_CAS_AND_TWO_WINDOW_SW_WAITING_PASSED'))
  assert.ok(workflow.includes('node --check release-b/desktop/scripts/pwa-cr01a-real-upload-sw-waiting.cjs'))
})

test('evidence is accurately scoped; no owner data or credentials enter CI artifacts', () => {
  for (const term of [
    'productionFilePicker: false',
    'oldSWWaitingVerified: false',
    'physicalIOS: false',
    'physicalGoCASPostflight: false',
    'actualHttpFileChunks: false',
  ]) assert.ok(browser.includes(term), term)
  assert.ok(workflow.includes('pwa-cr01a-results/summary.json'))
  assert.ok(workflow.includes('bash release-b/scripts/pwa-cr01a-real-upload-sw-waiting.sh'))
  assert.ok(!workflow.includes('pwa-go-hot-session-b2b2b1.sh'))
  assert.ok(!workflow.includes('pwa-b2b2b1-results/summary.json'))
  assert.ok(script.includes('CADDY_NAME="xdrive-pwa-cr01a-$$"'),
    'real Docker container name must have a safe numeric PID suffix')
  assert.ok(!workflow.includes('private-go-A.log'))
  assert.ok(!workflow.includes('private-admin.log'))
  assert.ok(!workflow.includes('private-go-B.log'))
  assert.ok(doc.includes('并非生产 UI 的 Files 上传选择器'))
  assert.ok(doc.includes('真实 17 MiB'))
  assert.ok(doc.includes('未验证'))
})

test('CR-01a waits with two old Chrome windows while authenticated 17MiB Go upload is active', () => {
  const worker = read('assets/icon/web/sw.js')
  for (const token of [
    'const peer = await context.newPage()', "await peer.reload({ waitUntil: 'commit' })",
    'await rememberOldController(page)', 'await rememberOldController(peer)',
    'assert(await oldWorkerStayed(page, true)', 'assert(await oldWorkerStayed(peer, true)',
    'publishWebB()', 'await reg.update()', 'await waitWaiting(page)',
    'summary.oldSWWaitingVerified = true',
    'summary.realUploadSessionActiveWhileWaiting = true',
    'summary.twoOldWindowsStayedControlled = true',
    'summary.oldDocumentStayedMounted = true',
    'summary.newSWActivatedOnlyAfterBothClosed = true',
    'await peer.close()', 'await page.close()', 'await waitNewActive(fresh)',
    "const sentA = await phaseA(page)", "const sentB = await phaseB(page)",
    'summary.originalChunk0NeverReuploaded = sentB.onlyNewChunksOnB',
  ]) assert.ok(browser.includes(token), 'combined SW/real upload contract missing '+token)
  assert.doesNotMatch(worker, /self\.skipWaiting\s*\(/)
  assert.doesNotMatch(browser, /self\.skipWaiting\s*\(|context\.route\(|route\.fulfill\(/)
  for (const token of [
    'pwa-archive-assets.sh', 'XD_PWA_HOT_UPLOAD_PUBLIC="$PUBLIC"',
    'result.oldSWWaitingVerified', 'result.twoOldWindowsStayedControlled',
    'result.realUploadSessionActiveWhileWaiting', 'result.newSWActivatedOnlyAfterBothClosed',
    'result.physicalGoCASPostflight',
  ]) assert.ok(script.includes(token), 'shell combined contract missing '+token)
})
test('CR-01a exact-head workflow uses real Chrome/Go/Caddy/PG17 and only anonymous evidence', () => {
  for (const token of [
    "github.head_ref == 'test/pwa-cr01a-real-upload-sw-waiting-20261022'",
    'postgres:17-alpine', 'docker pull caddy:2.10.2-alpine',
    'release-a', 'release-b', 'playwright-core@1.56.1',
    'bash release-b/scripts/pwa-cr01a-real-upload-sw-waiting.sh',
    'node --check release-b/desktop/scripts/pwa-cr01a-real-upload-sw-waiting.cjs',
    'node --test release-b/desktop/tests/pwa-cr01a-real-upload-sw-waiting.cjs',
  ]) assert.ok(workflow.includes(token), 'missing exact-head real CI '+token)
  assert.ok(workflow.includes('release-b/desktop/pwa-cr01a-results/summary.json'))
  assert.ok(!workflow.includes('continue-on-error:'))
  assert.ok(!workflow.includes('private-go-A.log'))
  assert.ok(!workflow.includes('private-go-B.log'))
  assert.ok(!workflow.includes('browser-profile'))
})

test('CR-01a Chrome update churn cannot bypass stable two-window waiting or original client invariants', () => {
  for (const token of [
    'await waitWaiting(page)',
    'await waitStableTwoWindowSWWaiting(page, peer)',
    'a.oldClientIntact && b.oldClientIntact',
    'a.waitingInstalled && b.waitingInstalled',
    'Date.now() - stableSince >= 600',
    "throw Error('new production SW never maintained stable waiting",
    'await recordWorkerMismatch(first',
    'await recordWorkerMismatch(second',
    "summary.oldSWWaitingVerified = true",
  ]) {
    if (token === 'a.oldClientIntact && b.oldClientIntact') {
      assert.ok(browser.includes('!a.oldClientIntact || !b.oldClientIntact'))
    } else assert.ok(browser.includes(token), token)
  }
  assert.equal((browser.match(/await reg\.update\(\)/g) || []).length, 1,
    'test must not mask genuine waiting instability by forcing repeated SW updates')
  assert.doesNotMatch(browser, /self\.skipWaiting\s*\(|location\.reload\(\)|context\.route\(/)
})
