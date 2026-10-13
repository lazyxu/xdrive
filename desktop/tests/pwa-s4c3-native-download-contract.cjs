'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const fixture = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const seeder = read('internal/api/pwa_s4c3_native_download_fixture_test.go')
const chrome = read('desktop/scripts/pwa-s4c3-native-download-browser.cjs')
const workflow = read('.github/workflows/pwa-s4c3-real-native-download.yml')
const doc = read('docs/pwa-delivery.md')
const api = read('web/src/api.ts')
const sink = read('web/src/downloadSink.ts')

test('S4C3-B1 seeds real 1/4 GiB physically allocated high entropy canonical CAS with independent full SHA', () => {
  for (const fragment of [
    'crypto/aes', 'cipher.NewCTR', 'io.LimitReader', 'sha256.New()',
    'ContentAddressedKey(expectedHash)', 'local.Put(context.Background(), key',
    'stat.Blocks * 512', 'allocated < size*98/100',
    'meta.ContentBlob', 'meta.FileVersion', 'io.Copy(check, original)',
    'pwaS4C3VerifyPhysicalCAS', 'sizeGiB != 1 && sizeGiB != 4',
  ]) assert(seeder.includes(fragment), fragment)
  for (const fragment of [
    'XD_PWA_S4C3_NATIVE_DOWNLOAD', 'pwaS4C3SeedNativeFile',
    'pwaS4C3VerifyPhysicalCAS(t, db, local, nativeSeed)',
    'native_download_physically_allocated', 'native_download_sha256',
    'nativeDownloadMode && (resumeMode || largeResumeMode || folderResumeMode)',
  ]) assert(fixture.includes(fragment), fragment)
})

test('S4C3-B1 authentic native Chrome downloads are saved to actual OS disk and entirely SHA256 read back', () => {
  for (const fragment of [
    "page.waitForEvent('download'", 'download.saveAs(saved)',
    "fs.createReadStream(filepath", "crypto.createHash('sha256')",
    'disk.blocks * 512 >= disk.size * .98', 'digest.sha256, ready.native_download_sha256',
    'nativeSHA256Verified = true', "page.getByRole('menuitem', {name: '下载', exact: true})",
    "['desktop', 'mobile'].includes(args.mode)",
    'sourcePhysicallyAllocated: true', 'acceptDownloads: true',
  ]) assert(chrome.includes(fragment), fragment)
  assert(!chrome.includes('page.route('), 'no mocked backend routes')
  assert(!chrome.includes('route.fulfill('), 'no fabricated HTTP download payload')
  assert(api.includes('this.nativeDownloadURL(ticket.url)'))
  assert(api.includes("if (downloadSink.kind === 'blob')"))
  assert(sink.includes("document.createElement('a')"))
})

test('S4C3-B1 real signed 206/416, no-ticket 401 and SW privacy are independently asserted', () => {
  for (const fragment of [
    "headers: {'Range': 'bytes='", 'response.status(), 206',
    'beyond.status(), 416', 'missing.status(), 401',
    "cached.every(p => p === '/offline.html')",
    'onlyPublicOfflineCache = true',
  ]) assert(chrome.includes(fragment), fragment)
  assert(!chrome.includes('skipWaiting'), 'SW must never auto-activate')
  assert(!chrome.includes('localStorage.setItem'), 'no local private byte persistence')
})

test('S4C3-B1 CI is isolated from other PRs and never archives credentials or native payload', () => {
  for (const fragment of [
    "github.head_ref == 'test/pwa-native-disk-s4c3b1-20261013'",
    'XD_PWA_S4C3_NATIVE_DOWNLOAD=1', "npm --prefix web run build",
    'go test -c -o', 'playwright-core@1.56.1',
    'node --check desktop/scripts/pwa-s4c3-native-download-browser.cjs',
    'node --test desktop/tests/pwa-s4c3-native-download-contract.cjs',
    '--mode="$MODE"', 'summary-*.json',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
  ]) assert(workflow.includes(fragment), fragment)
  assert(workflow.includes('XD_PWA_S4C3_SIZE_GIB:'))
  assert(!/^\s*path:\s*desktop\/pwa-s4c3-native-results\/\s*$/m.test(workflow),
    'the artifact may include summaries only, not temporary files')
  assert(!workflow.includes('cat "$RUNNER_TEMP/pwa-s4c3-private-gin-'),
    'never print private Go logs containing ticket state')
})

test('S4C3-B1 handoff records mobile simulation and installed-device limits', () => {
  assert(doc.includes('PWA-S4C3-B1'))
  assert(doc.includes('OS Installed') && doc.includes('iOS 27'))
  assert(doc.includes('S4C3-B2'))
})
