'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const runner = read('desktop/scripts/pwa-two-release-web-p0b2b1.cjs')
const workflow = read('.github/workflows/pwa-two-release-web-p0b2b1.yml')
const archive = read('deploy/pwa-archive-assets.sh')
const worker = read('assets/icon/web/sw.js')
const doc = read('docs/pwa-two-release-web-p0b2b1.md')

test('P0-B2b1 uses two independent real Web builds, not generated version labels', () => {
  for (const s of [
    'XD_PWA_B2B_A_DIST', 'XD_PWA_B2B_B_DIST',
    'XD_PWA_B2B_A_SHA', 'XD_PWA_B2B_B_SHA',
    ".vite/manifest.json", 'isDynamicEntry', "index.html",
    'assert.notEqual(a.revision, b.revision',
    'assert.notEqual(a.entryDigest, b.entryDigest',
  ]) assert.ok(runner.includes(s), s)
  assert.doesNotMatch(runner, /old-lazy-v1|new-lazy-v2|servedWorker|messageProbe/)
  assert.ok(workflow.includes('e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4'))
  assert.ok(workflow.includes('npm --prefix release-a/web run build'))
  assert.ok(workflow.includes('npm --prefix release-b/web run build'))
})

test('P0-B2b1 tests genuine ESM bytes through the POSIX durable archive', () => {
  for (const s of [
    "spawnSync('sh', [archiveScript",
    "fs.readFileSync(path.join(archive, item.lazy.slice('assets/'.length)))",
    "await import('/' + file)",
    "crypto.subtle.digest('SHA-256'",
    'await waitWaiting(page, initial, target)',
    "await waitActive(page, target)",
    'realManifestLazyESM: true',
    'oldLazySHA256:', 'newLazySHA256:',
    'observed.privateRequests >= 2',
    "assert.equal(missing.status, 404)",
  ]) assert.ok(runner.includes(s), s)
  assert.ok(archive.includes('immutable asset collision'))
  assert.ok(worker.includes('SHELL_PREFIX'))
})

test('P0-B2b1 does not force upgrade or cache private account data', () => {
  for (const s of [
    "waitUntil: 'commit'",
    "'[data-xdrive-pwa-login-entry]'",
    'navigator.serviceWorker.controller',
    'reg.waiting', 'window.__xdriveB2bHeldClient',
    'privateNetworkOnly: true',
    "url.startsWith('/api/')",
    "target.pathname.startsWith('/api/')",
    "no-cache, must-revalidate",
    "public, max-age=31536000, immutable",
  ]) assert.ok(runner.includes(s), s)
  assert.doesNotMatch(runner, /skipWaiting\s*\(|registration\.unregister\s*\(/)
  assert.doesNotMatch(worker, /skipWaiting\s*\(/)
  assert.ok(runner.includes('actualGoServerVersions: false'))
  assert.ok(runner.includes('actualCaddyBinary: false'))
  assert.ok(runner.includes('physicalIOS: false'))
})

test('P0-B2b1 CI tests the exact checked-out candidate, with no success by simulation', () => {
  for (const s of [
    "github.event.pull_request.head.sha",
    'playwright-core@1.56.1',
    'node --test release-b/desktop/tests/pwa-two-release-web-p0b2b1.cjs',
    'node release-b/desktop/scripts/pwa-two-release-web-p0b2b1.cjs',
    'release-b/desktop/pwa-b2b1-results/summary.json',
    'feat/pwa-two-release-web-p0b2b1-20261021',
  ]) assert.ok(workflow.includes(s), s)
  assert.ok(doc.includes('不是 Go Server 双版本 API 验收'))
  assert.ok(doc.includes('真实独立构建'))
})

test('P0-B2b1 navigation requires actual visible UI rather than waiting for all deferred scripts', () => {
  assert.equal((runner.match(/waitUntil: 'commit'/g) || []).length, 2)
  assert.ok(!runner.includes("waitUntil: 'load'"))
  assert.ok(!runner.includes("waitUntil: 'domcontentloaded'"))
  assert.ok(runner.includes('assert.equal(initial?.status(), 200'))
  assert.ok(runner.includes("'[data-xdrive-pwa-login-entry]'"))
  assert.ok(runner.includes('await page.evaluate(() => navigator.serviceWorker.ready)'))
  assert.ok(runner.includes('await waitWaiting(page, initial, target)'))
})

test('P0-B2b1 local HTTP and Chrome transport failures are observable without HAR', () => {
  assert.ok(runner.includes("http.get(origin + '/index.html'"))
  assert.ok(runner.includes('assert.equal(observed.preflight.status, 200)'))
  assert.ok(runner.includes('observed.browserEvents.length < 18'))
  assert.ok(runner.includes('observed.documents++'))
  assert.ok(runner.includes('summary.diagnostics = observed'))
  assert.ok(!runner.includes('JSON.stringify(req.headers)'))
})

test('P0-B2b1 local preflight is HTTP 200 with valid MIME and parse gate', () => {
  assert.ok(runner.includes("observed.preflight.mime.startsWith('text/html')"))
  assert.ok(workflow.includes('node --check release-b/desktop/scripts/pwa-two-release-web-p0b2b1.cjs'))
  assert.ok(!runner.includes('assert.match(observed.preflight.mime'))
})

test('P0-B2b1 local archive integrity uses the same path as /assets/ HTTP delivery', () => {
  assert.ok(runner.includes("path.join(rel.dist, 'assets')"))
  assert.ok(runner.includes("const name = target.pathname.slice('/assets/'.length)"))
  assert.ok(runner.includes("path.join(archive, item.lazy.slice('assets/'.length))"))
  assert.doesNotMatch(runner, /readFileSync\(path\.join\(archive, item\.lazy\)\)/)
})
