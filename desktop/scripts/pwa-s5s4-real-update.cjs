#!/usr/bin/env node
'use strict'
// S5-04A: real built Web, genuine Chromium SW update and multi-tab lifecycle.
// Synthetic slow POST != a real file upload, Safari/Android OS installed evidence.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const root = path.resolve(__dirname, '../..')
const dist = path.join(root, 'web/dist')
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
const output = path.resolve(process.env.XD_PWA_S5S4_RESULT_DIR ||
  path.join(root, 'desktop/pwa-s5s4-results'))
assert(chrome && fs.existsSync(chrome), 'Real Chromium executable required')
assert(fs.existsSync(path.join(dist, 'index.html')), 'Build production Web before the browser test')
const originalWorker = fs.readFileSync(path.join(root, 'assets/icon/web/sw.js'), 'utf8')
assert(!/self\.skipWaiting\s*\(/.test(originalWorker), 'Product SW must not force-activate')
fs.mkdirSync(output, { recursive: true })

let servedVersion = 1
let pendingSyntheticResponses = []
let startedSyntheticPOSTs = 0
let unexpectedCredentials = 0
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
}
function workerFixture(version) {
  // Append ONLY an isolated test message probe to the unchanged product worker.
  // Never deploy this probe or use its result as physical browser evidence.
  return originalWorker + '\nself.addEventListener("message", function (event) {' +
    'if (event.data && event.data.kind === "s5-fixture-worker-version" && event.ports[0])' +
    'event.ports[0].postMessage(' + version + ');' +
    '});\n'
}
function respondJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(obj))
}
const server = http.createServer((req, res) => {
  let url
  try { url = new URL(req.url, 'http://localhost') }
  catch { res.writeHead(400); res.end(); return }
  const pathname = url.pathname
  if (pathname === '/api/v1/s5-synthetic-transfer' && req.method === 'POST') {
    let bodyBytes = 0
    req.on('data', chunk => {
      bodyBytes += chunk.length
      if (bodyBytes > 1024) req.destroy()
    })
    req.on('end', () => {
      if (bodyBytes === 0 || bodyBytes > 1024) {
        res.writeHead(400); res.end(); return
      }
      startedSyntheticPOSTs++
      pendingSyntheticResponses.push(res)
    })
    return
  }
  if (pathname.startsWith('/api/')) {
    respondJSON(res, 401, { error: 'synthetic-unauthed-fixture' })
    return
  }
  if (req.headers.authorization || req.headers.cookie) unexpectedCredentials++
  if (pathname === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'Service-Worker-Allowed': '/', 'X-Content-Type-Options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : workerFixture(servedVersion))
    return
  }
  let decoded
  try { decoded = decodeURIComponent(pathname) }
  catch { res.writeHead(400); res.end(); return }
  const target = decoded === '/' ? path.join(dist, 'index.html') :
    path.resolve(dist, '.' + decoded)
  if (target !== path.join(dist, 'index.html') &&
      !target.startsWith(dist + path.sep)) {
    res.writeHead(403); res.end(); return
  }
  let data
  try {
    if (!fs.statSync(target).isFile()) throw Error('not-file')
    data = fs.readFileSync(target)
  } catch {
    res.writeHead(404); res.end(); return
  }
  const headers = { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff' }
  if (decoded === '/offline.html' || decoded === '/site.webmanifest')
    headers['Cache-Control'] = 'no-cache, must-revalidate'
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : data)
})

const probeWorker = async page => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration()
  const send = worker => !worker ? Promise.resolve(null) :
    new Promise((resolve, reject) => {
      const ports = new MessageChannel()
      const timeout = setTimeout(() => reject(new Error('fixture worker probe timeout')), 3000)
      ports.port1.onmessage = event => {
        clearTimeout(timeout)
        ports.port1.close()
        resolve(event.data)
      }
      worker.postMessage({ kind: 's5-fixture-worker-version' }, [ports.port2])
    })
  return { active: await send(registration?.active),
    waiting: await send(registration?.waiting),
    controller: await send(navigator.serviceWorker.controller) }
})

async function waitForCondition(fn, label) {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Timed out: ' + label)
}
async function cacheSnapshot(page) {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const paths = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname)
    }
    return { names, paths }
  })
}
async function openControlledPage(context, url) {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  return page
}
async function oneCase(browser, origin, label, mobile) {
  servedVersion = 1
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(mobile ? {
      isMobile: true, hasTouch: true, deviceScaleFactor: 3,
      userAgent: 'Mozilla/5.0 (Linux; Android 16; S5CI) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36',
    } : {}),
  })
  const launchUrl = origin + '/#/app/files'
  try {
    const page = await openControlledPage(context, launchUrl)
    const peer = await openControlledPage(context, launchUrl)
    const v1 = await probeWorker(page)
    assert.equal(v1.controller, 1)
    assert.equal(v1.active, 1)
    assert.equal((await probeWorker(peer)).controller, 1)
    await page.evaluate(() => {
      window.__s5OriginalDocumentMarker = 'original-document'
      window.__s5OriginalController = navigator.serviceWorker.controller
      window.__s5ControllerChanges = 0
      navigator.serviceWorker.addEventListener('controllerchange',
        () => { window.__s5ControllerChanges++ })
      window.__s5FakeTransferFinished = false
      void fetch('/api/v1/s5-synthetic-transfer', {
        method: 'POST', body: 'local-synthetic-post-body', cache: 'no-store',
      }).then(response => {
        window.__s5FakeTransferFinished = response.ok
      }).catch(() => { window.__s5FakeTransferFinished = false })
    })
    await waitForCondition(() => startedSyntheticPOSTs > 0 && pendingSyntheticResponses.length > 0,
      'synthetic POST to be held by fixture')
    servedVersion = 2
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg.update()
    })
    await waitForCondition(async () => {
      const v = await probeWorker(page)
      return v.active === 1 && v.waiting === 2 && v.controller === 1
    }, 'new worker waiting behind two controlled tabs')
    const state = await page.evaluate(() => ({
      marker: window.__s5OriginalDocumentMarker,
      controllerStable: window.__s5OriginalController === navigator.serviceWorker.controller,
      controllerChanges: window.__s5ControllerChanges,
      syntheticPOSTFinished: window.__s5FakeTransferFinished,
      hash: location.hash,
    }))
    assert.equal(state.marker, 'original-document')
    assert.equal(state.controllerStable, true)
    assert.equal(state.controllerChanges, 0)
    assert.equal(state.syntheticPOSTFinished, false)
    assert.equal(state.hash, '#/app/files')
    assert.equal((await probeWorker(peer)).controller, 1)
    const privateResponse = await page.evaluate(async () =>
      (await fetch('/api/v1/nodes/root', { cache: 'no-store' })).status)
    assert.equal(privateResponse, 401, 'private API must bypass SW and remain unauthorized')
    const cachesBefore = await cacheSnapshot(page)
    assert.deepEqual(cachesBefore.names, ['xdrive-pwa-public-offline-v1'])
    assert.deepEqual(cachesBefore.paths, ['/offline.html'])
    for (const held of pendingSyntheticResponses.splice(0)) {
      held.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      held.end('{"fixture":"ack"}')
    }
    await page.waitForFunction(() => window.__s5FakeTransferFinished === true)
    assert.equal((await probeWorker(page)).controller, 1)
    await peer.close()
    await page.close()
    const reopened = await openControlledPage(context, launchUrl)
    await waitForCondition(async () => {
      const v = await probeWorker(reopened)
      return v.active === 2 && v.controller === 2 && v.waiting === null
    }, 'new SW activation only after both old clients close')
    assert.deepEqual((await cacheSnapshot(reopened)).paths, ['/offline.html'])
    await reopened.close()
    return { mode: label, physicalDevice: false, syntheticOnly: true,
      realBrowserUpdate: true, waitingWithoutReload: true,
      twoWindowProtection: true, syntheticPOSTSurvived: true,
      privateAPIBypassed: true, publicCacheOnly: true, postClosureActivation: true }
  } finally {
    for (const held of pendingSyntheticResponses.splice(0)) held.destroy()
    await context.close()
  }
}

async function main() {
  const summary = { schema: 'xdrive-pwa-s5s4-chrome-upgrade-v1',
    commit: process.env.XD_PR_HEAD || null,
    physicalDevice: false, release_gate: 'NO_GO_PHYSICAL_INSTALL_NOT_RUN',
    cases: [], passed: false }
  let browser
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const origin = 'http://127.0.0.1:' + server.address().port
    summary.cases.push(await oneCase(browser, origin, 'desktop-Chromium-tab', false))
    summary.cases.push(await oneCase(browser, origin, 'Android-UA-touch-390px-simulation', true))
    assert.equal(startedSyntheticPOSTs, 2)
    assert.equal(unexpectedCredentials, 0)
    summary.passed = true
  } catch (error) {
    summary.failureCode = 'S5S4_BROWSER_CONTRACT_FAILED'
    // The raw exception is intentionally not archived; it may contain a URL.
    console.error('S5S4_BROWSER_FAILURE', error.message)
    process.exitCode = 1
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n',
      { mode: 0o600 })
    console.log('S5S4_BROWSER_RESULT ' + JSON.stringify(summary))
  }
}
void main().catch(() => { process.exitCode = 1 })
