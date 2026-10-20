'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('S4B2-B2: only the isolated Gin fixture can opt in to exact 1 GiB', () => {
  const go = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
  for (const token of [
    'largeResumeMode := os.Getenv("XD_PWA_S4B2_LARGE_RESUME") == "1"',
    'if largeResumeMode && !resumeMode',
    'resumeExpectedBytes = 1 << 30',
    'resumeExpectedChunks = 128',
    'maxUploadBytes = 2 << 30',
    'resumeFileName = "pwa-s4b2-1gib.bin"',
    'lastChunkRequests.Add(1)',
    'totalChunkRequests.Add(1)',
    'lastChunkRequests.Load() != 1',
    'totalChunkRequests.Load() < resumeExpectedChunks+injectedNetworkDrops.Load()',
    'verifiedBytes = resumeExpectedBytes',
    'io.Copy(actual, object)',
    'S4B2 complete physical nonzero-file SHA256 mismatch',
  ]) assert.ok(go.includes(token), token)
})

test('S4B2-B2: original 17 MiB negative-file tests retained, 1 GiB source physically allocated', () => {
  const js = read('desktop/scripts/pwa-real-gin-upload-resume-browser.cjs')
  for (const token of [
    'assert.equal(ready.upload_size_bytes, 1 * 1024 * 1024 * 1024)',
    'assert.equal(ready.expected_chunks, 128)',
    'if (largeResume) fs.fsyncSync(fd)',
    'actual.blocks * 512',
    'actual.size * 0.98',
    'if (!largeResume) prepareRejectedInputs()',
    'await firstChooser.setFiles(filepath)',
    "page.reload({ waitUntil: 'domcontentloaded' })",
    'await again.setFiles(filepath)',
    'summary.serverRequestCounters.last_chunk_puts, 1',
    'ready.expected_chunks + summary.serverRequestCounters.tcp_drops',
    'summary.lastChunkVerified = true',
    "assertXDrivePublicShellCache(cache)",
  ]) assert.ok(js.includes(token), token)
  assert.doesNotMatch(js, /readFileSync\(filepath\)/)
  assert.doesNotMatch(js, /(?:page|context)\.route\(|route\.fulfill\(/)
  assert.doesNotMatch(js, /skipWaiting\(/)
})

test('S4B2-B2: dedicated exact-HEAD real Go Chrome CI preserves artifacts secrecy', () => {
  const yml = read('.github/workflows/pwa-s4b2-real-1gib-resume.yml')
  const old = read('.github/workflows/pwa-s4b2-real-resume.yml')
  assert.ok(yml.includes("github.head_ref == 'test/pwa-real-1gib-interrupted-resume-s4b2b2-20261013'"))
  assert.ok(old.includes("github.head_ref == 'test/pwa-upload-wrong-file-reject-s4b2b1-20261013'"))
  for (const token of [
    'XD_PWA_S4B2_LARGE_RESUME=1',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'df -Pk "$RUNNER_TEMP"',
    'go test -c -o',
    'node --check desktop/scripts/pwa-real-gin-upload-resume-browser.cjs',
    'desktop/tests/pwa-s4b2-1gib-resume-contract.cjs',
    'for MODE in desktop mobile',
    'test.timeout=18m',
    'r.inputBytes!==1073741824',
    'r.sourceAllocatedBytes<1052266988',
    'r.lastChunkVerified',
    'desktop/pwa-s4b2-1gib-results/summary-*.json',
  ]) assert.ok(yml.includes(token), token)
  assert.ok(!yml.includes("path: desktop/pwa-s4b2-1gib-results/*.log"))
  assert.ok(!yml.includes("path: $RUNNER_TEMP"))
})

test('S4B2-B2: production resume integrity and mobile Web/File UI remain shared', () => {
  const api = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  const sw = read('assets/icon/web/sw.js')
  assert.ok(api.includes("chunkHashes.join('\\n')"))
  assert.ok(api.includes('manifestSHA256 !== expectedResumeManifestSHA256'))
  assert.ok(api.includes('session.received_chunks.map'))
  assert.ok(app.includes('xDrivePwaResumeFileError(task, file)'))
  assert.ok(app.includes('webTransferStore.markUploadReselected(task.id)'))
  assert.ok(sw.includes("const OFFLINE_URL = '/offline.html'"))
  assert.ok(!sw.includes('skipWaiting('))
})
