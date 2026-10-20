const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const script = read('desktop/scripts/pwa-browser-install-offline.cjs')
const workflow = read('.github/workflows/pwa-s2b-browser.yml')
const runtime = read('web/src/pwaRuntime.ts')
const sw = read('assets/icon/web/sw.js')
const manifest = JSON.parse(read('assets/icon/web/site.webmanifest'))
const delivery = read('docs/pwa-delivery.md')

test('S2B1: actual production Chromium with service workers, not a simulated prompt fixture', () => {
  for (const token of [
    "serviceWorkers: 'allow'", 'window.isSecureContext',
    "navigator.serviceWorker?.controller", 'networkTransportDown = true',
    "page.reload({ waitUntil: 'domcontentloaded' })",
    "data-xdrive-pwa-login-entry", "data-xdrive-pwa-install-dialog",
    "data-xdrive-pwa-check", "data-xdrive-pwa-check-server",
    'headOffline: 0', 'headIcon192: 0', 'headIcon512: 0',
    'loopbackTransportWarning = true', 'offlineAssetChecked = true', 'iconsChecked = true',
    'await context.close()', 'cachedPublicOnly = true',
    "No authenticated Server API in S2B1 public fixture",
  ]) assert.ok(script.includes(token), 'missing actual browser contract: ' + token)
  assert.ok(script.includes('http.createServer('))
  assert.ok(script.includes('const { chromium } = require('))
  assert.ok(script.includes("await chromium.launch("))
  assert.ok(script.includes("spec.mobile ? {"))
  assert.equal(script.includes('serviceWorkers: \'block\''), false)
})

test('S2B1: real browser uses only public offline CacheStorage and never intercepts private routes', () => {
  assert.equal(manifest.id, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.icons.some(x => x.sizes === '192x192'))
  assert.ok(manifest.icons.some(x => x.sizes === '512x512'))
  assert.ok(sw.includes("const OFFLINE_URL = '/offline.html'"))
  assert.ok(sw.includes("url.pathname !== '/'"))
  assert.ok(sw.includes("request.mode === 'navigate'"))
  assert.ok(script.includes("context.newPage()"))
  assert.ok(script.includes('observed.privateTransportDrops > 0'))
  assert.ok(script.includes("assert.equal(restoredResponse.status(), 200"))
  assert.ok(script.includes("await page.reload({ waitUntil: 'load' })"))
  assert.equal(script.includes('context.setOffline(true)'), false,
    'Worker-owned fetch must be tested with a real socket failure, not a CDP network emulation')
  assert.ok(script.includes("/api/v1/files/1/download-ticket"))
  assert.ok(script.includes("assertXDrivePublicShellCache(cache)"))
  assert.equal(sw.includes('skipWaiting('), false)
  assert.ok(sw.includes('cache.put(pathname, response)'))
})

test('S2B1: exact-head CI builds real dist, and does not publish credentials or claim actual installation', () => {
  for (const token of [
    'node desktop/scripts/pwa-browser-install-offline.cjs',
    'npm --prefix web run build',
    'playwright-core@1.56.1',
    'github.event.pull_request.head.sha',
    'desktop/pwa-s2b1-results/summary.json',
    'XDRIVE_BROWSER_EXECUTABLE',
  ]) assert.ok(workflow.includes(token), 'missing release gate: ' + token)
  assert.ok(script.includes('physicalDevice: false'))
  assert.ok(script.includes('NOT OS-installed PWA'))
  assert.ok(runtime.includes("navigator.serviceWorker.register('/sw.js'"))
  assert.ok(delivery.includes('PWA-S2B1'))
  assert.ok(delivery.includes('PWA-S2B4'))
  assert.ok(workflow.includes("github.head_ref == 'feat/pwa-public-asset-diagnostics-s2b4-20261012'"))
  assert.ok(!workflow.includes('desktop/pwa-s2b1-results/\\n'),
    'CI must not archive arbitrary private browser profile contents')
})

test('S2B8: real Chrome hangs only a public install icon HEAD and proves network abort on dialog close', () => {
  for (const snippet of [
    'stallPwaIcon512Head = true',
    "res.once('close', () => { observed.headIcon512Aborted++ })",
    "observed.headIcon512Aborted > abortBefore",
    'pendingInstallProbeCancelled = true',
    'observed.headIcon512Aborted, 1',
  ]) assert.ok(script.includes(snippet), 'missing S2B8 browser evidence: ' + snippet)
  assert.ok(workflow.includes("github.head_ref == 'fix/pwa-install-diagnostics-cancel-s2b8-20261012'"))
  assert.ok(workflow.includes('x.pendingInstallProbeCancelled'))
  assert.ok(delivery.includes('PWA-S2B8'))
  assert.ok(!script.includes('context.route('), 'must abort a real browser HEAD, not a stubbed route')
})

test('S3D1: actual Chrome manually checks update without auto reload or routing changes', () => {
  for (const token of [
    "dialog.locator('[data-xdrive-pwa-check-update]')",
    "button.textContent?.includes('检查新版本')",
    'result.updateCheckSettled = true',
    'evidence.cases.every(x => x.updateCheckSettled)',
    'document.documentElement.dataset.xdriveS3D1Document',
  ]) assert.ok(script.includes(token), 'missing S3D1 browser guard: ' + token)
  assert.ok(workflow.includes("github.head_ref == 'fix/pwa-update-check-timeout-s3d1-20261013'"))
  assert.ok(workflow.includes('x.updateCheckSettled'))
  assert.ok(delivery.includes('PWA-S3D1'))
})
