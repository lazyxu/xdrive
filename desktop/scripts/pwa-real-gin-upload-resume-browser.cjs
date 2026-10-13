#!/usr/bin/env node
'use strict'
// S4B2: real production Web Files upload -> Gin/PostgreSQL17/local CAS.
// One controlled TCP drop on chunk 1; hard reload; user reselects same file.
// Chrome Android UA/touch is emulation, never an installed mobile device.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(text => {
  const found = /^--(ready|output-dir|mode)=(.+)$/.exec(text)
  assert(found, 'Only --ready, --output-dir and --mode are permitted')
  return [found[1], found[2]]
}))
assert(args.ready && args['output-dir'] && ['desktop', 'mobile'].includes(args.mode))
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert.equal(ready.pwa_s4b2_resume, true)
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.local_cas, true)
assert.equal(ready.intercepted_api, true, 'test fixture must declare one real TCP interruption')
assert.equal(ready.physical_device, false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
assert.equal(ready.upload_name, 'pwa-s4b2-17m.bin')
assert.equal(ready.upload_size_bytes, 17 * 1024 * 1024)
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'Native installed Chrome binary required')
const outputDir = path.resolve(args['output-dir'])
fs.mkdirSync(outputDir, { recursive: true })
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-s4b2-'))
const filepath = path.join(temp, ready.upload_name)
const summary = {
  phase: 'PWA-S4B2',
  mode: args.mode === 'mobile' ? 'Chrome Android UA/touch 390px emulation' : 'native Chrome desktop 1280px',
  physicalDevice: false, systemInstalled: false,
  realGin: true, realPostgreSQL: true, realLocalCAS: true,
  simulatedNetworkDrop: true, noApiMocks: true,
  inputBytes: ready.upload_size_bytes, verifiedOriginalSha256: false,
  interrupted: false, failedAttemptPersisted: false, reselectOfferedAfterReload: false,
  targetFolderReady: false, finalizedInTargetFolder: false,
  completed: false, onlyPublicOfflineCache: false, browserVersion: '', passed: false,
  stage: 'setup', observedTransfers: [], serverRequestCounters: null,
}
function originalInput() {
  const fd = fs.openSync(filepath, 'wx', 0o600)
  const hash = crypto.createHash('sha256')
  const scratch = Buffer.alloc(64 * 1024)
  try {
    for (let start = 0; start < ready.upload_size_bytes; start += scratch.length) {
      for (let n = 0; n < scratch.length; n++) {
        const i = start + n
        scratch[n] = (i * 31 + (i >> 7)) % 251
      }
      fs.writeSync(fd, scratch)
      hash.update(scratch)
    }
  } finally { fs.closeSync(fd) }
  const actual = fs.statSync(filepath)
  assert.equal(actual.size, ready.upload_size_bytes)
  return hash.digest('hex')
}
function transferSnapshot(page) {
  return page.evaluate(({ origin, username, name }) => {
    const key = 'xdrive.web.transfer_history:' + encodeURIComponent(origin + ':' + username)
    const records = JSON.parse(localStorage.getItem(key) || '[]')
    return records.filter(item => item.file_name === name && item.direction === 'upload')
      .map(item => ({
        id: item.id, state: item.state, scope: item.scope,
        retryable: item.retryable === true, hasManifest: /^[a-f0-9]{64}$/.test(item.resume_manifest_sha256 || ''),
      }))
  }, { origin: new URL(ready.url).origin, username: ready.username, name: ready.upload_name })
}
async function run() {
  const expectedHash = originalInput()
  let browser
  let diagnosticsPage = null
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    summary.browserVersion = browser.version()
    const mobile = args.mode === 'mobile'
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile, hasTouch: mobile, locale: 'zh-CN', serviceWorkers: 'allow',
      ...(mobile ? {
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
      } : {}),
    })
    const page = await context.newPage()
    diagnosticsPage = page
    page.setDefaultTimeout(30_000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.name))
    const filesHash = '#/app/files?dir=' + ready.target_id
    const destination = '/api/v1/nodes/' + ready.target_id
    const firstRead = page.waitForResponse(response =>
      new URL(response.url()).pathname === destination && response.status() === 200)
    await page.goto(ready.url + '/' + filesHash, { waitUntil: 'domcontentloaded' })
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await firstRead
    summary.stage = 'await-actual-directory'
    // The Gin Node read and the workspace mount do NOT prove the routed
    // folder is active: the SPA first renders a temporary root directory.
    // Wait for the actual active folder in the shared desktop/mobile UI
    // before a user opens the real file picker.
    const mobileFolder = args.mode === 'mobile'
    await page.locator(mobileFolder
      ? '[data-xdrive-mobile-files]' : '[data-xdrive-file-explorer]').waitFor()
    await page.waitForFunction(({ id, name, mobile }) => {
      if (mobile) {
        return document.querySelector('[data-xdrive-mobile-files] [data-mobile-files-compact-title]')
          ?.textContent?.trim() === name
      }
      const active = document.querySelector('[data-xdrive-file-explorer] [data-xdrive-file-explorer-crumb][aria-current="page"]')
      return active?.getAttribute('data-xdrive-file-explorer-crumb') === 'number:' + String(id)
    }, { id: ready.target_id, name: ready.target_name, mobile: mobileFolder }, { timeout: 30_000 })
    summary.targetFolderReady = true
    assert.equal(new URL(page.url()).hash, filesHash)

    // Only a real user click owns the browser's FileChooser gesture.
    summary.stage = 'select-initial-file'
    if (mobileFolder) await page.getByRole('button', { name: '文件操作菜单' }).click()
    const [firstChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      mobileFolder
        ? page.getByRole('menuitem', { name: '上传文件', exact: true }).click()
        : page.getByRole('button', { name: '上传文件', exact: true }).first().click(),
    ])
    await firstChooser.setFiles(filepath)
    summary.stage = 'await-first-failed-record'
    // Gin accepts chunk 0 and closes the real TCP connection on chunk 1.
    // The real Web transfer store must expose a retryable failed item.
    await page.waitForFunction(({ origin, username, name }) => {
      const key = 'xdrive.web.transfer_history:' + encodeURIComponent(origin + ':' + username)
      const items = JSON.parse(localStorage.getItem(key) || '[]')
      return items.some(x => x.file_name === name && x.direction === 'upload' &&
        x.state === 'failed' && x.retryable === true && /^[0-9a-f]{64}$/.test(x.resume_manifest_sha256 || ''))
    }, { origin: new URL(ready.url).origin, username: ready.username, name: ready.upload_name },
    { timeout: 45_000 })
    summary.interrupted = true
    summary.failedAttemptPersisted = true
    const old = await transferSnapshot(page)
    assert.equal(old.filter(x => x.retryable && x.hasManifest).length, 1)

    summary.stage = 'hard-reload'
    // A hard browser reload destroys the File object. The owner must
    // explicitly choose exactly the original file in the existing UI.
    const reloaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === destination && response.status() === 200)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await reloaded
    assert.equal(new URL(page.url()).hash, filesHash)
    // Ensure the current directory is authoritative after cold restoration,
    // not merely the preserved URL hash.
    await page.waitForFunction(({ id, name, mobile }) => {
      if (mobile) {
        return document.querySelector('[data-xdrive-mobile-files] [data-mobile-files-compact-title]')
          ?.textContent?.trim() === name
      }
      return document.querySelector('[data-xdrive-file-explorer] [data-xdrive-file-explorer-crumb][aria-current="page"]')
        ?.getAttribute('data-xdrive-file-explorer-crumb') === 'number:' + String(id)
    }, { id: ready.target_id, name: ready.target_name,
      mobile: args.mode === 'mobile' }, { timeout: 30_000 })
    const afterReload = await transferSnapshot(page)
    assert(afterReload.some(x => x.id === old.find(x => x.retryable).id &&
      x.state === 'failed' && x.retryable && x.hasManifest))
    summary.reselectOfferedAfterReload = true

    summary.stage = 'reselect'
    await page.locator('button[aria-label^="上传与下载"]').click()
    await page.getByRole('tab', { name: /历史记录/ }).click()
    const reselect = page.getByRole('button', { name: '重新选择原文件', exact: true })
    await reselect.waitFor()
    const [again] = await Promise.all([page.waitForEvent('filechooser'), reselect.click()])
    summary.stage = 'finalize'
    const finalize = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      /\/api\/v1\/uploads\/[^/]+\/finalize$/.test(new URL(response.url()).pathname) &&
      response.status() === 200, { timeout: 70_000 })
    await again.setFiles(filepath)
    const response = await finalize
    const final = await response.json()
    assert(Number.isSafeInteger(final.result?.id) && final.result.id > 0)
    assert.equal(final.result?.sha256, expectedHash)
    assert.equal(final.result?.size, ready.upload_size_bytes)
    // Independent of digest correctness, an upload into the bootstrap root
    // is a failed Files deep-link test, not a successful resumption.
    assert.equal(final.result?.parent_id, ready.target_id,
      'upload did not finalize in the requested Files directory')
    summary.finalizedInTargetFolder = true
    await page.waitForFunction(({ origin, username, id }) => {
      const key = 'xdrive.web.transfer_history:' + encodeURIComponent(origin + ':' + username)
      const history = JSON.parse(localStorage.getItem(key) || '[]')
      return history.some(x => x.id === id && x.retryable === false && !x.resume_manifest_sha256)
    }, { origin: new URL(ready.url).origin, username: ready.username,
      id: old.find(x => x.retryable).id }, { timeout: 30_000 })
    summary.verifiedOriginalSha256 = true
    summary.completed = true

    const cache = await page.evaluate(async () => {
      const names = await caches.keys(), resources = []
      for (const name of names) {
        const found = await caches.open(name)
        for (const item of await found.keys()) resources.push(new URL(item.url).pathname)
      }
      return { names, resources }
    })
    assert.deepEqual(cache.names, ['xdrive-pwa-public-offline-v1'])
    assert.deepEqual(cache.resources, ['/offline.html'])
    summary.onlyPublicOfflineCache = true
    assert.deepEqual(pageErrors, [])
    // Test-only scalar counters: capture before Go validates and shuts down.
    // This reveals automatic Chromium PUT retries without any upload identifiers.
    const counters = await fetch(ready.url + '/__test/pwa-s4b2/stats', {
      cache: 'no-store', signal: AbortSignal.timeout(2500),
    })
    assert.equal(counters.status, 200)
    summary.serverRequestCounters = await counters.json()
    assert.equal(summary.serverRequestCounters.session_posts, 2)
    assert.equal(summary.serverRequestCounters.chunk0_puts, 1)
    assert.equal(summary.serverRequestCounters.chunk2_puts, 1)
    assert(summary.serverRequestCounters.chunk1_puts >= 2)
    assert.equal(summary.serverRequestCounters.tcp_drops,
      summary.serverRequestCounters.chunk1_puts - 1)
    const stop = await fetch(ready.url + '/__test/pwa-s2b3/finish', { method: 'POST' })
    assert.equal(stop.status, 204)
    summary.passed = true
    summary.stage = 'complete'
    await context.close()
  } catch (error) {
    if (diagnosticsPage && !diagnosticsPage.isClosed()) {
      try {
        const rows = await transferSnapshot(diagnosticsPage)
        summary.observedTransfers = rows.map(x => ({state:x.state,retryable:x.retryable,hasManifest:x.hasManifest})).slice(0,10)
      } catch {}
    }
    try {
      const response = await fetch(ready.url + '/__test/pwa-s4b2/stats', {signal:AbortSignal.timeout(2500)})
      if (response.ok) summary.serverRequestCounters = await response.json()
    } catch {}
    throw error
  } finally {
    await browser?.close()
    fs.rmSync(temp, { recursive: true, force: true })
    fs.writeFileSync(path.join(outputDir, 'summary-' + args.mode + '.json'), JSON.stringify(summary, null, 2) + '\n')
  }
}
run().catch(error => {
  // Never export browser profile, credentials, JWT or HTTP response bodies.
  console.error('PWA_S4B2_FAILED stage=' + summary.stage + ' category=' + (error?.name || 'Error'))
  process.exitCode = 1
})
