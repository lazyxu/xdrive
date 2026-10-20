#!/usr/bin/env node
'use strict'
// S4D2: built production Web + real native Chrome + actual Gin/PostgreSQL.
// Mobile 390px UA/touch is simulation, NOT an installed Android/iOS device.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { assertXDrivePublicShellCache } = require('./pwa-public-shell-cache.cjs')
const puppeteer = require(process.env.XDRIVE_PUPPETEER_MODULE || 'puppeteer-core')

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(ready|output-dir|mode)=(.+)$/.exec(arg)
  assert(match, 'only --ready, --output-dir, --mode allowed')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'] && ['desktop', 'mobile'].includes(args.mode))
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert.equal(ready.pwa_s4d2_wake, true)
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.local_cas, true)
assert.equal(ready.intercepted_api, false)
assert.equal(ready.physical_device, false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
assert(/^sync-run:4d200000-0000-4000-8000-000000000001$/.test(ready.wake_task_id))
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'genuine installed system Chrome required')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, {recursive: true})
const summary = {
  phase: 'PWA-S4D2',
  commit: process.env.XD_PR_HEAD || '',
  mode: args.mode === 'mobile' ? 'Chrome Android UA/touch 390px emulation' : 'Desktop Chrome 1280px',
  physicalDevice: false,
  systemInstalled: false,
  realGin: true,
  realPostgreSQL: true,
  noApiMocks: true,
  initialRunning: false,
  actualHidden: false,
  serverAdvancedOnly: false,
  foregroundSummaryRead: false,
  foregroundTaskPageRead: false,
  uiCompleted: false,
  coldReloadConsistent: false,
  noBrowserTaskMutations: false,
  onlyPublicOfflineCache: false,
  passed: false,
  stage: 'setup',
}
// Puppeteer leaves browser foreground control to Chrome (unlike Playwright's
// per-page focus emulation), so native tab visibility is observable.
async function waitForTaskState(page, taskId, expected, timeout = 30000) {
  await page.waitForFunction((id, label) => {
    const element = document.querySelector('[data-xdrive-background-task-id="' + id + '"]')
    return element != null && element.textContent.includes(label)
  }, {polling: 200, timeout}, taskId, expected)
}

async function main() {
  let browser
  try {
    assert(process.env.DISPLAY, 'headed Chrome display required for native tab lifecycle')
    browser = await puppeteer.launch({
      executablePath: chrome, headless: false, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const mobile = args.mode === 'mobile'
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport(mobile
      ? {width: 390, height: 844, isMobile: true, hasTouch: true}
      : {width: 1280, height: 800})
    await page.setExtraHTTPHeaders({'Accept-Language': 'zh-CN,zh;q=0.9'})
    if (mobile) await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36')
    page.setDefaultTimeout(30000)
    const mutations = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (request.method() !== 'GET' && request.method() !== 'HEAD' &&
          (url.pathname.endsWith('/background-tasks/control') ||
           url.pathname.startsWith('/api/v1/uploads'))) {
        mutations.push(request.method() + ':' + url.pathname)
      }
    })
    summary.stage = 'login-deep-link'
    await page.goto(ready.url + '/#/app/tasks', {waitUntil: 'domcontentloaded'})
    await page.waitForSelector('#web-login-username', {visible: true})
    await page.type('#web-login-username', ready.username)
    await page.type('#web-login-password', "PwaRealGin-TestOnly_2026!")
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
      .some(b => b.textContent.trim() === '登录'), {timeout: 30000})
    let clickedLogin = false
    for (const button of await page.$$('button')) {
      if (await button.evaluate(el => el.textContent.trim()) === '登录') {
        await button.click()
        clickedLogin = true
        break
      }
    }
    assert(clickedLogin, 'real login button must be clicked')
    const taskSelector = '[data-xdrive-background-task-id="' + ready.wake_task_id + '"]'
    await page.waitForSelector(taskSelector, {visible: true, timeout: 45000})
    await waitForTaskState(page, ready.wake_task_id, '进行中', 45000)
    summary.initialRunning = true

    // A genuine additional Chromium tab changes the original tab's
    // visibilityState. No synthetic dispatchEvent can qualify here.
    summary.stage = 'actual-background-tab'
    const other = await context.newPage()
    await other.goto('about:blank')
    await other.bringToFront()
    // Hidden tabs suspend requestAnimationFrame; timer polling observes native state.
    await page.waitForFunction(() => document.visibilityState === 'hidden',
      {polling: 100, timeout: 15000})
    assert.equal(await other.evaluate(() => document.visibilityState), 'visible')
    summary.actualHidden = true
    summary.stage = 'test-server-authoritative-transition'
    const advance = await fetch(ready.url + '/__test/pwa-s4d2/advance', {
      method: 'POST',
      headers: {'X-PWA-Synthetic-Advance': 's4d2-fixture-only'},
    })
    assert.equal(advance.status, 204, 'test-only isolated Server transition must succeed')
    summary.serverAdvancedOnly = true
    assert.equal(await page.evaluate(() => document.visibilityState), 'hidden')

    summary.stage = 'foreground-read-only-wake'
    // Register response listeners BEFORE actual OS tab focus and visibility.
    const summaryResponse = page.waitForResponse(r =>
      r.status() === 200 &&
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/v1/background-tasks/active-summary', {timeout: 45000})
    const pageResponse = page.waitForResponse(r =>
      r.status() === 200 &&
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/v1/background-tasks/page', {timeout: 45000})
    await page.bringToFront()
    const [active, taskPage] = await Promise.all([summaryResponse, pageResponse])
    const activeBody = await active.json()
    assert.equal(activeBody.active_total, 0)
    assert.equal(activeBody.sync_run, 0)
    summary.foregroundSummaryRead = true
    const pageBody = await taskPage.json()
    assert(pageBody.history_items.some(x => x.id === ready.wake_task_id && x.state === 'completed'))
    assert(!pageBody.current_items.some(x => x.id === ready.wake_task_id))
    summary.foregroundTaskPageRead = true
    await waitForTaskState(page, ready.wake_task_id, '已完成')
    summary.uiCompleted = true

    summary.stage = 'hard-reload-authoritative'
    await page.reload({waitUntil: 'domcontentloaded'})
    await page.waitForSelector(taskSelector, {visible: true, timeout: 30000})
    await waitForTaskState(page, ready.wake_task_id, '已完成')
    summary.coldReloadConsistent = true
    assert.deepEqual(mutations, [], 'foreground wake never issues cancel/retry/upload')
    summary.noBrowserTaskMutations = true

    const cached = await page.evaluate(async () => {
      const paths = []
      for (const key of await caches.keys()) {
        const cache = await caches.open(key)
        for (const item of await cache.keys()) paths.push(new URL(item.url).pathname)
      }
      return paths
    })
    assertXDrivePublicShellCache(cached)
    summary.onlyPublicOfflineCache = true

    summary.stage = 'independent-go-postflight'
    const finish = await fetch(ready.url + '/__test/pwa-s2b3/finish', {method: 'POST'})
    assert.equal(finish.status, 204)
    summary.passed = true
    summary.stage = 'complete'
  } finally {
    await browser?.close()
    fs.writeFileSync(path.join(output, 'summary-' + args.mode + '.json'),
      JSON.stringify(summary, null, 2) + '\n')
  }
}
main().catch(error => {
  // Do not expose JWTs, ticket URLs, local paths or response bodies.
  console.error('PWA_S4D2_FAILED stage=' + summary.stage + ' category=' +
    (error?.name || 'Error'))
  process.exitCode = 1
})
