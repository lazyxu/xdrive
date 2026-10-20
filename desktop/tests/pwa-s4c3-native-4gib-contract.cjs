'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const workflow = read('.github/workflows/pwa-s4c3-real-native-download.yml')
const browser = read('desktop/scripts/pwa-s4c3-native-download-browser.cjs')
const fixture = read('internal/api/pwa_s4c3_native_download_fixture_test.go')
const gin = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const delivery = read('docs/pwa-delivery.md')

test('S4C3-B2a 4 GiB mode runs on the exact scoped head while retaining earlier 1 GiB and manual modes', () => {
  const branch = 'test/pwa-native-4gib-s4c3b2a-20261013'
  for (const fragment of [
    "github.head_ref == '" + branch + "'",
    "github.head_ref == 'test/pwa-native-disk-s4c3b1-20261013'",
    'github.event_name == \'workflow_dispatch\'',
    "github.head_ref == '" + branch + "' && '4'",
    "options: ['1', '4']",
    'XD_PWA_S4C3_SIZE_GIB:',
    "node --test desktop/tests/pwa-s4c3-native-download-contract.cjs desktop/tests/pwa-s4c3-native-4gib-contract.cjs",
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    "test -z \"$(gofmt -l",
    "go test -c -o",
    'npm --prefix web run build',
  ]) assert(workflow.includes(fragment), fragment)
  const size = 4 * 2 ** 30
  assert.equal(size, 4294967296)
  assert(Number.isSafeInteger(size))
  assert.equal((size - 32) + 31, 4294967295)
  assert.equal(size + 17, 4294967313)
})

test('S4C3-B2a authentic 4 GiB source and native OS disk checksum cannot be replaced by sparse or first/last spot tests', () => {
  for (const fragment of [
    'sizeGiB != 1 && sizeGiB != 4',
    'size := sizeGiB << 30',
    'stat.Blocks * 512',
    'allocated < size*98/100',
    'pwaS4C3Stream(t, size)',
    'local.Put(context.Background(), key,',
    'io.Copy(check, original)',
    'file.Size != seed.size',
  ]) assert(fixture.includes(fragment), fragment)
  for (const fragment of [
    'XD_PWA_S4C3_SIZE_GIB',
    'pwaS4C3SeedNativeFile(t, db, local',
    'pwaS4C3VerifyPhysicalCAS(t, db, local, nativeSeed)',
    'native_download_size_bytes',
  ]) assert(gin.includes(fragment), fragment)
  for (const fragment of [
    'ready.native_download_size_bytes === 4 * 2 ** 30',
    "page.waitForEvent('download'",
    'await download.saveAs(saved)',
    'fs.statSync(saved)',
    'disk.blocks * 512 >= disk.size * .98',
    "crypto.createHash('sha256')",
    'fs.createReadStream(filepath',
    'digest.bytes, ready.native_download_size_bytes',
    'digest.sha256, ready.native_download_sha256',
    'summary.nativeSHA256Verified = true',
    'summary.actualDiskFile = true',
    "page.getByRole('menuitem', {name: '下载', exact: true})",
    "['desktop', 'mobile'].includes(args.mode)",
  ]) assert(browser.includes(fragment), fragment)
  assert(!browser.includes('page.route('))
  assert(!browser.includes('route.fulfill('))
  assert(!browser.includes('Buffer.alloc(4294967296)'))
})

test('S4C3-B2a 4 GiB refuses insufficient real disk and preserves full-file and signing gates', () => {
  for (const fragment of [
    'REQUIRED_KIB="$((XD_PWA_S4C3_SIZE_GIB * 3 * 1024 * 1024))"',
    'if [ "$AVAILABLE_KIB" -lt "$REQUIRED_KIB" ]',
    "echo \"Insufficient physical disk for 1/4 GiB native fixture\"",
    'for MODE in desktop mobile; do',
    'actualNativeDownload',
    'actualDiskFile',
    'nativeSHA256Verified',
    'range206',
    'range416',
    'ticketRequired',
    'onlyPublicOfflineCache',
    "s.fixtureBytes !== Number(process.env.XD_PWA_S4C3_SIZE_GIB)*2**30",
  ]) assert(workflow.includes(fragment), fragment)
  for (const fragment of [
    "response.status(), 206",
    "beyond.status(), 416",
    "missing.status(), 401",
    "assertXDrivePublicShellCache(cached)",
    'summary.onlyPublicOfflineCache = true',
  ]) assert(browser.includes(fragment), fragment)
  assert(!workflow.includes('cat "$RUNNER_TEMP/pwa-s4c3-private-gin-'))
  assert(workflow.includes('path: desktop/pwa-s4c3-native-results/summary-*.json'))
  assert(!/^\s*path:\s*desktop\/pwa-s4c3-native-results\/\s*$/m.test(workflow))
})

test('S4C3-B2a handoff distinguishes Chrome Android emulation from true installed iOS and Android devices', () => {
  assert(delivery.includes('PWA-S4C3-B2a'))
  assert(delivery.includes('4,294,967,296 B'))
  assert(delivery.includes('S4C3-B2b/B2c'))
  assert(delivery.includes('iOS 27 Safari/Home Screen'))
  assert(delivery.includes('OS Installed'))
  assert(delivery.includes('Final Gate'))
})
