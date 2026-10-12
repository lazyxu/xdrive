#!/usr/bin/env node
'use strict'

// P1-3c2a: actual Mobile/Wide Album Add from the mounted shared Gallery,
// authenticated Gin/PostgreSQL17; no fabricated /api/v1 responses.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([^=]+)=(.+)$/.exec(arg)
  assert(match, 'expected --key=value arguments')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'], 'private fixture path and artifact directory required')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.postgresql === true && fixture.real_gin === true &&
  fixture.intercepted_api === false && fixture.metadata_only === true &&
  fixture.expected_total === 10000, 'the genuine 10k Gallery fixture is required')
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url))
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, { recursive: true })
const root = path.resolve(__dirname, '../..')
const sha256 = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const result = {
  phase: 'P1-3c2a', realGin: true, postgresql17: true,
  metadataOnly: true, interceptedAPI: false, physicalIOS27: false,
  accepted: [], rejected: [], screenshots: [], unexpectedHTTP: [], pageErrors: [],
  expectedThumbnail503: 0, passed: false,
  sources: Object.fromEntries([
    'web/src/App.tsx', 'web/src/api.ts', 'web/src/mediaGalleryAdapter.ts',
    'ui/shared/src/mui/MediaGallery.tsx',
    'ui/shared/src/mui/MediaGallerySelectionToolbar.tsx',
  ].map(file => [file, sha256(file)])),
}
const check = (value, reason, details) =>
  assert(value, reason + (details === undefined ? '' : ': ' + JSON.stringify(details)))
const albumPath = album => '/api/v1/media/albums/' + encodeURIComponent(album.id) + '/items'
const sortIds = ids => [...ids].map(Number).sort((a, b) => a - b)
let browser
async function actualFetch(method, endpoint, body, token = fixture.token, headers = {}) {
  const response = await fetch(fixture.url + endpoint, {
    method, headers: {
      Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, headers: response.headers,
    json: response.status === 204 ? null : await response.json() }
}
async function createManualAlbum(name) {
  const result = await actualFetch('POST', '/api/v1/media/albums', { name })
  check(result.status === 201 && result.json?.id?.startsWith('manual:') &&
    result.json?.revision === 1 && result.json?.item_count === 0,
    'real Server creates one owner-scoped revision-1 empty manual album', { status: result.status, album: result.json })
  return result.json
}
async function screenshot(page, name) {
  const file = name + '.png'
  await page.screenshot({ path: path.join(output, file) })
  result.screenshots.push(file)
}
async function membership(album) {
  const response = await actualFetch('GET', albumPath(album) + '?limit=100&offset=0')
  check(response.status === 200, 'real album members must be readable', response.status)
  const items = Array.isArray(response.json) ? response.json : response.json?.items
  check(Array.isArray(items), 'Go album items must be actual media items')
  return sortIds(items.map(item => item.node.id))
}
async function reviewSelection(page) {
  const selection = page.locator('[data-xdrive-gallery-selection-toolbar]')
  await selection.waitFor()
  const count = (await selection.getByRole('status', { includeHidden: true }).textContent()).replace(/\s/g, '')
  check(count === '已选择2项', 'real toolbar must count two selected assets', count)
  await selection.getByRole('button', { name: '查看已选项', exact: true }).click()
  const review = page.getByRole('dialog', { name: /^已选择\s*2\s*项$/ })
  await review.waitFor()
  const ids = await review.locator('[data-xdrive-gallery-selected-item]').evaluateAll(rows =>
    rows.map(row => Number(row.getAttribute('data-xdrive-gallery-selected-item'))))
  check(ids.length === 2 && new Set(ids).size === 2 &&
    ids.every(id => Number.isSafeInteger(id) && id > 0),
    'the shared Review must contain two real distinct canonical Node IDs', ids)
  await review.getByRole('button', { name: '关闭已选项', exact: true }).click()
  await review.waitFor({ state: 'hidden' })
  return sortIds(ids)
}
async function chooseTwoTiles(page, width) {
  const mobile = width < 900
  const select = mobile
    ? page.locator('[data-xdrive-mobile-gallery-select]')
    : page.locator('[data-xdrive-gallery-toolbar]').getByRole('button', { name: '选择', exact: true })
  await select.waitFor()
  await select.click()
  const tiles = page.locator('[data-xdrive-media-tile]:visible')
  for (let i = 0; i < 2; i++) {
    const tile = tiles.nth(i)
    await tile.locator('input[type=checkbox]').click()
  }
  return reviewSelection(page)
}
async function addThroughRealGallery(page, surface, width, album) {
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 760 })
  await page.goto(fixture.url + '/#/app/gallery', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const tile = page.locator('[data-xdrive-media-tile]').first()
  await tile.waitFor({ state: 'visible' })
  const title = page.locator(mobile
    ? '[data-xdrive-mobile-app-header]'
    : '[data-xdrive-workspace-background] .MuiAppBar-root')
  const measured = await title.first().evaluate(el => el.getBoundingClientRect().height)
  check(mobile ? Math.abs(measured - 52) <= 1 : measured >= 48,
    'original responsive app header remains mounted', { surface, measured })
  const nodeIDs = await chooseTwoTiles(page, width)
  await screenshot(page, 'gallery-album-' + surface + '-selected')
  const expected = '/api/v1/media/albums/' + album.id + '/items'
  const promised = page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    decodeURIComponent(new URL(response.url()).pathname) === expected, { timeout: 30000 })
  const toolbar = page.locator('[data-xdrive-gallery-selection-toolbar]')
  if (mobile) {
    await toolbar.getByRole('button', { name: '更多已选项目操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '加入相册', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择手动相册', exact: true })
    await picker.waitFor()
    await picker.getByText(album.name, { exact: true }).click()
    check(await picker.getByRole('button', { name: '添加到相册', exact: true }).isEnabled(),
      'mobile selected album must enable real explicit confirm')
    await picker.getByRole('button', { name: '添加到相册', exact: true }).click()
  } else {
    await toolbar.getByRole('combobox', { name: '添加到相册', exact: true }).click()
    await page.getByRole('option', { name: album.name, exact: true }).click()
  }
  const response = await promised
  const request = response.request()
  const sent = request.postDataJSON()
  const quotedRevision = request.headers()['if-match']
  const updated = await response.json()
  const sample = { surface, width, nodeIDs, status: response.status(),
    albumID: album.id, requestedNodeIDs: sent.node_ids,
    ifMatch: quotedRevision, responseID: updated.id,
    revision: updated.revision, itemCount: updated.item_count,
    titleHeight: measured }
  check(response.status() === 200 &&
    quotedRevision === '"1"' &&
    JSON.stringify(sortIds(sent.node_ids)) === JSON.stringify(nodeIDs) &&
    updated.id === album.id && updated.revision === 2 && updated.item_count === 2,
    'real Gallery UI must POST its exact selected Nodes with same If-Match contract', sample)
  await toolbar.waitFor({ state: 'hidden' })
  const persisted = await membership(album)
  check(JSON.stringify(persisted) === JSON.stringify(nodeIDs),
    'two UI-chosen assets must persist in real PhotoCollectionAsset membership', { surface, persisted, nodeIDs })
  result.accepted.push({ ...sample, persistedNodeIDs: persisted })
  await screenshot(page, 'gallery-album-' + surface + '-committed')
  return nodeIDs
}
async function main() {
  const mobileAlbum = await createManualAlbum('QA-Gallery-Mobile-375')
  const wideAlbum = await createManualAlbum('QA-Gallery-Wide-900')
  browser = await chromium.launch({
    headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
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
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.url) {
      result.unexpectedHTTP.push({ error: 'untrusted external origin' })
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => result.pageErrors.push(error.message))
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname
    if (response.status() === 503 &&
      /^\/api\/v1\/media\/items\/[1-9]\d*\/thumbnail$/.test(pathname)) {
      result.expectedThumbnail503 += 1 // intentionally absent source CAS bytes
      return
    }
    if (response.status() >= 500) {
      result.unexpectedHTTP.push({ status: response.status(),
        path: pathname, method: response.request().method() })
    }
  })
  const mobile = await addThroughRealGallery(page, 'mobile', 375, mobileAlbum)
  const wide = await addThroughRealGallery(page, 'wide', 900, wideAlbum)
  check(mobile.length === 2 && wide.length === 2 && result.accepted.length === 2,
    'both layout-native add flows must commit exactly once', result.accepted)

  // CAS revisions are authoritative: a stale same-owner mutation is a real 409.
  const stale = await actualFetch('POST', albumPath(mobileAlbum),
    { node_ids: mobile }, fixture.token, { 'If-Match': '"1"' })
  check(stale.status === 409, 'real stale album revision must reject mutation', { status: stale.status })
  result.rejected.push({ type: 'stale-owner', status: stale.status })
  // Foreign JWT can authenticate, but never mutate or list another owner's album.
  const foreign = await actualFetch('POST', albumPath(wideAlbum),
    { node_ids: wide }, fixture.foreign_token, { 'If-Match': '"2"' })
  check(foreign.status === 404, 'real cross-owner album write must be invisible', { status: foreign.status })
  result.rejected.push({ type: 'foreign-owner', status: foreign.status })
  check(JSON.stringify(await membership(mobileAlbum)) === JSON.stringify(mobile) &&
    JSON.stringify(await membership(wideAlbum)) === JSON.stringify(wide),
    'real 409 and 404 must preserve committed owner memberships')
  check(result.unexpectedHTTP.length === 0 && result.pageErrors.length === 0,
    'zero unexpected API 5xx or browser page exceptions required',
    { errors: result.unexpectedHTTP, pageErrors: result.pageErrors })
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
      check(stop.status === 204, 'real Gin fixture did not acknowledge completion')
    } catch (e) {
      result.pageErrors.push('private fixture shutdown failed: ' + String(e))
      process.exitCode = 1
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    console.log('IOS27_GALLERY_ALBUM_REAL_GO_RESULT ' + JSON.stringify({
      passed: result.passed, accepted: result.accepted.length,
      rejected: result.rejected, expectedThumbnail503: result.expectedThumbnail503,
      unexpectedErrors: result.unexpectedHTTP.length + result.pageErrors.length,
      failure: result.failure || null,
    }))
  }
})()
