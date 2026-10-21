'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const browser = read('desktop/scripts/pwa-old-lazy-upgrade-p0b2a.cjs')
const workflow = read('.github/workflows/pwa-old-lazy-upgrade-p0b2a.yml')
const archive = read('deploy/pwa-archive-assets.sh')
const worker = read('assets/icon/web/sw.js')
const doc = read('docs/pwa-old-lazy-upgrade-p0b2a.md')

test('P0-B2a: production Vite lazy asset, POSIX archive and real browser', () => {
  for (const phrase of [
    "path.join(dist, '.vite/manifest.json')",
    'isDynamicEntry',
    'originalRealLazySize',
    "spawnSync('sh', [archiveScript, image, archive]",
    'fs.cpSync(assets, imageV1',
    'fs.cpSync(assets, imageV2',
    'chromium.launch(',
    "serviceWorkers: 'allow'",
    'http.createServer(',
    'await import(pathname)',
    'twoIndependentBuilds: false',
    'physicalDevice: false',
  ]) assert.ok(browser.includes(phrase), phrase)
})

test('P0-B2a: old JS imports after upgrade and stays available after rollback', () => {
  for (const phrase of [
    'oldRequestsBeforeUpgrade',
    'seed(imageV2)',
    'servedWorker = 2',
    'await waitForWorker(page, 1, true)',
    "assert.equal(await importVersion(page, oldURL), 'old-lazy-v1')",
    "assert.equal(await importVersion(page, newURL), 'new-lazy-v2')",
    'assert.equal(actualLazy.status, 200',
    'assert.equal(actualLazy.size, originalRealLazySize)',
    'await waitForWorker(page, 2, false)',
    'seed(imageV1)',
    'await waitForWorker(page, 2, true)',
    'await waitForWorker(page, 1, false)',
    'assert.equal(bad.status, 404)',
    "assert.doesNotMatch(bad.mime || '', /text\\/html/)",
  ]) assert.ok(browser.includes(phrase), phrase)
})

test('P0-B2a keeps private bytes network-only, waiting and no forced activation', () => {
  for (const phrase of [
    'no-cache, must-revalidate',
    'public, max-age=31536000, immutable',
    "res.writeHead(401",
    "value.startsWith('/api/')",
    'value === oldURL || value === newURL',
    'window.__p0b2OriginalDocument',
    'observed.credentials, 0',
    'context.close()',
  ]) assert.ok(browser.includes(phrase), phrase)
  assert.doesNotMatch(browser, /self\.skipWaiting\s*\(/)
  assert.doesNotMatch(worker, /self\.skipWaiting\s*\(/)
  assert.ok(archive.includes('immutable asset collision'))
})

test('P0-B2a exact-head CI uses production build, Chrome and summary-only evidence', () => {
  for (const phrase of [
    'github.event.pull_request.head.sha',
    'npm --prefix web ci',
    'npm --prefix web run build',
    'playwright-core@1.56.1',
    'XDRIVE_BROWSER_EXECUTABLE',
    'node desktop/scripts/pwa-old-lazy-upgrade-p0b2a.cjs',
    'node --test desktop/tests/pwa-old-lazy-upgrade-p0b2a.cjs',
    'desktop/pwa-p0b2-results/summary.json',
    'feat/pwa-old-lazy-browser-p0b2a-20261021',
  ]) assert.ok(workflow.includes(phrase), phrase)
  assert.ok(doc.includes('不等于两套独立真实版本'))
  assert.ok(doc.includes('未验证'))
})

// The real Chrome navigation gate must be the rendered public UI, not the
// entire window "load" event (third-party/long-lived requests can outlive it).
test('P0-B2a: use actual rendered App Shell readiness rather than full load', () => {
  assert.equal((browser.match(/waitUntil: 'domcontentloaded'/g) || []).length, 2)
  assert.equal((browser.match(/page\.locator\('\[data-xdrive-pwa-login-entry\]'\)\.waitFor/g) || []).length, 2)
  assert.doesNotMatch(browser, /waitUntil:\s*'load'/)
  assert.ok(browser.includes("assert.equal(entry?.status(), 200"))
  assert.ok(browser.includes("assert.equal(refreshed?.status(), 200"))
  assert.ok(browser.includes('await waitForWorker(page, 1, false)'))
  assert.ok(browser.includes('await waitForWorker(page, 2, false)'))
})
