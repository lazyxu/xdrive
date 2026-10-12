#!/usr/bin/env node
'use strict'
// S2B1: real production Web + Chromium secure-loopback PWA inspection.
// Browser tab and emulated mobile are NOT proof of installed iOS/Android apps.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const root = path.resolve(__dirname, '../..')
const dist = path.join(root, 'web/dist')
const output = path.resolve(process.env.XD_PWA_S2B_RESULT_DIR || path.join(root, 'desktop/pwa-s2b1-results'))
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'Real Chromium/Chrome executable is required')
assert(fs.existsSync(path.join(dist, 'index.html')), 'Build the production Web bundle first')
fs.mkdirSync(output, { recursive: true })

const authMode = process.env.XD_PWA_S2B_AUTH === '1'
const evidence = {
  kind: authMode ? 'S2B2 real Chromium authenticated deep-link test (NOT OS-installed PWA)' : 'S2B1 real Chromium production-shell test (NOT OS-installed PWA)',
  commit: process.env.XD_PR_HEAD || null,
  browserVersion: '',
  cases: [], failures: [], publicOnly: !authMode, physicalDevice: false,
}
const observed = { readyz: 0, headManifest: 0, headWorker: 0, privateApi: 0, credentialLeaks: 0, transportDrops: 0, privateTransportDrops: 0, authLogin: 0, authFileReads: 0, authUnknown: 0, unauthorized: 0, authUnknownRoutes: [], authRecentTouches: [] }
let networkTransportDown = false
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp',
}
function json(res, status, value, method) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(method === 'HEAD' ? undefined : JSON.stringify(value))
}
// Strict, isolated authenticated fixture for the optional S2B2 test only.
// Only dummy credentials are accepted, no real accounts or file bytes.
function handleAuthFixture(req, res, pathname) {
  if (!authMode || !pathname.startsWith('/api/')) return false
  const key = req.method + ' ' + pathname
  if (key === 'POST /api/v1/auth/login') {
    let input = ''
    req.on('data', chunk => { input += chunk; if (input.length > 8192) req.destroy() })
    req.on('end', () => {
      let fields
      try { fields = JSON.parse(input) } catch { json(res, 400, { error: 'invalid JSON' }, 'POST'); return }
      if (fields.username !== 'qa-pwa' || fields.password !== 'PwaFixture-Only_2026') {
        json(res, 401, { error: 'invalid fixture login' }, 'POST')
        return
      }
      observed.authLogin++
      json(res, 200, {
        token: 'fixture-browser-only-token', access_token: 'fixture-browser-only-token',
        refresh_token: 'fixture-browser-only-refresh', token_type: 'Bearer',
        expires_in: 3600, refresh_expires_in: 7200, username: 'qa-pwa',
        role: 'user', must_change_password: false,
      }, 'POST')
    })
    return true
  }
  if (key === 'GET /api/v1/version' || key === 'GET /api/v1/readyz') return false
  if (req.headers.authorization !== 'Bearer fixture-browser-only-token') {
    observed.unauthorized++
    json(res, 401, { error: 'fixture authorization required' }, req.method)
    return true
  }
  const stamp = '2026-10-12T00:00:00Z'
  const rootNode = { id: 1, name: '我的文件', type: 'dir', size: 0, revision: 1, created_at: stamp, updated_at: stamp }
  const target = { id: 42, name: 'S2B2目标文件夹', parent_id: 1, type: 'dir', size: 0, revision: 1, created_at: stamp, updated_at: stamp }
  // Only the existing Files recent-touch mutation is allowed here.
  // Every other request must still match the explicit fixture allowlist.
  if (key === 'POST /api/v1/file-recent/42' || key === 'POST /api/v1/file-recent/1') {
    const id = pathname.endsWith('/42') ? 42 : 1
    observed.authRecentTouches.push(id)
    json(res, 200, { node: id === 42 ? target : rootNode,
      path: id === 42 ? '我的文件/S2B2目标文件夹' : '我的文件',
      crumbs: id === 42 ? [rootNode, target] : [rootNode],
      accessed_at: stamp }, req.method)
    return true
  }
  const page = items => ({ items, total_count: items.length, total_count_included: true,
    offset: 0, limit: 200, sort: 'name', order: 'asc' })
  const data = {
    'GET /api/v1/me': { id: 101, username: 'qa-pwa', role: 'user', must_change_password: false },
    'GET /api/v1/sources': [],
    'GET /api/v1/file-recent': [],
    'GET /api/v1/me/quota': { quota_bytes: 10737418240, physical_used_bytes: 0,
      reserved_bytes: 0, available_bytes: 10737418240, logical_file_bytes: 0,
      trash_bytes: 0, history_bytes: 0, over_quota: false },
    'GET /api/v1/nodes/root': rootNode,
    'GET /api/v1/nodes/1': rootNode,
    'GET /api/v1/nodes/42': target,
    'GET /api/v1/nodes/1/children': page([target]),
    'GET /api/v1/nodes/42/children': page([]),
    'GET /api/v1/file-operations': [],
    'GET /api/v1/background-tasks/active-summary': { active_total: 0, file_operation: 0,
      sync_run: 0, archive_prepare: 0, scheduler: 0 },
    'GET /api/v1/background-tasks/page': { current_items: [], history_items: [], next_cursor: '' },
    'GET /api/v1/file-quick-access': [],
    'GET /api/v1/file-favorites': [],
    'GET /api/v1/file-tags': [],
    'GET /api/v1/file-saved-searches': [],
    'GET /api/v1/changes': { changes: [], next_cursor: 1, latest_cursor: 1,
      has_more: false, reset_required: false },
  }
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    if (pathname === '/api/v1/nodes/42' || pathname === '/api/v1/nodes/42/children') observed.authFileReads++
    json(res, 200, data[key], req.method)
    return true
  }
  observed.authUnknown++
  // Only fixed fixture-local method + route are recorded; never query or JWT.
  if (observed.authUnknownRoutes.length < 20) observed.authUnknownRoutes.push(key)
  json(res, 501, { error: 'Unexpected S2B2 API route' }, req.method)
  return true
}

const server = http.createServer((req, res) => {
  let uri
  try { uri = new URL(req.url, 'http://localhost') }
  catch { res.writeHead(400); res.end(); return }
  const pathname = uri.pathname
  // A real abrupt HTTP transport failure is more reliable than CDP's
  // browser-emulated offline toggle for worker-owned fetch() requests.
  if (networkTransportDown && (pathname === '/' || pathname === '/index.html' || pathname.startsWith('/api/'))) {
    observed.transportDrops++
    if (pathname.startsWith('/api/')) observed.privateTransportDrops++
    res.destroy()
    return
  }
  if (['/sw.js', '/site.webmanifest', '/offline.html', '/api/v1/readyz'].includes(pathname) && (req.headers.authorization || req.headers.cookie)) observed.credentialLeaks++
  if (pathname === '/api/v1/version' && req.method === 'GET') {
    json(res, 200, { version: 'pwa-s2b1-public-fixture', channel: 'CI', commit: 'fixture', build_time: '2026-10-12T00:00:00Z' }, req.method)
    return
  }
  if (pathname === '/api/v1/readyz' && req.method === 'GET') {
    observed.readyz++
    json(res, 200, { ok: true }, req.method)
    return
  }
  if (handleAuthFixture(req, res, pathname)) return
  if (pathname.startsWith('/api/')) {
    observed.privateApi++
    json(res, 404, { error: 'No authenticated Server API in S2B1 public fixture' }, req.method)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return
  }
  if (pathname === '/site.webmanifest' && req.method === 'HEAD') observed.headManifest++
  if (pathname === '/sw.js' && req.method === 'HEAD') observed.headWorker++
  const requested = pathname === '/' ? '/index.html' : pathname
  let decoded
  try { decoded = decodeURIComponent(requested) }
  catch { res.writeHead(400); res.end(); return }
  const file = path.resolve(dist, '.' + decoded)
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return
  }
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  const reloadable = ['/site.webmanifest', '/sw.js', '/offline.html'].includes(pathname)
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': reloadable ? 'no-cache, must-revalidate' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file))
})
const expectedHash = '#/app/files?dir=42'
async function validateCase(browser, origin, spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    isMobile: spec.mobile, hasTouch: spec.mobile, serviceWorkers: 'allow',
    locale: 'zh-CN',
    ...(spec.mobile ? {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
    } : {}),
  })
  const result = { mode: spec.name, viewport: spec.width + 'x' + spec.height,
    secureContext: false, browserMode: '', workerControlled: false,
    installAssets: false, offlineNavigation: false, privateBypass: false,
    deepLinkPreserved: false, cachedPublicOnly: false, readinessNoCredentials: false,
    authenticatedDeepLink: false, authenticatedColdReload: false }
  let page
  try {
    page = await context.newPage()
    page.setDefaultTimeout(18000)
    page.on('pageerror', error => evidence.failures.push({ mode: spec.name, type: 'pageerror', message: error.message }))
    const first = await page.goto(origin + '/' + expectedHash, { waitUntil: 'load' })
    assert.equal(first?.status(), 200, 'production SPA entry must be served from built assets')
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 20000 })
    const info = await page.evaluate(() => ({
      secure: window.isSecureContext,
      controlled: Boolean(navigator.serviceWorker.controller),
      scope: navigator.serviceWorker.controller?.scriptURL,
      browser: window.matchMedia('(display-mode: browser)').matches,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      manifest: new URL(document.querySelector('link[rel=manifest]').href).pathname,
      hash: window.location.hash,
    }))
    result.secureContext = info.secure
    result.workerControlled = info.controlled && info.scope?.endsWith('/sw.js')
    result.browserMode = info.browser && !info.standalone ? 'browser' : 'unexpected'
    assert(result.secureContext && result.workerControlled && result.browserMode === 'browser')
    assert.equal(info.manifest, '/site.webmanifest')
    assert.equal(info.hash, expectedHash)

    const manifestResponse = await context.request.get(origin + '/site.webmanifest')
    assert.equal(manifestResponse.status(), 200)
    assert.match(manifestResponse.headers()['content-type'], /^application\/manifest\+json/)
    const manifest = await manifestResponse.json()
    assert.equal(manifest.id, '/')
    assert.equal(manifest.scope, '/')
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.display, 'standalone')
    for (const icon of manifest.icons) {
      const response = await context.request.get(origin + icon.src)
      assert.equal(response.status(), 200, 'install icon must be a real deployed file')
      assert.match(response.headers()['content-type'], /^image\/png/)
      assert((await response.body()).length > 64)
    }
    result.installAssets = true

    await page.locator('[data-xdrive-pwa-login-entry]').click()
    const dialog = page.locator('[data-xdrive-pwa-install-dialog]')
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /安全上下文：是/)
    assert.match(await dialog.innerText(), /当前显示模式：browser/)
    if (spec.mobile) assert.match(await dialog.innerText(), /Android：/)
    await dialog.locator('[data-xdrive-pwa-check]').click()
    await dialog.getByText('响应类型正确，声明了重新验证缓存。', { exact: true }).first().waitFor()
    assert((await dialog.getByText('响应类型正确，声明了重新验证缓存。', { exact: true }).count()) >= 2)
    const readyBefore = observed.readyz
    await dialog.locator('[data-xdrive-pwa-check-server]').click()
    await dialog.getByText(/xDrive Server 当前报告已就绪/).waitFor()
    assert.equal(observed.readyz, readyBefore + 1)
    result.readinessNoCredentials = observed.credentialLeaks === 0
    assert(result.readinessNoCredentials)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    assert.equal(new URL(page.url()).hash, expectedHash)

    const cache = await page.evaluate(async () => {
      const names = await caches.keys()
      const resources = []
      for (const name of names) {
        const value = await caches.open(name)
        for (const request of await value.keys()) resources.push(new URL(request.url).pathname)
      }
      return { names, resources }
    })
    assert.deepEqual(cache.names, ['xdrive-pwa-public-offline-v1'])
    assert.deepEqual(cache.resources, ['/offline.html'])
    result.cachedPublicOnly = true

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor()
    assert.equal(new URL(page.url()).hash, expectedHash)
    networkTransportDown = true
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '暂时无法连接 xDrive' }).waitFor()
    assert.equal(new URL(page.url()).hash, expectedHash)
    result.offlineNavigation = true

    // This route MUST NOT receive the public SPA offline fallback.
    const privateTab = await context.newPage()
    let privateHtml = ''
    try {
      await privateTab.goto(origin + '/api/v1/files/1/download-ticket', {
        waitUntil: 'domcontentloaded', timeout: 10000,
      })
      privateHtml = await privateTab.content()
    } catch {
      // A network failure on an offline private URL is expected.
    } finally {
      await privateTab.close()
    }
    assert(!privateHtml.includes('暂时无法连接 xDrive'))
    assert(observed.privateTransportDrops > 0, 'private navigation must attempt uncached network transport')
    result.privateBypass = true

    networkTransportDown = false
    // Navigating to the identical hash can remain in the already-open offline
    // document. A REAL reload is required to exercise network recovery.
    const restoredResponse = await context.request.get(origin + '/')
    assert.equal(restoredResponse.status(), 200, 'loopback production server must be restored')
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor()
    result.deepLinkPreserved = new URL(page.url()).hash === expectedHash
    assert(result.deepLinkPreserved)
    if (authMode) {
      // Real React login, not pre-seeded token storage.
      const readsBefore = observed.authFileReads
      await page.locator('#web-login-username').fill('qa-pwa')
      await page.locator('#web-login-password').fill('PwaFixture-Only_2026')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'detached' })
      const until = async (predicate, label) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (predicate()) return
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw new Error('Timed out waiting for ' + label)
      }
      await until(() => observed.authFileReads > readsBefore, 'authenticated Files Node 42 request')
      assert.equal(new URL(page.url()).hash, expectedHash, 'login must preserve initial Files deep link')
      const authState = await page.evaluate(() => ({
        access: localStorage.getItem('xdrive.access_token'), hash: location.hash,
      }))
      assert.equal(authState.access, 'fixture-browser-only-token')
      assert.equal(authState.hash, expectedHash)
      result.authenticatedDeepLink = true

      const afterLoginReads = observed.authFileReads
      await page.reload({ waitUntil: 'load' })
      await until(() => observed.authFileReads > afterLoginReads, 'Files Node 42 after cold reload')
      assert.equal(new URL(page.url()).hash, expectedHash)
      assert.equal(await page.locator('[data-xdrive-pwa-login-entry]').count(), 0)
      const cacheAfterLogin = await page.evaluate(async () => {
        const names = await caches.keys()
        const paths = []
        for (const name of names) {
          const found = await caches.open(name)
          for (const request of await found.keys()) paths.push(new URL(request.url).pathname)
        }
        return { names, paths }
      })
      assert.deepEqual(cacheAfterLogin.names, ['xdrive-pwa-public-offline-v1'])
      assert.deepEqual(cacheAfterLogin.paths, ['/offline.html'])
      assert.equal(observed.authUnknown, 0,
        'authorized Files must use the documented API: ' + observed.authUnknownRoutes.join(', '))
      result.authenticatedColdReload = true
    }
    evidence.cases.push(result)
  } finally {
    networkTransportDown = false
    await context.close()
  }
}

async function main() {
  let browser
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    browser = await chromium.launch({
      executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    evidence.browserVersion = browser.version()
    await validateCase(browser, origin, { name: 'desktop-Chromium-browser', width: 1280, height: 800, mobile: false })
    await validateCase(browser, origin, { name: 'Android-UA-mobile-emulation', width: 390, height: 844, mobile: true })
    assert.equal(observed.credentialLeaks, 0)
    assert.equal(observed.headManifest, 2)
    assert.equal(observed.headWorker, 2)
    assert.equal(observed.readyz, 2)
    if (authMode) {
      assert.equal(observed.authLogin, 2)
      assert(observed.authFileReads >= 4)
      assert.equal(observed.authUnknown, 0)
      assert.equal(observed.unauthorized, 0)
    }
    assert(observed.transportDrops >= 4, 'both contexts must attempt offline root and private navigation')
    assert.equal(evidence.failures.length, 0)
    evidence.passed = true
  } catch (error) {
    evidence.passed = false
    evidence.failures.push({ type: 'test', message: error.message })
    process.exitCode = 1
  } finally {
    evidence.publicRequestSummary = observed
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n')
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    console.log('PWA_S2B1_PUBLIC_BROWSER_SUMMARY ' + JSON.stringify(evidence))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
