#!/usr/bin/env node
'use strict'
// PWA S4C3-B1: real browser-owned native download to an actual disk file.
// Chrome Android UA/touch is an emulator, NOT Android OS Installed or iOS.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(ready|output-dir|mode)=(.+)$/.exec(arg)
  assert(match, 'only --ready, --output-dir and --mode are supported')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'] && ['desktop', 'mobile'].includes(args.mode))
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert.equal(ready.pwa_s4c3_native_download, true)
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.local_cas, true)
assert.equal(ready.intercepted_api, false)
assert.equal(ready.physical_device, false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url), 'local isolated Gin required')
assert(Number.isSafeInteger(ready.native_download_node_id) && ready.native_download_node_id > 0)
assert(Number.isSafeInteger(ready.target_id) && ready.target_id > 0)
assert(ready.native_download_size_bytes === 2 ** 30 || ready.native_download_size_bytes === 4 * 2 ** 30)
assert(/^[a-f0-9]{64}$/.test(ready.native_download_sha256))
assert.equal(ready.native_download_physically_allocated, true)
assert.equal(ready.username, 'pwa-s2b3-owner')
assert.equal(ready.native_download_name,
  'pwa-s4c3b1-native-' + String(ready.native_download_size_bytes / 2 ** 30) + 'gib.bin')

const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'genuine installed system Chrome required')
const out = path.resolve(args['output-dir'])
fs.mkdirSync(out, {recursive: true})
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-s4c3-native-'))
const summary = {
  phase: 'PWA-S4C3-B1', commit: process.env.XD_PR_HEAD || '',
  mode: args.mode === 'mobile' ? 'Chrome Android UA/touch 390px emulation' : 'Chrome desktop 1280px',
  physicalDevice: false, systemInstalled: false, noApiMocks: true,
  realGin: true, realPostgreSQL: true, realLocalCAS: true,
  fixtureBytes: ready.native_download_size_bytes,
  sourcePhysicallyAllocated: true, uiFileExplorer: false,
  actualNativeDownload: false, actualDiskFile: false, nativeSHA256Verified: false,
  range206: false, range416: false, ticketRequired: false,
  onlyPublicOfflineCache: false, browserVersion: '', stage: 'setup',
  passed: false,
}
async function hashFile(filepath) {
  const digest = crypto.createHash('sha256')
  let bytes = 0
  await new Promise((resolve, reject) => {
    const read = fs.createReadStream(filepath, {highWaterMark: 1024 * 1024})
    read.on('data', part => {bytes += part.length; digest.update(part)})
    read.once('error', reject)
    read.once('end', resolve)
  })
  return {bytes, sha256: digest.digest('hex')}
}
async function run() {
  let browser
  try {
    browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox']})
    summary.browserVersion = browser.version()
    const mobile = args.mode === 'mobile'
    const context = await browser.newContext({
      viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 800},
      isMobile: mobile, hasTouch: mobile, acceptDownloads: true, locale: 'zh-CN',
      serviceWorkers: 'allow',
      ...(mobile ? {userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36'} : {}),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(ready.native_download_size_bytes > 2 ** 30 ? 150000 : 90000)
    // Explicit capability fallback: iOS/Android generally lack the Chromium
    // File System Access save picker. No network, API or response interception.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {configurable: true, value: undefined})
    })
    const errors = []
    page.on('pageerror', error => errors.push(error.name))
    let ticketRequests = 0
    page.on('request', request => {
      if (request.method() === 'POST' &&
        new URL(request.url()).pathname ===
        '/api/v1/files/' + ready.native_download_node_id + '/download-ticket') ticketRequests++
    })
    const filesHash = '#/app/files?dir=' + ready.target_id
    const nodePath = '/api/v1/nodes/' + ready.target_id
    const firstRead = page.waitForResponse(r =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === nodePath && r.status() === 200)
    summary.stage = 'login'
    await page.goto(ready.url + '/' + filesHash, {waitUntil: 'domcontentloaded'})
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await page.getByRole('button', {name: '登录', exact: true}).click()
    await firstRead
    await page.locator(mobile
      ? '[data-xdrive-mobile-files]' : '[data-xdrive-file-explorer]').waitFor()
    summary.stage = 'ready-target-folder'
    await page.waitForFunction(({id, name, mobile}) => {
      if (mobile) {
        return document.querySelector('[data-xdrive-mobile-files] [data-mobile-files-compact-title]')
          ?.textContent?.trim() === name
      }
      return document.querySelector('[data-xdrive-file-explorer] [data-xdrive-file-explorer-crumb][aria-current="page"]')
        ?.getAttribute('data-xdrive-file-explorer-crumb') === 'number:' + id
    }, {id: ready.target_id, name: ready.target_name, mobile}, {timeout: 30000})
    summary.uiFileExplorer = true
    const row = mobile
      ? page.locator('[data-xdrive-mobile-files] [data-mobile-files-item]').filter({
        has: page.locator('[data-mobile-files-item-title]').getByText(ready.native_download_name, {exact: true}),
      }).first()
      : page.locator('[data-xdrive-file-explorer-item-id="number:' +
        ready.native_download_node_id + '"]')
    await row.waitFor({state: 'visible'})
    summary.stage = 'native-user-download'
    const nativeDownload = page.waitForEvent('download', {
      timeout: ready.native_download_size_bytes > 2 ** 30 ? 480000 : 240000,
    })
    await row.click({button: 'right'})
    await page.getByRole('menuitem', {name: '下载', exact: true}).click()
    const download = await nativeDownload
    assert.equal(download.suggestedFilename(), ready.native_download_name)
    const downloadURL = new URL(download.url())
    assert.equal(downloadURL.origin, new URL(ready.url).origin)
    assert.equal(downloadURL.pathname, '/api/v1/file-download/' + ready.native_download_node_id)
    assert(downloadURL.searchParams.has('ticket'), 'real short-lived signed ticket required')
    assert(ticketRequests >= 1, 'production XDriveApi must request signed native download ticket')
    summary.actualNativeDownload = true

    summary.stage = 'save-and-full-disk-sha'
    const saved = path.join(temp, 'saved-original.bin')
    await download.saveAs(saved)
    assert.equal(await download.failure(), null)
    const disk = fs.statSync(saved)
    assert.equal(disk.size, ready.native_download_size_bytes)
    assert(disk.blocks * 512 >= disk.size * .98, 'OS downloaded file must actually occupy disk')
    summary.actualDiskFile = true
    const digest = await hashFile(saved)
    assert.equal(digest.bytes, ready.native_download_size_bytes)
    assert.equal(digest.sha256, ready.native_download_sha256, 'browser-native disk file full SHA differs from physical CAS')
    summary.nativeSHA256Verified = true

    // The saved native URL is only held in process memory, never recorded
    // in a log or artifact. No bearer token is sent to the Range stream.
    summary.stage = 'real-ticket-range'
    const length = 32
    for (const offset of [0, ready.native_download_size_bytes - length]) {
      const response = await context.request.get(download.url(), {
        headers: {'Range': 'bytes=' + offset + '-' + (offset + length - 1)},
        timeout: 120000,
      })
      assert.equal(response.status(), 206)
      assert.equal(response.headers()['content-range'],
        'bytes ' + offset + '-' + (offset + length - 1) + '/' + ready.native_download_size_bytes)
      assert.equal(response.headers()['content-length'], String(length))
      assert(response.headers()['cache-control']?.includes('no-store'))
      assert.equal((await response.body()).length, length)
    }
    summary.range206 = true
    const beyond = await context.request.get(download.url(), {
      headers: {'Range': 'bytes=' + ready.native_download_size_bytes + '-'},
    })
    assert.equal(beyond.status(), 416)
    assert.equal(beyond.headers()['content-range'], 'bytes */' + ready.native_download_size_bytes)
    summary.range416 = true
    const missing = await context.request.get(
      ready.url + '/api/v1/file-download/' + ready.native_download_node_id,
      {maxRedirects: 0})
    assert.equal(missing.status(), 401)
    summary.ticketRequired = true
    const cached = await page.evaluate(async () => {
      const names = await caches.keys()
      const paths = []
      for (const name of names) {
        const entries = await (await caches.open(name)).keys()
        for (const item of entries) paths.push(new URL(item.url).pathname)
      }
      return paths
    })
    assert(cached.every(p => p === '/offline.html'), 'PWA SW retained a private payload')
    summary.onlyPublicOfflineCache = true
    assert.deepEqual(errors, [])
    summary.stage = 'go-postflight'
    const finished = await fetch(ready.url + '/__test/pwa-s2b3/finish', {method: 'POST'})
    assert.equal(finished.status, 204)
    summary.passed = true
    summary.stage = 'complete'
  } finally {
    await browser?.close()
    fs.rmSync(temp, {recursive: true, force: true})
    fs.writeFileSync(path.join(out, 'summary-' + args.mode + '.json'),
      JSON.stringify(summary, null, 2) + '\n')
  }
}
run().catch(error => {
  // Deliberately exclude request URLs, signed tickets, passwords and raw logs.
  console.error('PWA_S4C3_NATIVE_FAILED stage=' + summary.stage +
    ' category=' + (error?.name || 'Error'))
  process.exitCode = 1
})
