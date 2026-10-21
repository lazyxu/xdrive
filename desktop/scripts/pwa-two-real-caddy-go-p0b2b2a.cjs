#!/usr/bin/env node
'use strict'
// P0-B2b2a: genuine compiled Web X talking to another genuine Go/Gin version
// via a real Caddy process. This is NOT a long-running upload version-skew test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const readyPath = process.env.XD_PWA_B2B2_READY
const dist = process.env.XD_PWA_B2B2_WEB_DIST
const aDist = process.env.XD_PWA_B2B2_A_DIST
const bDist = process.env.XD_PWA_B2B2_B_DIST
const output = process.env.XD_PWA_B2B2_OUTPUT
const webSha = process.env.XD_PWA_B2B2_WEB_SHA
const goSha = process.env.XD_PWA_B2B2_GO_SHA
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert([readyPath, dist, aDist, bDist, output, webSha, goSha, chrome].every(Boolean),
  'P0-B2b2a requires explicit isolated fixture, dist, output, SHA and browser')
assert(/^[a-f0-9]{40}$/.test(webSha) && /^[a-f0-9]{40}$/.test(goSha),
  'real build source SHAs required')
assert.notEqual(webSha, goSha, 'must run mismatched real Web/Go source')
assert(fs.existsSync(chrome), 'system Chrome binary required')
const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'))
assert(ready.real_gin === true && ready.postgresql === true &&
  ready.local_cas === true && ready.intercepted_api === false &&
  ready.physical_device === false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url),
  'genuine local Caddy endpoint required')
assert(Number.isSafeInteger(ready.target_id) && ready.target_id > 0)
assert(Number.isSafeInteger(ready.media_node_id) && ready.media_node_id > 0)
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
function lazy(distDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, '.vite/manifest.json'), 'utf8'))
  const dynamic = Object.values(manifest).filter(v => v.isDynamicEntry &&
    /^assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.js$/.test(v.file || ''))
  assert(dynamic.length > 0, 'genuine production Vite dynamic chunk required')
  const selected = dynamic.sort((a, b) =>
    Number(/PwaInstallDialog/.test(b.file)) - Number(/PwaInstallDialog/.test(a.file)))[0].file
  const data = fs.readFileSync(path.join(distDir, selected))
  return { path: '/' + selected, sha256: hash(data), bytes: data.length }
}
const oldLazy = lazy(aDist)
const newLazy = lazy(bDist)
assert.notEqual(oldLazy.path, newLazy.path, 'two real Web builds must have distinct lazy paths')
const compiledWorker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')
const revision = compiledWorker.match(/^const SHELL_REVISION = '([a-f0-9]{20})'$/m)?.[1]
const urls = compiledWorker.match(/^const SHELL_URLS = (\[[^\n]+\])$/m)?.[1]
assert(revision && urls, 'real production SW revision and exact manifest required')
const expectedUrls = ['/offline.html', ...JSON.parse(urls)]
assert(expectedUrls.includes('/index.html'))
assert(!expectedUrls.includes(oldLazy.path) && !expectedUrls.includes(newLazy.path),
  'dynamic chunks must not be in mandatory offline shell')
const outputDir = path.resolve(output)
fs.mkdirSync(outputDir, { recursive: true })
const summary = {
  schema: 'xdrive-pwa-real-caddy-go-web-skew-b2b2a-v1', webSha, goSha,
  actualCaddyBinary: true, independentlyCompiledGoServer: true,
  actualPostgreSQL: true, actualLocalCAS: true, physicalIOS: false,
  runningUploadDuringUpgrade: false, versionSkewCases: [], passed: false
}

async function verify(context, mode) {
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.name))
  try {
    const anonymous = await context.request.get(ready.url + '/api/v1/nodes/root')
    assert.equal(anonymous.status(), 401, 'real Caddy /api must proxy Gin, not SPA')
    const html = await context.request.get(ready.url + '/index.html')
    assert.equal(html.status(), 200)
    assert.match(html.headers()['content-type'] || '', /^text\/html/)
    assert.match(html.headers()['cache-control'] || '', /no-cache/)
    const worker = await context.request.get(ready.url + '/sw.js')
    assert.equal(worker.status(), 200)
    assert.match(worker.headers()['cache-control'] || '', /no-cache/)
    const missing = await context.request.get(ready.url + '/assets/nonexistent-b2b2a-ffffffff.js')
    assert.equal(missing.status(), 404, 'genuine Caddy missing JS must not be index.html')
    assert.doesNotMatch(missing.headers()['content-type'] || '', /html/)
    for (const asset of [oldLazy, newLazy]) {
      const response = await context.request.get(ready.url + asset.path)
      assert.equal(response.status(), 200, 'Caddy archived both actual Web releases')
      assert.match(response.headers()['content-type'] || '', /javascript|ecmascript/)
      assert.match(response.headers()['cache-control'] || '', /immutable/)
      const bytes = await response.body()
      assert.equal(bytes.length, asset.bytes)
      assert.equal(hash(bytes), asset.sha256, 'Caddy served authentic immutable bytes')
    }

    const first = await page.goto(ready.url + '/#/app/files?dir=' + ready.target_id,
      { waitUntil: 'commit' })
    assert.equal(first?.status(), 200, 'actual public Web index response')
    await page.locator('#web-login-username').waitFor({ state: 'visible' })
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForFunction(() => {
      const token = localStorage.getItem('xdrive.access_token')
      return typeof token === 'string' && token.length > 16
    })
    const statuses = await page.evaluate(async ids => {
      const token = localStorage.getItem('xdrive.access_token')
      const opts = { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }
      const paths = [
        '/api/v1/nodes/root', '/api/v1/nodes/' + ids.target,
        '/api/v1/media/items/' + ids.media,
        '/api/v1/media/items?range=true&offset=0&limit=10',
        '/api/v1/version'
      ]
      return Promise.all(paths.map(async p => (await fetch(p, opts)).status))
    }, { target: ready.target_id, media: ready.media_node_id })
    assert.deepEqual(statuses, [200, 200, 200, 200, 200],
      'real mixed Web/Go auth, Files, Gallery and version contract')
    const foreignLogin = await context.request.post(ready.url + '/api/v1/auth/login', {
      data: { username: ready.foreign_username,
        password: 'PwaRealGin-Foreign_2026!' }
    })
    assert.equal(foreignLogin.status(), 200)
    const foreign = await foreignLogin.json()
    assert(typeof foreign.access_token === 'string' && foreign.access_token.length > 16)
    const foreignHeaders = { Authorization: 'Bearer ' + foreign.access_token }
    const foreignFile = await context.request.get(
      ready.url + '/api/v1/nodes/' + ready.target_id,
      { headers: foreignHeaders })
    const foreignMedia = await context.request.get(
      ready.url + '/api/v1/media/items/' + ready.media_node_id,
      { headers: foreignHeaders })
    assert.equal(foreignFile.status(), 404)
    assert.equal(foreignMedia.status(), 404)

    await page.evaluate(() => { window.location.hash = '#/app/gallery?section=albums' })
    await page.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'attached' })
    await page.evaluate(() => navigator.serviceWorker.ready)
    const reload = await page.reload({ waitUntil: 'commit' })
    assert.equal(reload?.status(), 200)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const cache = await page.evaluate(async () => {
      const names = await caches.keys()
      const paths = []
      for (const name of names) {
        const c = await caches.open(name)
        for (const request of await c.keys()) paths.push(new URL(request.url).pathname)
      }
      return { names, paths }
    })
    assert.deepEqual(cache.names.sort(),
      ['xdrive-pwa-public-offline-v1', 'xdrive-pwa-public-shell-' + revision].sort())
    assert.deepEqual(cache.paths.sort(), expectedUrls.sort(),
      'real Web PWA cache must contain exact public shell, never JWT or private data')
    assert.deepEqual(pageErrors, [], 'genuine cross-version Web JavaScript must not crash')
    return { mode, realCaddyHTTP: true, realLogin: true, ownerFiles200: true,
      ownerGallery200: true, serverVersion200: true, foreignOwner404: true,
      twoRealViteArchivesSHA256: true, missingJS404: true, noPrivateSWCache: true }
  } finally {
    await context.close()
  }
}

async function main() {
  let browser
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'allow',
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
      summary.versionSkewCases.push(await verify(context,
        mobile ? '390px-Chromium-emulation' : '1280px-real-Chromium'))
    }
    assert.equal(summary.versionSkewCases.length, 2)
    const completed = await browser.newContext()
    try {
      const response = await completed.request.post(
        ready.url + '/__test/pwa-s2b3/finish')
      assert.equal(response.status(), 204, 'real Gin fixture postflight must run')
    } finally { await completed.close() }
    summary.passed = true
    console.log('PWA_B2B2A_REAL_CADDY_GIN_PASS ' + webSha.slice(0, 8) +
      ' to ' + goSha.slice(0, 8))
  } catch (error) {
    // No headers, credentials, user data or HAR in CI logs or artifacts.
    summary.error = String(error?.message || error).slice(0, 450)
    console.error('PWA_B2B2A_REAL_CADDY_GIN_FAIL ' + summary.error)
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(outputDir, 'summary.json'),
      JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
  }
}
void main()
