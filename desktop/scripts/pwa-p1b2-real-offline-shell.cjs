#!/usr/bin/env node
'use strict'
// P1-B2: real built App + public Service Worker, distinct Chromium processes,
// cold offline browser relaunch and explicit historical-only UI. Native Chrome
// with a mobile viewport is NOT a physical installed iOS/Safari acceptance.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const ts = require(path.resolve(__dirname, '../../web/node_modules/typescript'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const { assertXDrivePublicShellCache } = require('./pwa-public-shell-cache.cjs')
const dist = path.resolve(__dirname, '../../web/dist')
const executable = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(executable && fs.existsSync(executable), 'Chromium binary required')
assert(fs.existsSync(path.join(dist, 'index.html')) && fs.existsSync(path.join(dist, 'sw.js')),
  'must build actual public SW shell first')

const js = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../../web/src/pwaOfflineDirectory.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}
let down = false
const requests = { networkDropped: 0, apiRejected: 0, staticServed: 0 }
const server = http.createServer((req, res) => {
  if (down) { requests.networkDropped++; res.destroy(); return }
  let url
  try { url = new URL(req.url, 'http://localhost') }
  catch { res.writeHead(400); res.end(); return }
  if (url.pathname.startsWith('/api/')) {
    requests.apiRejected++
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"error":"fixture not authenticated"}')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return
  }
  let resource
  try { resource = decodeURIComponent(url.pathname) }
  catch { res.writeHead(400); res.end(); return }
  if (resource === '/') resource = '/index.html'
  if (resource.includes('\\') || resource.includes('\0')) {
    res.writeHead(400); res.end(); return
  }
  const pathname = path.resolve(dist, '.' + resource)
  if (!pathname.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return }
  let stat
  try { stat = fs.statSync(pathname) }
  catch { res.writeHead(404); res.end(); return }
  if (!stat.isFile()) { res.writeHead(404); res.end(); return }
  requests.staticServed++
  res.writeHead(200, {
    'Content-Type': mime[path.extname(pathname)] || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': resource === '/index.html' || resource === '/sw.js'
      ? 'no-store' : 'public, max-age=3600',
  })
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(pathname).pipe(res)
})

async function run() {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-b2-sw-'))
  const launch = () => chromium.launchPersistentContext(profileDir, {
    executablePath: executable, headless: true, viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'zh-CN',
    serviceWorkers: 'allow', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  let ctx = null
  try {
    ctx = await launch()
    let page = ctx.pages()[0] || await ctx.newPage()
    await page.goto(origin + '/#/app/files', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'visible' })
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      if (!reg.active) throw new Error('service worker not active')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller),
      null, { timeout: 25000 })
    await page.addScriptTag({
      content: '(function(){ var exports={};\n' + js + '\nwindow.xDriveOfflineTest=exports; })();',
    })
    const first = await page.evaluate(async () => {
      const storage = window.xDriveOfflineTest
      const owner = {
        origin: location.origin, userID: 81, username: 'p1b2-test',
        instanceID: '11111111-1111-4111-8111-111111111111',
      }
      await storage.xDrivePwaSetOfflineConsent(owner, true)
      const ok = await storage.xDrivePwaCaptureVisitedDirectory(owner, {
        id: 31, name: 'historical-metadata',
        totalCount: 100000,
        items: Array.from({ length: 100000 }, (_, i) => ({
          id: i + 1, name: 'historical-name-' + i, type: 'file',
          revision: 1, privateBearer: 'NEVER_CACHE', preview: 'PRIVATE_PIXEL',
        })),
      })
      if (!ok) throw new Error('unable to seed explicitly consented local snapshot')
      return { hasController: !!navigator.serviceWorker.controller,
        hasHint: !!await storage.xDrivePwaReadRelaunchOwner() }
    })
    assert(first.hasController && first.hasHint)
    await ctx.close(); ctx = null

    // Start a NEW browser process with the old Profile; server is now down.
    down = true
    ctx = await launch()
    page = ctx.pages()[0] || await ctx.newPage()
    await page.goto(origin + '/#/offline/files',
      { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('[data-xdrive-pwa-offline-browser]').waitFor({
      state: 'visible', timeout: 30000,
    })
    await page.locator('[data-xdrive-pwa-offline-item]').first().waitFor({ state: 'visible' })
    const offline = await page.evaluate(async () => {
      const cacheNames = await caches.keys()
      const paths = []
      for (const name of cacheNames) {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) paths.push(new URL(req.url).pathname)
      }
      return {
        pathname: location.hash,
        controller: !!navigator.serviceWorker.controller,
        items: document.querySelectorAll('[data-xdrive-pwa-offline-item]').length,
        verifiedButtonDisabled: !!document.querySelector('[data-xdrive-pwa-offline-verify]:disabled'),
        warning: document.querySelector('[data-xdrive-pwa-offline-historical]')?.textContent || '',
        privateAppAbsent: !document.querySelector('[data-xdrive-workspace-background]'),
        cacheNames, paths,
        fcp: performance.getEntriesByType('paint')
          .find(event => event.name === 'first-contentful-paint')?.startTime || null,
      }
    })
    assert.equal(offline.pathname, '#/offline/files')
    assert(offline.controller && offline.privateAppAbsent &&
      offline.warning.includes('历史摘要'))
    assert.equal(offline.items, 20)
    assert(offline.verifiedButtonDisabled)
    assert(offline.fcp > 0)
    assert(offline.paths.every(p => !p.startsWith('/api/')))
    assertXDrivePublicShellCache({ names: offline.cacheNames, paths: offline.paths })
    assert.equal(requests.apiRejected > 0, true,
      'initial public login shell must not falsely authenticate')
    console.log('PWA_P1B2_NATIVE_OFFLINE_UI ' + JSON.stringify({
      head: process.env.XD_PR_HEAD || null,
      browser: ctx.browser()?.version() || 'unknown',
      newProcessOffline: true, stored100kLogicalFirst20: offline.items,
      separateReadOnlyRoute: true, noAuthenticatedExplorer: offline.privateAppAbsent,
      noPrivateCache: true, controllerRestored: offline.controller,
      initialFcpMs: offline.fcp, pairedAfter: null, physicalIOS: false,
      networkDropped: requests.networkDropped, staticRequests: requests.staticServed,
    }))
  } finally {
    down = false
    if (ctx) await ctx.close().catch(() => {})
    fs.rmSync(profileDir, { recursive: true, force: true })
    await new Promise(resolve => server.close(resolve))
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
