#!/usr/bin/env node
'use strict'

// P1-3c2b: actual iOS27 Mobile/Wide Gallery manual album membership removal.
// Built production Web -> owner-scoped Gin/PostgreSQL17; no fake /api/v1.
// The 10k fixture has only projected metadata, not real CAS media bytes.
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
assert(args.ready && args['output-dir'], 'private ready path and output-dir required')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.postgresql === true && fixture.real_gin === true &&
  fixture.intercepted_api === false && fixture.metadata_only === true &&
  fixture.expected_total === 10000, 'real 10k Gallery Gin/Postgres fixture required')
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url), 'private loopback-only fixture')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, { recursive: true })
const root = path.resolve(__dirname, '../..')
const sha256 = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const results = {
  phase: 'P1-3c2b', realGin: true, postgresql17: true, interceptedAPI: false,
  logicalAssets: 10000, metadataOnly: true, physicalIOS27: false,
  removals: [], rejected: [], unexpectedHTTP: [], pageErrors: [],
  expectedMissingCAS503: 0, screenshots: [], passed: false,
  sources: Object.fromEntries([
    'web/src/App.tsx', 'web/src/api.ts', 'web/src/mediaGalleryAdapter.ts',
    'ui/shared/src/mui/MediaGallery.tsx',
    'ui/shared/src/mui/MediaGalleryDetails.tsx',
    'ui/shared/src/mui/MediaGalleryInspector.tsx',
    'ui/shared/src/mui/MobileGalleryCollections.tsx',
  ].map(file => [file, sha256(file)])),
}
let browser
const resultPath = path.join(output, 'results.json')
const check = (condition, name, evidence) =>
  assert(condition, name + (evidence === undefined ? '' : ': ' + JSON.stringify(evidence)))
const albumPath = album => '/api/v1/media/albums/' + encodeURIComponent(album.id)
const sorted = values => [...values].map(Number).sort((a, b) => a - b)

async function actualFetch(method, url, data, token = fixture.token, additional = {}) {
  const response = await fetch(fixture.url + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...additional,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  return {
    status: response.status, headers: response.headers,
    body: response.status === 204 ? null : await response.json(),
  }
}
async function persistedMembers(album) {
  const resp = await actualFetch('GET', albumPath(album) + '/items?limit=100&offset=0')
  check(resp.status === 200, 'real Server must return album membership', { albumID: album.id, status: resp.status })
  const items = Array.isArray(resp.body) ? resp.body : resp.body?.items
  check(Array.isArray(items), 'real album response must contain media items')
  return sorted(items.map(item => item.node.id))
}
async function makeAlbum(label, nodeIDs) {
  const created = await actualFetch('POST', '/api/v1/media/albums', { name: label })
  check(created.status === 201 && created.body?.id?.startsWith('manual:') &&
    created.body.revision === 1 && created.body.item_count === 0,
    'real Go must create manual album with revision1', created.body)
  const album = created.body
  const seeded = await actualFetch('POST', albumPath(album) + '/items',
    { node_ids: nodeIDs }, fixture.token, { 'If-Match': '"1"' })
  check(seeded.status === 200 && seeded.body.id === album.id &&
    seeded.body.revision === 2 && seeded.body.item_count === 2,
    'real Go must seed two durable manual memberships', seeded.body)
  check(JSON.stringify(await persistedMembers(album)) === JSON.stringify(sorted(nodeIDs)),
    'real PhotoCollectionAsset must contain precisely the two fixture items', nodeIDs)
  return { ...seeded.body, nodeIDs: sorted(nodeIDs) }
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png') })
  results.screenshots.push(name + '.png')
}
async function openAlbumByUI(page, surface, album) {
  const mobile = surface === 'mobile'
  const viewport = mobile ? { width: 375, height: 812 } : { width: 900, height: 760 }
  await page.setViewportSize(viewport)
  await page.goto(fixture.url + '/#/app/gallery', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (mobile) {
    await page.getByRole('tab', { name: '精选集', exact: true }).click()
    await page.locator('[data-xdrive-mobile-gallery-collection-card="album-' + album.id + '"]').click()
  } else {
    await page.locator('[data-xdrive-gallery-section="albums"]').click()
    await page.locator('[data-xdrive-gallery-album="' + album.id + '"]').click()
  }
  const tile = page.locator('[data-xdrive-media-tile]').first()
  await tile.waitFor({ state: 'visible' })
  const header = page.locator(mobile
    ? '[data-xdrive-mobile-app-header]'
    : '[data-xdrive-workspace-background] .MuiAppBar-root')
  const headerHeight = await header.first().evaluate(el => el.getBoundingClientRect().height)
  check(mobile ? Math.abs(headerHeight - 52) <= 1 : headerHeight >= 48,
    'retained 52px App Frame header and real wide topbar', { surface, headerHeight })
  check(await page.locator('[data-xdrive-media-tile]').count() === 2,
    'real opened manual album must expose two sparse virtual members', surface)
  await screenshot(page, 'real-gallery-' + surface + '-album-before')
  return { tile, headerHeight, viewport }
}
async function openActualProperties(page, tile, mobile) {
  await tile.scrollIntoViewIfNeeded()
  if (mobile) {
    // Exercise the Gallery's existing 450ms stationary touch long-hold,
    // rather than treating a desktop right click as a native mobile gesture.
    const point = await tile.evaluate(el => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    const pointer = { bubbles: true, cancelable: true, pointerId: 701,
      pointerType: 'touch', isPrimary: true, button: 0,
      clientX: point.x, clientY: point.y }
    await tile.dispatchEvent('pointerdown', pointer)
    await page.waitForTimeout(500)
    await tile.dispatchEvent('pointerup', pointer)
  } else {
    await tile.click({ button: 'right' })
  }
  const menu = page.locator('[data-xdrive-gallery-media-context-menu]')
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: '属性', exact: true }).click()
  const inspector = page.locator('[data-xdrive-media-details-drawer], [data-xdrive-media-inspector]').first()
  await inspector.waitFor()
  const remove = inspector.getByRole('button', { name: '从当前相册移除', exact: true })
  await remove.waitFor()
  return { inspector, remove }
}
async function removeInActualGallery(page, surface, album) {
  const mobile = surface === 'mobile'
  const { tile, headerHeight } = await openAlbumByUI(page, surface, album)
  const { inspector, remove } = await openActualProperties(page, tile, mobile)
  const removeHitHeight = await remove.evaluate(el => el.getBoundingClientRect().height)
  // iOS 27 touch affordance gate is separate from wide layout/keyboard.
  check(!mobile || removeHitHeight >= 43.9,
    'mobile Inspector Remove must have a stable >=44px touch target', { surface, removeHitHeight })
  await screenshot(page, 'real-gallery-' + surface + '-album-properties')
  const expectedPrefix = '/api/v1/media/albums/' + album.id + '/items/'
  const responsePromise = page.waitForResponse(resp =>
    resp.request().method() === 'DELETE' &&
    decodeURIComponent(new URL(resp.url()).pathname).startsWith(expectedPrefix), { timeout: 30000 })
  await remove.click()
  const response = await responsePromise
  const canonicalPath = decodeURIComponent(new URL(response.url()).pathname)
  const removedNodeID = Number(canonicalPath.slice(expectedPrefix.length))
  const actualHeader = response.request().headers()['if-match']
  const updated = await response.json()
  const sample = {
    surface, width: mobile ? 375 : 900, albumID: album.id, headerHeight, removeHitHeight,
    removedNodeID, ifMatch: actualHeader, status: response.status(),
    updatedRevision: updated.revision, updatedCount: updated.item_count,
  }
  check(response.status() === 200 && Number.isSafeInteger(removedNodeID) &&
    album.nodeIDs.includes(removedNodeID) && actualHeader === '"2"' &&
    updated.id === album.id && updated.revision === 3 && updated.item_count === 1,
    'shared Gallery Inspector must DELETE only one owned album membership with exact revision', sample)
  const remaining = await persistedMembers(album)
  check(remaining.length === 1 && remaining[0] === album.nodeIDs.find(id => id !== removedNodeID),
    'the persisted manual album now contains only its untouched second Node', { sample, remaining })
  const canonical = await actualFetch('GET', '/api/v1/media/items/' + removedNodeID)
  check(canonical.status === 200 && canonical.body?.node?.id === removedNodeID,
    'removing a membership must NOT delete/trash or change the original PhotoAsset', { surface, removedNodeID, status: canonical.status })
  results.removals.push({ ...sample, remainingIDs: remaining, originalStillReadable: true })
  await screenshot(page, 'real-gallery-' + surface + '-album-after')
  return { removedNodeID, remaining }
}

async function main() {
  const range = await actualFetch('GET', '/api/v1/media/items?range=true&limit=4&offset=0&sort_by=captured&sort_dir=asc&time_zone=UTC')
  check(range.status === 200 && range.body?.total_count === 10000 &&
    range.body?.items?.length === 4, 'real Go must supply four distinct logical Gallery assets')
  const nodeIDs = range.body.items.map(item => item.node.id)
  check(new Set(nodeIDs).size === 4, 'no synthetic duplicate Node IDs in setup', nodeIDs)
  const albumMobile = await makeAlbum('P1-3c2b Mobile remove', nodeIDs.slice(0, 2))
  const albumWide = await makeAlbum('P1-3c2b Wide remove', nodeIDs.slice(2, 4))
  browser = await chromium.launch({
    headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
    args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined,
  })
  results.browserVersion = browser.version()
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
      results.unexpectedHTTP.push('unexpected external origin')
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => results.pageErrors.push(error.message))
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname
    if (fixture.metadata_only && response.status() === 503 &&
      /^\/api\/v1\/media\/items\/[1-9]\d*\/thumbnail$/.test(pathname)) {
      results.expectedMissingCAS503 += 1
      return
    }
    if (response.status() >= 500) {
      results.unexpectedHTTP.push({ status: response.status(), path: pathname, method: response.request().method() })
    }
  })
  const mobile = await removeInActualGallery(page, 'mobile', albumMobile)
  const wide = await removeInActualGallery(page, 'wide', albumWide)
  check(results.removals.length === 2, 'both native Gallery UI layouts must remove exactly one album member')
  for (const [album, kept] of [
    [albumMobile, mobile.remaining[0]], [albumWide, wide.remaining[0]],
  ]) {
    // Stale same-owner revision must conflict, foreign owner's write hidden.
    const stale = await actualFetch('DELETE', albumPath(album) + '/items/' + kept,
      undefined, fixture.token, { 'If-Match': '"2"' })
    check(stale.status === 409, 'real Gin must reject stale revision', { albumID: album.id, status: stale.status })
    const foreign = await actualFetch('DELETE', albumPath(album) + '/items/' + kept,
      undefined, fixture.foreign_token, { 'If-Match': '"3"' })
    check(foreign.status === 404, 'real Gin must reject foreign membership mutation', { albumID: album.id, status: foreign.status })
    check(JSON.stringify(await persistedMembers(album)) === JSON.stringify([kept]),
      'stale/foreign denials must leave the original remaining member intact', album.id)
    results.rejected.push({ albumID: album.id, stale: stale.status, foreign: foreign.status })
  }
  const after = await actualFetch('GET', '/api/v1/media/items?range=true&limit=4&offset=0&sort_by=captured&sort_dir=asc&time_zone=UTC')
  check(after.status === 200 && after.body.total_count === 10000,
    'membership-only mutation must preserve 10k logical media assets')
  check(results.unexpectedHTTP.length === 0 && results.pageErrors.length === 0,
    'zero unexpected HTTP 5xx or browser page errors', { errors: results.unexpectedHTTP, pageErrors: results.pageErrors })
  results.passed = true
}
;(async () => {
  try {
    await main()
  } catch (error) {
    results.failure = error.stack || String(error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    try {
      const done = await fetch(fixture.url + '/__test/gallery/finish', { method: 'POST' })
      check(done.status === 204, 'real Go fixture did not acknowledge shutdown')
    } catch (error) {
      results.pageErrors.push('private fixture finish: ' + String(error))
      process.exitCode = 1
    }
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2) + '\n')
    console.log('IOS27_GALLERY_ALBUM_REMOVE_REAL_GO_RESULT ' + JSON.stringify({
      passed: results.passed, nativeRemovals: results.removals.length,
      rejected: results.rejected.length, metadataOnlyThumbnail503: results.expectedMissingCAS503,
      unexpectedErrors: results.unexpectedHTTP.length + results.pageErrors.length,
      failure: results.failure || null,
    }))
  }
})()
