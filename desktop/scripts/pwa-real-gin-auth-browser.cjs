#!/usr/bin/env node
'use strict'
// S2B3: actual production Web -> genuine Gin authenticated route + PostgreSQL17.
// No /api/v1 mocking, no token or browser profile in evidence. This is NOT
// physical iOS/Android PWA installation or a public TLS validation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(text => {
  const found = /^--(ready|output-dir)=(.+)$/.exec(text)
  assert(found, 'Expected --ready and --output-dir')
  return [found[1], found[2]]
}))
assert(args.ready && args['output-dir'])
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(ready.real_gin === true && ready.postgresql === true &&
  ready.local_cas === true && ready.intercepted_api === false)
assert(ready.physical_device === false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
assert(Number.isSafeInteger(ready.target_id) && ready.target_id > 0)
assert(ready.username === 'pwa-s2b3-owner')
const executable = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(executable && fs.existsSync(executable), 'Real system Chrome required')
const resultDir = path.resolve(args['output-dir'])
fs.mkdirSync(resultDir, { recursive: true })
const summary = {
  phase: 'PWA-S2B3',
  commit: process.env.XD_PR_HEAD || null,
  realGin: true, realPostgreSQL: true, realLocalCAS: true,
  interceptedApi: false, physicalDevice: false, systemInstalled: false,
  browserVersion: '', cases: [], passed: false, failures: [],
}
const targetPath = '/api/v1/nodes/' + ready.target_id
const deepLink = '#/app/files?dir=' + ready.target_id
const ownerPassword = 'PwaRealGin-TestOnly_2026!'
const foreignPassword = 'PwaRealGin-Foreign_2026!'

async function verifyCase(browser, mobile) {
  const name = mobile ? 'Android-UA-touch-390' : 'desktop-Chrome-1280'
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: mobile, hasTouch: mobile, serviceWorkers: 'allow', locale: 'zh-CN',
    ...(mobile ? {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
    } : {}),
  })
  const sample = {
    name, browserMode: 'browser', loginSucceeded: false,
    ownerDirectory200: false, coldReload200: false, newTabRoute200: false,
    crossOwner404: false, invalidToken401: false, publicOnlyWorkerCache: false,
    deepLinkPreserved: false,
    galleryDeepLinkMounted: false, galleryColdReloadMounted: false, galleryHistoryRestored: false,
  }
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(25000)
    const errors = []
    page.on('pageerror', error => errors.push(error.name))
    await page.goto(ready.url + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await page.locator('#web-login-username').waitFor()
    assert.equal(new URL(page.url()).hash, deepLink)
    assert(await page.evaluate(() => window.isSecureContext))
    assert(await page.evaluate(() => matchMedia('(display-mode: browser)').matches))
    const unauthorized = await context.request.get(ready.url + targetPath)
    assert.equal(unauthorized.status(), 401)
    sample.invalidToken401 = true

    // The login form invokes production XDriveApi.login, and the Go server
    // validates the real password hash and issues an actual short-lived JWT.
    const firstRead = page.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === targetPath &&
      response.status() === 200)
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill(ownerPassword)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await firstRead
    assert.equal(new URL(page.url()).hash, deepLink)
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'detached' })
    sample.loginSucceeded = true
    sample.ownerDirectory200 = true

    // A fresh network HTTP GET on real reload proves this is not just URL
    // retention or a pre-populated localStorage mock.
    const afterReload = page.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === targetPath &&
      response.status() === 200)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await afterReload
    assert.equal(new URL(page.url()).hash, deepLink)
    sample.coldReload200 = true

    const secondTab = await context.newPage()
    const coldRead = secondTab.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === targetPath &&
      response.status() === 200)
    await secondTab.goto(ready.url + '/' + deepLink, { waitUntil: 'domcontentloaded' })
    await coldRead
    assert.equal(new URL(secondTab.url()).hash, deepLink)
    assert.equal(await secondTab.locator('#web-login-username').count(), 0)
    sample.newTabRoute200 = true
    sample.deepLinkPreserved = true

    // S2B5: real authenticated Chrome tab mounts the shared Web/Mobile Gallery.
    // This covers hash restoration and history, not media decode or OS installation.
    const galleryRoute = '#/app/gallery?section=albums'
    const galleryTab = await context.newPage()
    const galleryErrors = []
    galleryTab.on('pageerror', error => galleryErrors.push(error.name))
    await galleryTab.goto(ready.url + '/' + galleryRoute, { waitUntil: 'domcontentloaded' })
    await galleryTab.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'attached' })
    assert.equal(new URL(galleryTab.url()).hash, galleryRoute)
    assert.equal(await galleryTab.locator('#web-login-username').count(), 0)
    sample.galleryDeepLinkMounted = true

    await galleryTab.reload({ waitUntil: 'domcontentloaded' })
    await galleryTab.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'attached' })
    assert.equal(new URL(galleryTab.url()).hash, galleryRoute)
    assert.equal(await galleryTab.locator('#web-login-username').count(), 0)
    sample.galleryColdReloadMounted = true

    // Browser-generated history must unmount/remount the actual Gallery input.
    // The Files transition must still read its owner-scoped Node from real Gin.
    const historyFileRead = galleryTab.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === targetPath &&
      response.status() === 200)
    await galleryTab.evaluate(hash => { window.location.hash = hash }, deepLink)
    await historyFileRead
    await galleryTab.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'detached' })
    assert.equal(new URL(galleryTab.url()).hash, deepLink)
    await galleryTab.evaluate(() => window.history.back())
    await galleryTab.waitForFunction(expected => window.location.hash === expected, galleryRoute)
    await galleryTab.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'attached' })
    await galleryTab.evaluate(() => window.history.forward())
    await galleryTab.waitForFunction(expected => window.location.hash === expected, deepLink)
    await galleryTab.locator('[data-xdrive-gallery-upload-picker]').waitFor({ state: 'detached' })
    assert.deepEqual(galleryErrors, [])
    sample.galleryHistoryRestored = true

    // Sign in separately as another real PostgreSQL user. A JWT may be
    // consumed only by the Go Server. Never print or persist its bytes.
    const foreignLogin = await context.request.post(ready.url + '/api/v1/auth/login', {
      data: { username: ready.foreign_username, password: foreignPassword },
    })
    assert.equal(foreignLogin.status(), 200)
    const foreignAuth = await foreignLogin.json()
    assert(typeof foreignAuth.access_token === 'string' && foreignAuth.access_token.length > 16)
    const forbidden = await context.request.get(ready.url + targetPath, {
      headers: { Authorization: 'Bearer ' + foreignAuth.access_token },
    })
    assert.equal(forbidden.status(), 404)
    sample.crossOwner404 = true

    const cache = await page.evaluate(async () => {
      const names = await caches.keys()
      const files = []
      for (const name of names) {
        const store = await caches.open(name)
        for (const request of await store.keys()) files.push(new URL(request.url).pathname)
      }
      return { names, files }
    })
    assert.deepEqual(cache.names, ['xdrive-pwa-public-offline-v1'])
    assert.deepEqual(cache.files, ['/offline.html'])
    sample.publicOnlyWorkerCache = true
    assert.deepEqual(errors, [], 'production Chrome JavaScript errors are not allowed')
    summary.cases.push(sample)
  } finally {
    await context.close()
  }
}
async function main() {
  let browser
  try {
    browser = await chromium.launch({
      executablePath: executable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    summary.browserVersion = browser.version()
    await verifyCase(browser, false)
    await verifyCase(browser, true)
    assert.equal(summary.cases.length, 2)
    assert(summary.cases.every(x =>
      x.loginSucceeded && x.ownerDirectory200 && x.coldReload200 &&
      x.newTabRoute200 && x.crossOwner404 && x.invalidToken401 &&
      x.publicOnlyWorkerCache && x.deepLinkPreserved &&
      x.galleryDeepLinkMounted && x.galleryColdReloadMounted && x.galleryHistoryRestored))
    const completed = await browser.newContext()
    try {
      const response = await completed.request.post(ready.url + '/__test/pwa-s2b3/finish')
      assert.equal(response.status(), 204)
    } finally { await completed.close() }
    summary.passed = true
  } catch (error) {
    summary.failures.push({ stage: 'real-auth-route', message: String(error.message || error).slice(0,800) })
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
    console.log('PWA_S2B3_REAL_GIN_CHROME ' + JSON.stringify(summary))
  }
}
main().catch(error => { console.error(error.name); process.exitCode = 1 })
