#!/usr/bin/env node
'use strict'

// F-iOS27-09I-A: built production Web (Mobile + Wide) against actual Gin,
// isolated PostgreSQL17 and Local CAS. No browser route fulfils /api/v1.
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
assert(args.ready && args['output-dir'], 'require private ready file and result output directory')
const fixture = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert(fixture.postgresql && fixture.real_gin && fixture.intercepted_api === false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url), 'must use the locally bound real Go fixture')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, { recursive: true })
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const results = {
  phase: 'F-iOS27-09I-A', actualGoServer: true, postgresql17: true,
  interceptedAPI: false, physicalIOS27: false, fixtureOwnedNode: fixture.node_id,
  initialRevision: fixture.node_revision, widths: [], patches: [], copyQueues: [],
  foreignOwner: [], screenshots: [], errors: [],
  sourceSHA256: Object.fromEntries([
    'web/src/WebFileExplorer.tsx', 'web/src/MobileFiles.tsx', 'web/src/api.ts',
    'ui/shared/src/mui/FileExplorerNavigation.ts',
    'ui/shared/src/mui/VirtualCollectionController.ts',
  ].map(file => [file, hash(file)])),
}
let browser
let page
const apiPath = '/api/v1/nodes/' + fixture.node_id
const resultPath = path.join(output, 'results.json')
function check(condition, message, evidence) {
  assert(condition, message + (evidence === undefined ? '' : ': ' + JSON.stringify(evidence)))
}
async function renamed(input, submit, targetName, expectedStatus, expectedRevision, owner) {
  await input.fill(targetName)
  const [response] = await Promise.all([
    page.waitForResponse(r => {
      const url = new URL(r.url())
      return url.pathname === apiPath && r.request().method() === 'PATCH'
    }),
    submit(),
  ])
  const body = response.request().postDataJSON()
  const revisionHeader = response.request().headers()['if-match']
  const sample = {
    owner, nodeID: fixture.node_id, expectedStatus, actualStatus: response.status(),
    name: body.name, ifMatch: revisionHeader, expectedRevision,
  }
  results.patches.push(sample)
  check(response.status() === expectedStatus, 'actual Gin rename response', sample)
  check(body.name === targetName, 'real Web submitted the exact draft', sample)
  check(revisionHeader === '"' + expectedRevision + '"', 'actual Node revision header', sample)
  if (expectedStatus !== 200) {
    check(await input.inputValue() === targetName, 'failed rename must preserve draft', sample)
  }
  return response
}
async function screenshot(name) {
  const file = name + '.png'
  await page.screenshot({ path: path.join(output, file), fullPage: false })
  results.screenshots.push(file)
}
// F09I-B: compare real Copy-to submissions, without implying worker/CAS completion.
async function queueCopyFromUI(owner, width, targetID) {
  const mobile = width < 900
  await page.setViewportSize({ width, height: mobile ? 812 : 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const row = page.locator(mobile ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'wide-accepted.txt' }).first()
  await row.waitFor()
  await row.click({ button: 'right' })
  if (mobile) {
    await page.locator('[data-mobile-files-context-selection-action="copy-to"]').click()
  } else {
    await page.getByRole('menuitem', { name: '复制到…', exact: true }).first().click()
  }
  const dialog = page.locator('[data-xdrive-file-explorer-destination-dialog]')
  await dialog.waitFor()
  await dialog.locator('[data-xdrive-file-explorer-destination-directory="' + targetID + '"]').click()
  const submit = dialog.getByRole('button', { name: '复制到这里', exact: true })
  const [response] = await Promise.all([
    page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/v1/file-operations' &&
      r.request().method() === 'POST'),
    submit.click(),
  ])
  const posted = response.request().postDataJSON()
  const queued = await response.json()
  const sample = {
    owner, width, targetID, status: response.status(), type: posted.type,
    parentID: posted.parent_id, item: posted.items?.[0],
    operationID: queued.id, queuedType: queued.type, queuedParentID: queued.parent_id,
  }
  check(response.status() === 202 && posted.type === 'copy' && queued.type === 'copy',
    'actual Gin queued-copy response and operation type', sample)
  check(posted.parent_id === targetID && queued.parent_id === targetID &&
    posted.items?.length === 1 && posted.items[0].id === fixture.node_id &&
    posted.items[0].revision === fixture.node_revision + 2,
    'Mobile and Wide UI must send the same Node ID/revision through shared operation API', sample)
  check(typeof queued.id === 'string' && queued.id.length > 0,
    'real Server must persist an operation ID', sample)
  results.copyQueues.push(sample)
  await dialog.waitFor({ state: 'hidden' })
  await screenshot(mobile ? 'live-go-mobile-copy-queued' : 'live-go-wide-copy-queued')
}

async function main() {
  const launchArgs = process.env.XDRIVE_BROWSER_ARGS
    ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
    args: launchArgs,
  })
  results.browserVersion = browser.version()
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: false,
    deviceScaleFactor: 1, serviceWorkers: 'block', timezoneId: 'UTC',
  })
  await context.addInitScript(({ origin, token, username }) => {
    if (location.origin !== origin) return
    localStorage.setItem('xdrive.access_token', token)
    localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 3600000))
    localStorage.setItem('xdrive.username', username)
  }, { origin: fixture.url, token: fixture.token, username: fixture.username })
  // This callback may reject external URLs, but MUST NOT manufacture any
  // application HTTP response. All /api/v1 calls reach Server.Router.
  await context.route('**/*', route => {
    const requestURL = new URL(route.request().url())
    if (requestURL.origin !== fixture.url) {
      results.errors.push('attempted external URL origin')
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  page = await context.newPage()
  page.on('pageerror', error => results.errors.push('JS: ' + error.message))
  page.on('response', response => {
    if (response.status() >= 500) {
      results.errors.push('Go HTTP ' + response.status() + ' ' + new URL(response.url()).pathname)
    }
  })
  page.setDefaultTimeout(12000)

  for (const viewport of [
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 899, height: 700 }, { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(viewport)
    const rootPath = '/api/v1/nodes/' + fixture.root_id + '/children'
    const listResponse = page.waitForResponse(r =>
      new URL(r.url()).pathname === rootPath && r.request().method() === 'GET' && r.status() === 200)
    await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
      { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const response = await listResponse
    const data = await response.json()
    const items = Array.isArray(data.items) ? data.items : data
    check(Array.isArray(items), 'actual Go directory list must contain Nodes')
    const nodes = items.map(item => item.node || item)
    check(nodes.some(node => node.id === fixture.node_id &&
      node.revision === fixture.node_revision && node.name === 'document-001.txt'),
    'four widths must read the same PostgreSQL Node ID and revision', nodes)
    const mobile = viewport.width < 900
    const rows = page.locator(mobile ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]')
    await rows.filter({ hasText: 'document-001.txt' }).first().waitFor()
    const scrollOwners = await page.locator('[data-xdrive-file-explorer-scroll-host]').count()
    // xDrive has two existing chrome owners: the 52px mobile App title
    // and the separately retained wide Web AppBar. Do not demand the mobile
    // DOM selector at 900px or replace the wide layout to satisfy a test.
    const titlebar = page.locator(mobile
      ? '[data-xdrive-mobile-app-header]'
      : '[data-xdrive-workspace-background] .MuiAppBar-root')
    const headerHeight = await titlebar.first().evaluate(el => el.getBoundingClientRect().height)
    check(scrollOwners === 1 &&
      (mobile ? Math.abs(headerHeight - 52) <= 1 : headerHeight >= 48),
      'keep one virtual scroll owner and the existing responsive App titlebar',
      { viewport, mobile, scrollOwners, headerHeight })
    check(page.url().endsWith('/files?dir=' + fixture.root_id),
      'Server root must remain canonical after session restore', page.url())
    results.widths.push({ ...viewport, mobile, nodeID: fixture.node_id,
      revision: fixture.node_revision, oneScrollOwner: true, headerHeight })
    await screenshot('live-go-files-' + viewport.width)
  }

  // Real owner isolation, from the same browser network stack. The back end
  // deliberately returns owner-scoped 404, not a synthetic fixture 403.
  for (const method of ['GET', 'PATCH']) {
    const denied = await page.evaluate(async ({ url, token, method }) => {
      const response = await fetch(url, {
        method, headers: { Authorization: 'Bearer ' + token,
          ...(method === 'PATCH' ? { 'If-Match': '"1"', 'Content-Type': 'application/json' } : {}) },
        ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'foreign-rewrite.txt' }) } : {}),
      })
      return response.status
    }, { url: apiPath, token: fixture.foreign_token, method })
    check(denied === 404, 'real PostgreSQL foreign-owner Node must be invisible', { method, denied })
    results.foreignOwner.push({ method, status: denied })
  }

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const mobileRow = page.locator('[data-mobile-files-item]')
    .filter({ hasText: 'document-001.txt' }).first()
  await mobileRow.waitFor()
  await mobileRow.click({ button: 'right' })
  await page.locator('[data-mobile-files-item-rename]').click()
  const dialog = page.getByRole('dialog', { name: /^重命名/ })
  await dialog.waitFor()
  const mobileInput = dialog.getByRole('textbox', { name: '名称', exact: true })
  const mobileSubmit = () => dialog.getByRole('button', { name: '保存', exact: true }).click()
  await renamed(mobileInput, mobileSubmit, 'occupied.txt', 409, fixture.node_revision, 'Mobile Web')
  await screenshot('live-go-mobile-409')
  await renamed(mobileInput, mobileSubmit, 'mobile-accepted.txt', 200, fixture.node_revision, 'Mobile Web')
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('[data-mobile-files-item]')
    .filter({ hasText: 'mobile-accepted.txt' }).first().waitFor()
  await screenshot('live-go-mobile-200')

  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,
    { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const wideRow = page.locator('[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'mobile-accepted.txt' }).first()
  await wideRow.waitFor()
  await wideRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /重命名/ }).first().click()
  const wideInput = page.getByRole('textbox', {
    name: '重命名 mobile-accepted.txt', exact: true,
  })
  await wideInput.waitFor()
  const wideSubmit = () => wideInput.press('Enter')
  await renamed(wideInput, wideSubmit, 'occupied.txt', 409, fixture.node_revision + 1, 'Wide Web')
  await screenshot('live-go-wide-409')
  await renamed(wideInput, wideSubmit, 'wide-accepted.txt', 200, fixture.node_revision + 1, 'Wide Web')
  await page.locator('[data-xdrive-file-explorer-item]')
    .filter({ hasText: 'wide-accepted.txt' }).first().waitFor()
  await screenshot('live-go-wide-200')
  check(results.patches.map(item => item.actualStatus).join(',') === '409,200,409,200',
    'real Server conflict/retry matrix must be exact', results.patches)
  await queueCopyFromUI('Mobile Web', 375, fixture.mobile_copy_target_id)
  await queueCopyFromUI('Wide Web', 900, fixture.wide_copy_target_id)
  check(results.copyQueues.length === 2, 'both actual layouts must queue a copy', results.copyQueues)
  // Owner B has its own valid destination but no authority over Owner A's source.
  const foreignCopy = await page.evaluate(async ({ token, parentID, sourceID, revision }) => {
    const response = await fetch('/api/v1/file-operations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'copy', parent_id: parentID,
        items: [{ id: sourceID, revision }] }),
    })
    return response.status
  }, { token: fixture.foreign_token, parentID: fixture.foreign_root_id,
    sourceID: fixture.node_id, revision: fixture.node_revision + 2 })
  check(foreignCopy === 404, 'real Server must deny foreign-source queued copy', foreignCopy)
  results.foreignOwner.push({ method: 'POST file-operations/copy', status: foreignCopy })
  check(results.errors.length === 0, 'unexpected native browser or real Go API errors', results.errors)
  results.passed = true
}

;(async () => {
  try {
    await main()
  } catch (error) {
    results.passed = false
    results.failure = error.stack || String(error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    // Always release the native Gin fixture; it independently verifies its
    // persisted final Node identity and revisions before returning success.
    try {
      const stop = await fetch(fixture.url + '/__test/files/finish', { method: 'POST' })
      check(stop.status === 204, 'real fixture stop did not acknowledge')
    } catch (error) {
      results.errors.push('fixture stop failed: ' + String(error))
      process.exitCode = 1
    }
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2) + '\n')
    console.log('IOS27_FILES_REAL_GO_RESULT ' + JSON.stringify({
      passed: Boolean(results.passed), widths: results.widths.length,
      patches: results.patches.length, copyQueues: results.copyQueues.length, actualGoServer: true, postgresql17: true,
      failure: results.failure || null, errors: results.errors,
    }))
  }
})()
