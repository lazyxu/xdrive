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
assert(Number.isSafeInteger(ready.media_node_id) && ready.media_node_id > 0)
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
// Secret share tokens are generated only by isolated real Gin during the run.
// Never include them in a test artifact, failure diagnostic or workflow log.
const privateShareTokens = new Set()
function redactedBrowserFailure(error) {
  let value = String(error?.message || error)
  for (const token of privateShareTokens) value = value.split(token).join('[redacted-share]')
  return value.replace(/#\/s\/[^\s"'<>]+/g, '#/s/[redacted-share]').slice(0, 800)
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
    mediaRange200: false, mediaViewer200: false, mediaViewerColdReload: false, mediaForeign404: false,
    publicShareAnonymous: false, publicShareWrongPassword: false,
    publicShareHistoryIsolation: false, publicShareRevoked: false,
    publicShareViewerReturn: false, publicSharePublicOnlyCache: false,
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

    // S2B6: read the actual owner-scoped sparse Gallery Range. Keep the
    // JWT only inside the authenticated page and return scalar evidence.
    const mediaRange = await galleryTab.evaluate(async expectedID => {
      const token = localStorage.getItem('xdrive.access_token')
      if (!token) return { status: 0, found: false, total: -1 }
      const response = await fetch('/api/v1/media/items?range=true&limit=10&offset=0', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      })
      const payload = response.ok ? await response.json() : null
      return {
        status: response.status,
        found: Boolean(payload?.items?.some(item => item.node?.id === expectedID)),
        total: Number(payload?.total_count ?? -1),
        noStore: /no-store/i.test(response.headers.get('Cache-Control') || ''),
      }
    }, ready.media_node_id)
    assert.equal(mediaRange.status, 200)
    assert.equal(mediaRange.found, true)
    assert(mediaRange.total >= 1)
    assert.equal(mediaRange.noStore, true)
    sample.mediaRange200 = true

    // Real Viewer cold launch + hard reload must issue actual Gin MediaItem
    // reads, not merely keep the URL or mount a loading-only frame.
    const viewerTab = await context.newPage()
    const viewerRoute = '#/app/media-viewer?node=' + ready.media_node_id
    const viewerItemPath = '/api/v1/media/items/' + ready.media_node_id
    const firstMediaRead = viewerTab.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === viewerItemPath &&
      response.status() === 200)
    await viewerTab.goto(ready.url + '/' + viewerRoute, { waitUntil: 'domcontentloaded' })
    await firstMediaRead
    await viewerTab.locator('[data-xdrive-web-viewer]').waitFor()
    await viewerTab.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
    assert.equal(new URL(viewerTab.url()).hash, viewerRoute)
    sample.mediaViewer200 = true

    const reloadMediaRead = viewerTab.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === viewerItemPath &&
      response.status() === 200)
    await viewerTab.reload({ waitUntil: 'domcontentloaded' })
    await reloadMediaRead
    await viewerTab.locator('[data-xdrive-web-viewer]').waitFor()
    await viewerTab.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
    assert.equal(new URL(viewerTab.url()).hash, viewerRoute)
    sample.mediaViewerColdReload = true

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
    const foreignMedia = await context.request.get(ready.url + '/api/v1/media/items/' + ready.media_node_id, {
      headers: { Authorization: 'Bearer ' + foreignAuth.access_token },
    })
    assert.equal(foreignMedia.status(), 404)
    sample.mediaForeign404 = true


    // S2B7: create ONLY synthetic, test-private links using the real owner's
    // live Gin JWT and the existing file-share API. Neither share capability
    // nor account JWT is ever placed in the ready file or summary.json.
    async function createS2B7Share(password) {
      const created = await page.evaluate(async ({ nodeID, password }) => {
        const ownerJWT = localStorage.getItem('xdrive.access_token')
        if (!ownerJWT) return { status: 0 }
        const response = await fetch('/api/v1/files/' + nodeID + '/shares', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + ownerJWT, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, max_downloads: 2 }),
          cache: 'no-store',
        })
        const data = response.ok ? await response.json() : null
        return { status: response.status, noStore: /no-store/i.test(response.headers.get('Cache-Control') || ''),
          id: data?.id, token: data?.token }
      }, { nodeID: ready.media_node_id, password })
      assert.equal(created.status, 201, 'Gin did not create synthetic share')
      assert.equal(created.noStore, true, 'share creation must never be cacheable')
      assert(Number.isSafeInteger(created.id) && created.id > 0, 'missing numeric share ID')
      assert(typeof created.token === 'string' && created.token.length >= 40, 'missing share token')
      privateShareTokens.add(created.token)
      return created
    }
    const firstShare = await createS2B7Share('Pwa-S2B7-private-only')
    const secondShare = await createS2B7Share('')

    // Isolated anonymous Chrome context: no JWT, cookies or owner storage.
    // The public metadata request must use only the share capability header.
    const anonymousContext = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'allow', locale: 'zh-CN',
      ...(mobile ? { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36' } : {}),
    })
    try {
      const anonymousPage = await anonymousContext.newPage()
      anonymousPage.setDefaultTimeout(25000)
      const anonymousErrors = []
      anonymousPage.on('pageerror', error => anonymousErrors.push(error.name))
      const metadataPath = '/api/v1/public/share'
      const firstMetadata = anonymousPage.waitForResponse(response =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === metadataPath && response.status() === 200)
      await anonymousPage.goto(ready.url + '/#/s/' + firstShare.token, { waitUntil: 'domcontentloaded' })
      const firstResponse = await firstMetadata
      const anonymousHeaders = await firstResponse.request().allHeaders()
      assert(!anonymousHeaders.authorization && !anonymousHeaders.cookie,
        'public metadata must not use account credentials')
      assert(anonymousHeaders['x-xdrive-share-token'] === firstShare.token,
        'public metadata must carry only the current share token')
      assert(/no-store/i.test(firstResponse.headers()['cache-control'] || ''),
        'public metadata must be no-store')
      await anonymousPage.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
      await anonymousPage.locator('input[type="password"]').waitFor()
      assert.equal(await anonymousPage.locator('#web-login-username').count(), 0)
      sample.publicShareAnonymous = true

      // Wrong password cannot issue a download ticket or consume the share.
      const badTicket = anonymousPage.waitForResponse(response =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/public/share/download-ticket' &&
        response.status() === 401)
      await anonymousPage.locator('input[type="password"]').fill('wrong-pwa-test-password')
      await anonymousPage.getByRole('button', { name: '下载', exact: true }).click()
      await badTicket
      await anonymousPage.getByText('分享密码错误。', { exact: true }).waitFor()
      const currentMeta = await anonymousPage.evaluate(async token => {
        const response = await fetch('/api/v1/public/share', {
          headers: { 'X-XDrive-Share-Token': token }, cache: 'no-store',
        })
        const data = response.ok ? await response.json() : null
        return { status: response.status, count: data?.download_count }
      }, firstShare.token)
      assert.equal(currentMeta.status, 200)
      assert.equal(currentMeta.count, 0)
      sample.publicShareWrongPassword = true

      // Without a page reload, switching to a DIFFERENT share removes the
      // password+error from the first. Browser Back reinstates its own empty
      // password form; Forward returns to the passwordless share.
      const secondMetadata = anonymousPage.waitForResponse(response =>
        new URL(response.url()).pathname === metadataPath && response.status() === 200)
      await anonymousPage.evaluate(token => { window.location.hash = '#/s/' + token }, secondShare.token)
      await secondMetadata
      await anonymousPage.locator('input[type="password"]').waitFor({ state: 'detached' })
      await anonymousPage.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
      assert.equal(await anonymousPage.getByText('分享密码错误。', { exact: true }).count(), 0)
      await anonymousPage.evaluate(() => window.history.back())
      await anonymousPage.locator('input[type="password"]').waitFor()
      assert.equal(await anonymousPage.locator('input[type="password"]').inputValue(), '')
      assert.equal(await anonymousPage.getByText('分享密码错误。', { exact: true }).count(), 0)
      await anonymousPage.evaluate(() => window.history.forward())
      await anonymousPage.locator('input[type="password"]').waitFor({ state: 'detached' })

      // Public share -> protected Files -> browser Back must show the same
      // anonymous public link without making its viewer/auth state persistent.
      await anonymousPage.evaluate(hash => { window.location.hash = hash }, deepLink)
      await anonymousPage.locator('#web-login-username').waitFor()
      await anonymousPage.evaluate(() => window.history.back())
      await anonymousPage.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
      assert.equal(await anonymousPage.locator('#web-login-username').count(), 0)
      sample.publicShareHistoryIsolation = true

      // Public SW cannot retain share metadata, token, file or any API byte.
      const cachePaths = await anonymousPage.evaluate(async () => {
        const paths = []
        for (const name of await caches.keys()) {
          const cache = await caches.open(name)
          for (const request of await cache.keys()) paths.push(new URL(request.url).pathname)
        }
        return paths.sort()
      })
      assert.deepEqual(cachePaths, ['/offline.html'])
      sample.publicSharePublicOnlyCache = true

      // Switching from a previously authenticated Viewer to a share and
      // browser Back must restore authorized Viewer without a document reload.
      const viewerMarker = 'xdrive-s2b7-document'
      await viewerTab.evaluate(marker => {
        document.documentElement.dataset.pwaS2b7Document = marker
      }, viewerMarker)
      const ownerShareMetadata = viewerTab.waitForResponse(response =>
        new URL(response.url()).pathname === metadataPath && response.status() === 200)
      await viewerTab.evaluate(token => { window.location.hash = '#/s/' + token }, secondShare.token)
      await ownerShareMetadata
      await viewerTab.locator('[data-xdrive-web-viewer]').waitFor({ state: 'detached' })
      await viewerTab.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()
      const returnedViewer = viewerTab.waitForResponse(response =>
        new URL(response.url()).pathname === viewerItemPath && response.status() === 200)
      await viewerTab.evaluate(() => window.history.back())
      await returnedViewer
      await viewerTab.locator('[data-xdrive-web-viewer]').waitFor()
      assert.equal(await viewerTab.evaluate(() => document.documentElement.dataset.pwaS2b7Document),
        viewerMarker, 'share/history traversal must not force reload')
      sample.publicShareViewerReturn = true

      // Owner-controlled revocation must invalidate anonymous fresh reload,
      // without retaining any previous metadata in the share UI or SW cache.
      const revokeStatus = await page.evaluate(async id => {
        const token = localStorage.getItem('xdrive.access_token')
        const response = await fetch('/api/v1/shares/' + id, {
          method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
        })
        return response.status
      }, secondShare.id)
      assert.equal(revokeStatus, 204)
      const goneMetadata = anonymousPage.waitForResponse(response =>
        new URL(response.url()).pathname === metadataPath && response.status() === 410)
      await anonymousPage.reload({ waitUntil: 'domcontentloaded' })
      await goneMetadata
      await anonymousPage.getByText('此分享已过期、达到下载上限或已被撤销。', { exact: true }).waitFor()
      assert.equal(await anonymousPage.getByText('pwa-s2b6-private.png', { exact: true }).count(), 0)
      assert.deepEqual(anonymousErrors, [])
      sample.publicShareRevoked = true
    } finally {
      await anonymousContext.close()
    }

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
      x.galleryDeepLinkMounted && x.galleryColdReloadMounted && x.galleryHistoryRestored &&
      x.mediaRange200 && x.mediaViewer200 && x.mediaViewerColdReload && x.mediaForeign404 &&
      x.publicShareAnonymous && x.publicShareWrongPassword && x.publicShareHistoryIsolation &&
      x.publicSharePublicOnlyCache && x.publicShareViewerReturn && x.publicShareRevoked))
    const completed = await browser.newContext()
    try {
      const response = await completed.request.post(ready.url + '/__test/pwa-s2b3/finish')
      assert.equal(response.status(), 204)
    } finally { await completed.close() }
    summary.passed = true
  } catch (error) {
    summary.failures.push({ stage: 'real-auth-route', message: redactedBrowserFailure(error) })
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
    console.log('PWA_S2B3_REAL_GIN_CHROME ' + JSON.stringify(summary))
  }
}
main().catch(error => { console.error(error.name); process.exitCode = 1 })
