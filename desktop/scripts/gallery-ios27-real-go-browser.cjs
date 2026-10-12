#!/usr/bin/env node
'use strict'

// P1-3c1: actual built Web Gallery -> real Gin/PostgreSQL17 at four widths.
// Metadata-only 10k PhotoAssets; this is not physical CAS or iOS Safari proof.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--([^=]+)=(.+)$/.exec(value)
  assert(match, 'expected --key=value arguments')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'], 'private ready path and output directory required')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.postgresql && fixture.real_gin && fixture.intercepted_api === false)
assert(fixture.metadata_only === true && fixture.expected_total === 10000)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url), 'real local Gin fixture required')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, { recursive: true })
const root = path.resolve(__dirname, '../..')
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const result = {
  phase: 'P1-3c1', actualGoServer: true, postgresql17: true,
  interceptedAPI: false, metadataOnly: true, physicalIOS27: false,
  logicalAssets: 10000, widths: [], foreignOwner: [], unexpectedHTTP: [],
  metadataOnlyThumbnail503: 0,
  pageErrors: [], screenshots: [], passed: false,
  sourceSHA256: Object.fromEntries([
    'web/src/App.tsx', 'web/src/mediaGalleryAdapter.ts',
    'ui/shared/src/mui/MediaGallery.tsx',
    'ui/shared/src/mui/MediaGalleryVirtualGrid.ts',
  ].map(file => [file, hash(file)])),
}
let browser
const outputFile = path.join(output, 'results.json')
const check = (ok, message, evidence) => {
  assert(ok, message + (evidence === undefined ? '' : ': ' + JSON.stringify(evidence)))
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png') })
  result.screenshots.push(name + '.png')
}

async function main() {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
    args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined,
  })
  result.browserVersion = browser.version()
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, hasTouch: true,
    isMobile: false, serviceWorkers: 'block', timezoneId: 'UTC',
  })
  await context.addInitScript(({ origin, token, username }) => {
    if (location.origin !== origin) return
    localStorage.setItem('xdrive.access_token', token)
    localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 3600000))
    localStorage.setItem('xdrive.username', username)
  }, { origin: fixture.url, token: fixture.token, username: fixture.username })
  // Block other hosts, but NEVER manufacture any /api/v1 response.
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.url) {
      result.unexpectedHTTP.push({ error: 'external-origin-request' })
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => result.pageErrors.push(error.message))
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname
    // The metadata-only seed does not persist original CAS bytes. Count only
    // this exact documented thumbnail-unavailable 503, never arbitrary API
    // 5xx or Range failure: the strict unexpected-error gate stays unchanged.
    if (fixture.metadata_only === true && response.status() === 503 &&
        /^\/api\/v1\/media\/items\/[1-9]\d*\/thumbnail$/.test(pathname)) {
      result.metadataOnlyThumbnail503 += 1
      return
    }
    if (response.status() >= 500) {
      result.unexpectedHTTP.push({
        status: response.status(), method: response.request().method(),
        path: pathname,
      })
    }
  })
  page.setDefaultTimeout(15000)

  for (const viewport of [
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 899, height: 700 }, { width: 900, height: 700 },
  ]) {
    const mobile = viewport.width < 900
    await page.setViewportSize(viewport)
    await page.goto(fixture.url + '/#/app/gallery', { waitUntil: 'domcontentloaded' })
    // Reopening the same SPA route may not re-query. Arm the actual server
    // response listener before a guaranteed reload, not after navigation.
    const listResponse = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/v1/media/items' &&
        response.request().method() === 'GET' &&
        url.searchParams.get('range') === 'true' && response.status() === 200
    }, { timeout: 30000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const response = await listResponse
    const pageData = await response.json()
    const requestURL = new URL(response.url())
    check(pageData.total_count === 10000 &&
      Array.isArray(pageData.items) &&
      pageData.items.length > 0 && pageData.items.length <= 128 &&
      Number.isInteger(pageData.offset) && pageData.offset >= 0,
      'actual Go must return the authorized sparse 10k Gallery range', {
        width: viewport.width, total: pageData.total_count,
        offset: pageData.offset, returned: pageData.items?.length,
      })
    check(pageData.items.every(item =>
      Number.isSafeInteger(item.node?.id) &&
      /^(photo-|video-|live-still-)/.test(item.node.name) &&
      item.node.revision === 1),
      'returned Gallery assets must have real PostgreSQL Node identities')
    check(response.headers()['cache-control'] === 'no-store',
      'real Gallery Range must be no-store')
    const tiles = page.locator('[data-xdrive-media-tile]')
    await tiles.first().waitFor({ state: 'visible' })
    const mounted = await tiles.count()
    const indexes = await tiles.evaluateAll(rows =>
      rows.map(row => Number(row.getAttribute('data-xdrive-media-index'))))
    check(mounted > 0 && mounted < 400 &&
      indexes.every(index => Number.isInteger(index) && index >= 0 && index < 10000),
      'shared virtual list must never mount 10k tiles in the browser',
      { width: viewport.width, mounted, firstIndexes: indexes.slice(0, 12) })
    const galleryHeaders = await page.locator('[data-xdrive-gallery-header]').count()
    const titlebar = page.locator(mobile
      ? '[data-xdrive-mobile-app-header]'
      : '[data-xdrive-workspace-background] .MuiAppBar-root')
    const headerHeight = await titlebar.first().evaluate(el => el.getBoundingClientRect().height)
    check(galleryHeaders === 1 &&
      (mobile ? Math.abs(headerHeight - 52) <= 1 : headerHeight >= 48),
      'one Gallery and the original 52px mobile App Header must be preserved',
      { width: viewport.width, galleryHeaders, headerHeight })
    result.widths.push({
      ...viewport, mobile, endpoint: requestURL.pathname,
      sortBy: requestURL.searchParams.get('sort_by') || 'captured',
      sortDir: requestURL.searchParams.get('sort_dir'),
      rangeLimit: pageData.limit, rangeOffset: pageData.offset,
      returned: pageData.items.length, total: pageData.total_count,
      firstNodeID: pageData.items[0].node.id, mountedTiles: mounted,
      headerHeight,
    })
    await screenshot(page, 'gallery-live-go-' + viewport.width)
  }
  check(result.widths.length === 4 &&
    new Set(result.widths.map(item => item.endpoint)).size === 1,
    'Mobile and wide Gallery must use exactly the same Go media Range endpoint')
  const ownerNodeID = result.widths[0].firstNodeID
  const denied = await page.evaluate(async ({ token, nodeID }) => {
    const headers = { Authorization: 'Bearer ' + token }
    const resp = await fetch('/api/v1/media/items?range=true&limit=100&offset=0&sort_by=captured&sort_dir=asc&time_zone=UTC', { headers })
    const body = await resp.json()
    const detail = await fetch('/api/v1/media/items/' + nodeID, { headers })
    const unauth = await fetch('/api/v1/media/items/' + nodeID, {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    return {
      rangeStatus: resp.status, total: body.total_count,
      items: body.items?.length, detailStatus: detail.status,
      unauthenticatedStatus: unauth.status,
    }
  }, { token: fixture.foreign_token, nodeID: ownerNodeID })
  check(denied.rangeStatus === 200 && denied.total === 0 && denied.items === 0 &&
    denied.detailStatus === 404 && denied.unauthenticatedStatus === 401,
    'real Gin cross-account media access must remain owner-isolated', denied)
  result.foreignOwner.push(denied)
  check(result.unexpectedHTTP.length === 0 && result.pageErrors.length === 0,
    'genuine browser and Go Server must not produce 5xx or uncaught exceptions',
    { http: result.unexpectedHTTP, js: result.pageErrors })
  result.passed = true
}

;(async () => {
  try {
    await main()
  } catch (error) {
    result.failure = error.stack || String(error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    try {
      const stop = await fetch(fixture.url + '/__test/gallery/finish', { method: 'POST' })
      check(stop.status === 204, 'Go fixture completion must be acknowledged')
    } catch (error) {
      result.pageErrors.push('private fixture completion failed: ' + String(error))
      process.exitCode = 1
    }
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n')
    console.log('IOS27_GALLERY_REAL_GO_RESULT ' + JSON.stringify({
      passed: result.passed, widths: result.widths.length, logicalAssets: result.logicalAssets,
      ownerFences: result.foreignOwner.length,
      expectedMetadataOnlyThumbnail503: result.metadataOnlyThumbnail503,
      unexpectedErrors: result.unexpectedHTTP.length + result.pageErrors.length,
      failure: result.failure || null,
    }))
  }
})()
