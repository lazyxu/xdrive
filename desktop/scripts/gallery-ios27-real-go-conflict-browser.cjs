#!/usr/bin/env node
'use strict'

// P1-3c2c: real Mobile/Wide Gallery optimistic-revision 409 + explicit retry.
// Genuine built Web -> Gin/PostgreSQL17, no mocked /api/v1 responses.
// Assets are metadata-only; do not infer real CAS decode or native iOS acceptance.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(text => {
  const match = /^--([^=]+)=(.+)$/.exec(text)
  assert(match, 'expected --key=value')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'], 'private fixture ready file and evidence path required')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.real_gin === true && fixture.postgresql === true &&
  fixture.intercepted_api === false && fixture.metadata_only === true &&
  fixture.expected_total === 10000, 'authentic 10k Go/PostgreSQL Gallery fixture required')
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url), 'isolated localhost fixture required')
const evidenceDir = path.resolve(args['output-dir'])
fs.mkdirSync(evidenceDir, { recursive: true })
const repoRoot = path.resolve(__dirname, '../..')
const sha256 = file => createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')
const result = {
  phase: 'P1-3c2c', realGin: true, postgresql17: true,
  interceptedAPI: false, metadataOnly: true, physicalIOS27: false,
  accepted: [], expectedCAS503: 0, httpErrors: [], pageErrors: [], screenshots: [],
  passed: false, sourceSHA256: Object.fromEntries([
    'web/src/App.tsx', 'web/src/api.ts', 'web/src/mediaGalleryAdapter.ts',
    'ui/shared/src/mui/MediaGallery.tsx',
    'ui/shared/src/mui/MediaGallerySelectionToolbar.tsx',
  ].map(file => [file, sha256(file)])),
}
let browser
const albumPath = album => '/api/v1/media/albums/' + encodeURIComponent(album.id)
const sorted = ids => [...ids].map(Number).sort((a, b) => a - b)
const check = (valid, message, details) =>
  assert(valid, message + (details === undefined ? '' : ': ' + JSON.stringify(details)))
async function actualFetch(method, endpoint, payload, token = fixture.token, extraHeaders = {}) {
  const response = await fetch(fixture.url + endpoint, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  return { status: response.status, headers: response.headers,
    body: response.status === 204 ? null : await response.json() }
}
async function screenshot(page, name) {
  const file = name + '.png'
  await page.screenshot({ path: path.join(evidenceDir, file) })
  result.screenshots.push(file)
}
async function membership(album) {
  const response = await actualFetch('GET', albumPath(album) + '/items?limit=100&offset=0')
  check(response.status === 200, 'actual album membership GET must succeed', response.status)
  const items = Array.isArray(response.body) ? response.body : response.body?.items
  check(Array.isArray(items), 'real album membership response must contain items')
  return sorted(items.map(item => item.node.id))
}
async function createManualAlbum(name) {
  const response = await actualFetch('POST', '/api/v1/media/albums', { name })
  check(response.status === 201 && response.body?.id?.startsWith('manual:') &&
    response.body?.revision === 1 && response.body?.item_count === 0,
    'real Go creates one empty revision1 manual album', response.body)
  return response.body
}
async function selectedNodeIDs(page, mobile) {
  const select = mobile
    ? page.locator('[data-xdrive-mobile-gallery-select]')
    : page.locator('[data-xdrive-gallery-toolbar]').getByRole('button', { name: '选择', exact: true })
  await select.waitFor()
  await select.click()
  const tiles = page.locator('[data-xdrive-media-tile]:visible')
  for (let i = 0; i < 2; i++) await tiles.nth(i).locator('input[type=checkbox]').click()
  const toolbar = page.locator('[data-xdrive-gallery-selection-toolbar]')
  await toolbar.waitFor()
  await toolbar.getByRole('button', { name: '查看已选项', exact: true }).click()
  const review = page.getByRole('dialog', { name: /^已选择\s*2\s*项$/ })
  await review.waitFor()
  const ids = await review.locator('[data-xdrive-gallery-selected-item]').evaluateAll(rows =>
    rows.map(row => Number(row.getAttribute('data-xdrive-gallery-selected-item'))))
  check(ids.length === 2 && new Set(ids).size === 2 &&
    ids.every(id => Number.isSafeInteger(id) && id > 0),
    'two distinct real canonical selection IDs required', ids)
  await review.getByRole('button', { name: '关闭已选项', exact: true }).click()
  await review.waitFor({ state: 'hidden' })
  return sorted(ids)
}
function postObserver(page, album) {
  const expected = decodeURIComponent(albumPath(album) + '/items')
  return page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    decodeURIComponent(new URL(response.url()).pathname) === expected,
    { timeout: 30000 })
}
function refreshedCatalogObserver(page) {
  return page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === '/api/v1/media/albums' &&
    response.status() === 200,
    { timeout: 30000 })
}
function inspectResponse(response, expectedStatus, expectedRevision, chosen) {
  const request = response.request()
  const sent = request.postDataJSON()
  const ids = sorted(sent.node_ids)
  const headers = request.headers()
  check(response.status() === expectedStatus &&
    headers['if-match'] === '"' + expectedRevision + '"' &&
    JSON.stringify(ids) === JSON.stringify(chosen),
    'actual gallery POST must send unchanged canonical selection and expected If-Match',
    { status: response.status(), ifMatch: headers['if-match'], ids, chosen })
  return { status: response.status(), ifMatch: headers['if-match'], ids }
}
async function processLayout(page, surface, album, seedNodeIDs) {
  const mobile = surface === 'mobile'
  const width = mobile ? 375 : 900
  await page.setViewportSize({ width, height: mobile ? 812 : 760 })
  await page.goto(fixture.url + '/#/app/gallery', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-xdrive-media-tile]').first().waitFor({ state: 'visible' })
  const title = page.locator(mobile
    ? '[data-xdrive-mobile-app-header]'
    : '[data-xdrive-workspace-background] .MuiAppBar-root')
  const titleHeight = await title.first().evaluate(el => el.getBoundingClientRect().height)
  check(mobile ? Math.abs(titleHeight - 52) <= 1 : titleHeight >= 48,
    '52px mobile App Frame or existing wide topbar must remain intact', { width, titleHeight })
  const chosen = await selectedNodeIDs(page, mobile)
  const seedNode = seedNodeIDs.find(id => !chosen.includes(id))
  check(Number.isSafeInteger(seedNode), 'precondition must pick different actual PhotoAsset Node from selection')
  const toolbar = page.locator('[data-xdrive-gallery-selection-toolbar]')
  await screenshot(page, 'real-conflict-' + surface + '-selected')

  let picker
  if (mobile) {
    await toolbar.getByRole('button', { name: '更多已选项目操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '加入相册', exact: true }).click()
    picker = page.getByRole('dialog', { name: '选择手动相册', exact: true })
    await picker.waitFor()
    await picker.getByText(album.name, { exact: true }).click()
  } else {
    // The album list is already loaded when the actual toolbar option appears.
    await toolbar.getByRole('combobox', { name: '添加到相册', exact: true }).waitFor()
  }

  // Simulate a DIFFERENT authorized writer, not browser interception. The
  // mounted Gallery still holds revision1, server now owns revision2.
  const concurrent = await actualFetch('POST', albumPath(album) + '/items',
    { node_ids: [seedNode] }, fixture.token, { 'If-Match': '"1"' })
  check(concurrent.status === 200 && concurrent.body?.revision === 2 &&
    concurrent.body?.item_count === 1,
    'real concurrent owner write must advance server Album to revision2', concurrent.body)
  check(JSON.stringify(await membership(album)) === JSON.stringify([seedNode]),
    'concurrent write must preserve a single disjoint member')

  const staleResponse = postObserver(page, album)
  // Attach the rejection handler immediately: a genuine missing refresh must
  // fail the acceptance assertion AND persist results.json, not crash Node as
  // an unhandled Playwright timeout before finally can archive evidence.
  const refreshResponse = refreshedCatalogObserver(page).then(
    value => ({ value, error: null }),
    error => ({ value: null, error: String(error) }),
  )
  if (mobile) {
    await picker.getByRole('button', { name: '添加到相册', exact: true }).click()
  } else {
    await toolbar.getByRole('combobox', { name: '添加到相册', exact: true }).click()
    await page.getByRole('option', { name: album.name, exact: true }).click()
  }
  const refused = await staleResponse
  const stale = inspectResponse(refused, 409, 1, chosen)
  // A passing retry requires server-authoritative fresh list, without a page
  // reload or unmounting the shared selected Node Map.
  const refreshState = await refreshResponse
  check(Boolean(refreshState.value),
    'authentic Gallery 409 MUST fetch the current manual Album revision before retry',
    refreshState.error)
  const refresh = refreshState.value
  const fetchedAlbums = await refresh.json()
  const fresh = fetchedAlbums.find(entry => entry.id === album.id)
  check(fresh?.revision === 2 && fresh?.item_count === 1,
    'real authenticated refresh must see changed album revision before retry', fresh)
  const selectionStatus = await toolbar.getByRole('status', { includeHidden: true }).textContent()
  check(selectionStatus.replace(/\s/g, '') === '已选择2项',
    'stale album rejection must keep user selection', selectionStatus)
  if (mobile) {
    await picker.getByText('1 项', { exact: true }).waitFor()
    await picker.getByRole('alert').getByText(/相册已更新/).waitFor()
    check(await picker.getByRole('button', { name: '添加到相册', exact: true }).isEnabled(),
      'mobile picker must remain open for deliberate explicit retry')
  } else {
    await page.getByText(/相册已更新/).first().waitFor()
  }
  check(JSON.stringify(await membership(album)) === JSON.stringify([seedNode]),
    '409 must leave actual Go membership unchanged', { surface, seedNode })
  await screenshot(page, 'real-conflict-' + surface + '-409-retained')

  const retryResponse = postObserver(page, album)
  if (mobile) {
    await picker.getByRole('button', { name: '添加到相册', exact: true }).click()
  } else {
    await toolbar.getByRole('combobox', { name: '添加到相册', exact: true }).click()
    await page.getByRole('option', { name: album.name, exact: true }).click()
  }
  const accepted = await retryResponse
  const retry = inspectResponse(accepted, 200, 2, chosen)
  const updated = await accepted.json()
  check(updated?.id === album.id && updated?.revision === 3 &&
    updated?.item_count === 3,
    'user re-confirmation must commit on fresh server revision', updated)
  await toolbar.waitFor({ state: 'hidden' })
  const persisted = await membership(album)
  check(JSON.stringify(persisted) === JSON.stringify(sorted([seedNode, ...chosen])),
    'real database must preserve concurrent member and exact two chosen IDs after retry',
    { chosen, seedNode, persisted })
  await screenshot(page, 'real-conflict-' + surface + '-retry-committed')
  result.accepted.push({ surface, width, chosen, stale, retry, seedNode,
    persisted, titleHeight, actualRefreshRevision: fresh.revision })
}
async function main() {
  const mobileAlbum = await createManualAlbum('P1-3c2c-Mobile-Revision-409')
  const wideAlbum = await createManualAlbum('P1-3c2c-Wide-Revision-409')
  const candidates = await actualFetch('GET',
    '/api/v1/media/items?range=true&limit=24&offset=0&sort_by=captured&sort_dir=asc&time_zone=UTC')
  check(candidates.status === 200 && candidates.body?.total_count === 10000 &&
    candidates.body?.items?.length >= 4, 'seed nodes from true Gin/Postgres logical media Range')
  const nodeIDs = candidates.body.items.map(entry => entry.node.id)
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
      result.httpErrors.push('unexpected external origin')
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(17000)
  page.on('pageerror', error => result.pageErrors.push(error.message))
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname
    if (fixture.metadata_only && response.status() === 503 &&
      /^\/api\/v1\/media\/items\/[1-9]\d*\/thumbnail$/.test(pathname)) {
      result.expectedCAS503 += 1
      return
    }
    if (response.status() >= 500) result.httpErrors.push({
      status: response.status(), method: response.request().method(), path: pathname,
    })
  })
  await processLayout(page, 'mobile', mobileAlbum, nodeIDs)
  await processLayout(page, 'wide', wideAlbum, nodeIDs)
  check(result.accepted.length === 2, 'both real responsive Gallery layouts recover from 409')
  check(result.httpErrors.length === 0 && result.pageErrors.length === 0,
    'zero unexpected HTTP 5xx or uncaught browser errors',
    { httpErrors: result.httpErrors, pageErrors: result.pageErrors })
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
      const done = await fetch(fixture.url + '/__test/gallery/finish', { method: 'POST' })
      check(done.status === 204, 'real Go fixture must acknowledge shutdown')
    } catch (error) {
      result.pageErrors.push('private fixture completion failed: ' + String(error))
      process.exitCode = 1
    }
    fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    console.log('IOS27_GALLERY_ALBUM_CONFLICT_REAL_GO_RESULT ' + JSON.stringify({
      passed: result.passed, actualLayoutSuccess: result.accepted.length,
      unexpectedErrors: result.httpErrors.length + result.pageErrors.length,
      expectedCAS503: result.expectedCAS503,
      failure: result.failure || null,
    }))
  }
})()
