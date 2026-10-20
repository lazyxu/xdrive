#!/usr/bin/env node
'use strict'
// S4D3: genuine SQL file operation is executed by the Server worker after Chrome exits.
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
assert.equal(ready.pwa_s4d3_durable, true)
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.local_cas, true)
assert.equal(ready.intercepted_api, false)
assert.equal(ready.physical_device, false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
assert(/^file-operation:[0-9a-f-]{36}$/.test(ready.durable_task_id))
const operationId = ready.durable_task_id.slice('file-operation:'.length)
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'genuine installed system Chrome required')
const output = path.resolve(args['output-dir'])
fs.mkdirSync(output, {recursive: true})
const summary = {
  phase: 'PWA-S4D3',
  commit: process.env.XD_PR_HEAD || '',
  mode: args.mode === 'mobile' ? 'Chrome Android UA/touch 390px emulation' : 'Desktop Chrome 1280px',
  physicalDevice: false,
  systemInstalled: false,
  realGin: true,
  realPostgreSQL: true,
  noApiMocks: true,
  initialQueued: false,
  originalChromeTerminated: false,
  independentWorkerStarted: false,
  recoveredFreshBrowserLogin: false,
  serverSummaryRead: false,
  serverTaskPageRead: false,
  serverFileOperationsRead: false,
  uiCompleted: false,
  coldReloadConsistent: false,
  noBrowserTaskMutations: false,
  onlyPublicOfflineCache: false,
  passed: false,
  stage: 'setup',
}
// Puppeteer leaves browser foreground control to Chrome (unlike Playwright's
// per-page focus emulation), so native tab visibility is observable.
async function waitForOperationState(page, operationId, expected, timeout = 30000) {
  await page.waitForFunction((id, label) => {
    const element = document.querySelector('[data-xdrive-file-operation-id="' + id + '"]')
    return element != null && element.textContent.includes(label)
  }, {polling: 200, timeout}, operationId, expected)
}


async function authenticate(p) {
    await p.goto(ready.url + '/#/app/tasks', {waitUntil: 'domcontentloaded'})
    await p.waitForSelector('#web-login-username', {visible: true})
    await p.type('#web-login-username', ready.username)
    await p.type('#web-login-password', "PwaRealGin-TestOnly_2026!")
    await p.waitForFunction(() => Array.from(document.querySelectorAll('button'))
      .some(b => b.textContent.trim() === '登录'), {timeout: 30000})
    let clickedLogin = false
    for (const button of await p.$$('button')) {
      if (await button.evaluate(el => el.textContent.trim()) === '登录') {
        await button.click()
        clickedLogin = true
        break
      }
    }
    assert(clickedLogin, 'real login button must be clicked')
}

async function main() {
  let browser, restarted
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
           url.pathname.startsWith('/api/v1/uploads') ||
           url.pathname.startsWith('/api/v1/file-operations'))) {
        mutations.push(request.method() + ':' + url.pathname)
      }
    })
    summary.stage = 'login-queued'
    await authenticate(page)
    summary.stage = 'queued-file-operation-card'
    const taskSelector = '[data-xdrive-file-operation-id="' + operationId + '"]'
    await page.waitForSelector(taskSelector, {visible: true, timeout: 45000})
    await waitForOperationState(page, operationId, '等待执行', 45000)
    summary.initialQueued = true

    // Terminate the OS Chrome process abruptly, without pagehide/unload.
    // A browser-tab close or injected lifecycle event would not prove this.
    summary.stage = 'terminate-chrome-process'
    const oldProcess = browser.process()
    assert(oldProcess?.pid, 'real OS Chrome process is required')
    const stopped = new Promise((resolve, reject) => {
      oldProcess.once('exit', (code, signal) => {
        if (signal === 'SIGKILL') resolve()
        else reject(new Error('old Chrome did not exit from forced termination'))
      })
      oldProcess.once('error', reject)
    })
    assert(oldProcess.kill('SIGKILL'), 'Chrome OS process could not be terminated')
    await stopped
    summary.originalChromeTerminated = true

    // The test-only endpoint only STARTS the genuine production worker.
    // It never sets the FileOperation or Node state directly.
    summary.stage = 'independent-server-worker'
    const start = await fetch(ready.url + '/__test/pwa-s4d3/start-worker', {
      method: 'POST',
      headers: {'X-PWA-Durable-Test-Start': 's4d3-server-worker-only'},
    })
    assert.equal(start.status, 204, 'isolated real Server worker start failed')
    summary.independentWorkerStarted = true

    // No browser profile, DOM, cookies or retained File object is reused.
    summary.stage = 'fresh-os-chrome-login'
    restarted = await puppeteer.launch({
      executablePath: chrome, headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    assert.notEqual(restarted.process()?.pid, oldProcess.pid, 'new Chrome process required')
    const newContext = await restarted.createBrowserContext()
    const recoveredPage = await newContext.newPage()
    await recoveredPage.setViewport(mobile
      ? {width: 390, height: 844, isMobile: true, hasTouch: true}
      : {width: 1280, height: 800})
    await recoveredPage.setExtraHTTPHeaders({'Accept-Language': 'zh-CN,zh;q=0.9'})
    if (mobile) await recoveredPage.setUserAgent(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36')
    recoveredPage.setDefaultTimeout(30000)
    recoveredPage.on('request', request => {
      const url = new URL(request.url())
      if (request.method() !== 'GET' && request.method() !== 'HEAD' &&
          (url.pathname.endsWith('/background-tasks/control') ||
           url.pathname.startsWith('/api/v1/uploads') ||
           url.pathname.startsWith('/api/v1/file-operations'))) {
        mutations.push(request.method() + ':' + url.pathname)
      }
    })
    await authenticate(recoveredPage)
    summary.stage = 'completed-file-operation-card'
    await recoveredPage.waitForSelector(taskSelector, {visible: true, timeout: 45000})
    await waitForOperationState(recoveredPage, operationId, '已完成', 45000)
    summary.recoveredFreshBrowserLogin = true
    summary.uiCompleted = true

    summary.stage = 'hard-reload-authoritative'
    const summaryResponse = recoveredPage.waitForResponse(r =>
      r.status() === 200 && r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/v1/background-tasks/active-summary',
    {timeout: 45000})
    const pageResponse = recoveredPage.waitForResponse(r =>
      r.status() === 200 && r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/v1/background-tasks/page',
    {timeout: 45000})
    const fileOperationsResponse = recoveredPage.waitForResponse(r =>
      r.status() === 200 && r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/v1/file-operations',
    {timeout: 45000})
    await recoveredPage.reload({waitUntil: 'domcontentloaded'})
    const [active, tasks, fileOperations] = await Promise.all([
      summaryResponse, pageResponse, fileOperationsResponse,
    ])
    const activeBody = await active.json()
    assert.equal(activeBody.active_total, 0)
    assert.equal(activeBody.file_operation, 0)
    summary.serverSummaryRead = true
    const pageBody = await tasks.json()
    assert(Array.isArray(pageBody.current_items) && Array.isArray(pageBody.history_items))
    // Personal FileOperationCenter renders this domain separately from the
    // background-task cards and the owner background-task page.
    assert(!pageBody.current_items.some(x => x.id === ready.durable_task_id))
    assert(!pageBody.history_items.some(x => x.id === ready.durable_task_id))
    summary.serverTaskPageRead = true
    const operationsBody = await fileOperations.json()
    assert(Array.isArray(operationsBody) && operationsBody.some(op =>
      op.id === operationId && op.status === 'completed' && op.processed_items === 1),
    'authenticated file operation list must contain the Worker-completed record')
    summary.serverFileOperationsRead = true
    await recoveredPage.waitForSelector(taskSelector, {visible: true, timeout: 30000})
    await waitForOperationState(recoveredPage, operationId, '已完成')
    summary.coldReloadConsistent = true
    assert.deepEqual(mutations, [], 'browser must not replay, cancel or mutate tasks')
    summary.noBrowserTaskMutations = true

    const cached = await recoveredPage.evaluate(async () => {
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
    await restarted?.close().catch(() => {})
    await browser?.close().catch(() => {})
    fs.writeFileSync(path.join(output, 'summary-' + args.mode + '.json'),
      JSON.stringify(summary, null, 2) + '\n')
  }
}
main().catch(error => {
  // Do not expose JWTs, ticket URLs, local paths or response bodies.
  console.error('PWA_S4D3_FAILED stage=' + summary.stage + ' category=' +
    (error?.name || 'Error'))
  process.exitCode = 1
})
