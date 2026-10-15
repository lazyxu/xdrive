'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const fixture = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const helper = read('internal/api/pwa_s4c3_native_cancel_fixture_test.go')
const browser = read('desktop/scripts/pwa-s4c3-native-download-browser.cjs')
const workflow = read('.github/workflows/pwa-s4c3-real-native-download.yml')
const doc = read('docs/pwa-delivery.md')

test('S4C3-B2c1 opt-in pacing is actual HTTP and the Go database is independently checked', () => {
  for (const s of [
    'XD_PWA_S4C3_CANCEL', 'nativeCancelMode && !nativeDownloadMode',
    'nativeFirstDownloadPaced.CompareAndSwap(false, true)',
    'router.ServeHTTP(&pwaS4C3PacedWriter',
    'pwaS4C3VerifyNativeCancelRetry(t, db, owner.ID, nativeSeed.size)',
  ]) assert(fixture.includes(s), s)
  for (const s of [
    'type pwaS4C3PacedWriter struct', 'w.ResponseWriter.Write(data)',
    'time.Sleep(80 * time.Millisecond)', 'pwaS4C3VerifyNativeCancelRetry',
    'row.ActiveRequests != 0', 'row.FailureState != "cancelled"',
    'row.BytesSent <= 0 || row.BytesSent >= expectedSize',
    'row.BytesSent != expectedSize', 'cancelled != 1 || completed != 1',
  ]) assert(helper.includes(s), s)
  assert(!helper.includes('ResponseRecorder'))
})

test('S4C3-B2c1 Chrome user cancel and independent signed retry verify real disk SHA', () => {
  for (const s of [
    'const cancelFirst', "page.waitForEvent('download'",
    'await interrupted.cancel()', "await interrupted.failure(), 'canceled'",
    'cancelledDownloadURL = interrupted.url()',
    'ticketRequests >= (cancelFirst ? 2 : 1)',
    "assert.notEqual(download.url(), cancelledDownloadURL",
    'summary.nativeDownloadCancelled = true',
    'summary.freshTicketAfterCancel = true',
    'await download.saveAs(saved)', 'digest.sha256, ready.native_download_sha256',
    "cached.every(p => p === '/offline.html')",
  ]) assert(browser.includes(s), s)
  assert(!browser.includes('page.route('))
  assert(!browser.includes('route.fulfill('))
})

test('S4C3-B2c1 exact-head CI runs both browsers and archives only sanitized JSON', () => {
  const branch = 'test/pwa-native-cancel-retry-s4c3b2c1-20261015'
  for (const s of [
    "github.head_ref == '" + branch + "'",
    'XD_PWA_S4C3_CANCEL:', 'XD_PWA_S4C3_CANCEL="$XD_PWA_S4C3_CANCEL"',
    '--cancel-first="$XD_PWA_S4C3_CANCEL"',
    'desktop/tests/pwa-s4c3-native-cancel-contract.cjs',
    'nativeDownloadCancelled', 'freshTicketAfterCancel',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'pwa-s4c3-native-results/summary-*.json',
  ]) assert(workflow.includes(s), s)
  assert(!workflow.includes('cat "$RUNNER_TEMP/pwa-s4c3-private-gin-'))
  assert(!/^\s*path:\s*desktop\/pwa-s4c3-native-results\/\s*$/m.test(workflow))
  assert(doc.includes('PWA-S4C3-B2c1'))
  assert(doc.includes('iOS 27') && doc.includes('OS Installed'))
})
