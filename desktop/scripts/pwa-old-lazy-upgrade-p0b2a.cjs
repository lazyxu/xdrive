#!/usr/bin/env node
'use strict'
// P0-B2a: genuine Chromium, production Vite bundle and the real POSIX archive.
// The two release identities here are isolated public-asset/SW fixtures, NOT
// proof of two independently deployed apps or OS-installed iOS PWA behavior.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const root = path.resolve(__dirname, '../..')
const dist = path.join(root, 'web/dist')
const assets = path.join(dist, 'assets')
const archiveScript = path.join(root, 'deploy/pwa-archive-assets.sh')
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
const output = path.resolve(process.env.XD_PWA_P0B2_RESULT_DIR ||
  path.join(root, 'desktop/pwa-p0b2-results'))
assert(chrome && fs.existsSync(chrome), 'Real Chromium/Chrome executable is required')
assert(fs.existsSync(path.join(dist, 'sw.js')), 'Build the production PWA first')
assert(fs.statSync(assets).isDirectory(), 'Built hashed assets are required')
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
const actualDynamic = Object.entries(manifest)
  .filter(([, value]) => value.isDynamicEntry && /^assets\/.*\.js$/.test(value.file || ''))
  .sort(([a], [b]) => Number(/gallery|viewer|files/i.test(b)) - Number(/gallery|viewer|files/i.test(a)))[0]
assert(actualDynamic, 'Require an actual Web lazy JS chunk, not only a synthetic module')
const realLazyPath = '/' + actualDynamic[1].file
const originalRealLazySize = fs.statSync(path.join(dist, actualDynamic[1].file)).size
const compiledWorker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')
assert(!compiledWorker.includes('"' + realLazyPath + '"'),
  'Selected dynamic chunk must NOT be in mandatory App Shell precache')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-p0b2-'))
const imageV1 = path.join(temp, 'image-v1')
const imageV2 = path.join(temp, 'image-v2')
const archive = path.join(temp, 'durable-assets')
fs.cpSync(assets, imageV1, { recursive: true })
fs.cpSync(assets, imageV2, { recursive: true })
fs.mkdirSync(archive)
const oldBody = "export const version = 'old-lazy-v1'\n"
const newBody = "export const version = 'new-lazy-v2'\n"
function hashedName(prefix, body) {
  return prefix + '-' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 10) + '.js'
}
const oldName = hashedName('pwa-b2-old-lazy', oldBody)
const newName = hashedName('pwa-b2-new-lazy', newBody)
fs.writeFileSync(path.join(imageV1, oldName), oldBody)
fs.writeFileSync(path.join(imageV2, newName), newBody)
const oldURL = '/assets/' + oldName
const newURL = '/assets/' + newName
let servedWorker = 1
let server
let browser
const observed = { assets: Object.create(null), missing: [], privateApi: 0, credentials: 0 }
const MIME = { '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' }
function seed(image) {
  const result = spawnSync('sh', [archiveScript, image, archive], { encoding: 'utf8' })
  assert.equal(result.status, 0, 'Real archive seeding failed: ' + result.stderr)
}
function safeFile(dir, relative) {
  let decoded
  try { decoded = decodeURIComponent(relative) } catch { return null }
  const absolute = path.resolve(dir, decoded)
  if (!absolute.startsWith(path.resolve(dir) + path.sep)) return null
  return absolute
}
function assetResponse(req, res, file, cacheControl, assetKey) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (assetKey) observed.missing.push(assetKey)
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' })
    res.end('public asset not found')
    return
  }
  if (assetKey) observed.assets[assetKey] = (observed.assets[assetKey] || 0) + 1
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' })
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file))
}
const app = http.createServer((req, res) => {
  let url
  try { url = new URL(req.url, 'http://localhost') }
  catch { res.writeHead(400); res.end(); return }
  if (req.headers.cookie || req.headers.authorization) observed.credentials++
  if (url.pathname.startsWith('/api/')) {
    observed.privateApi++
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"error":"fixture-unauthorized"}')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return
  }
  if (url.pathname === '/sw.js') {
    const messageProbe = '\nself.addEventListener("message",function(event){' +
      'if(event.data&&event.data.kind==="p0b2-version"&&event.ports[0])' +
      'event.ports[0].postMessage(' + servedWorker + ');});\n'
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate', 'X-Content-Type-Options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : compiledWorker + messageProbe)
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    const relative = url.pathname.slice('/assets/'.length)
    assetResponse(req, res, safeFile(archive, relative),
      'public, max-age=31536000, immutable', relative)
    return
  }
  const pathname = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
  assetResponse(req, res, safeFile(dist, pathname),
    url.pathname === '/' || url.pathname === '/index.html'
      ? 'no-cache, must-revalidate' : 'no-store', null)
})
async function waitForWorker(page, version, waiting) {
  await page.waitForFunction(async expected => {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.active || !navigator.serviceWorker.controller) return false
    if (expected.waiting !== Boolean(reg.waiting)) return false
    const probe = worker => !worker ? Promise.resolve(null) : new Promise(resolve => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(-1), 1500)
      channel.port1.onmessage = e => {
        clearTimeout(timer)
        channel.port1.close()
        resolve(e.data)
      }
      worker.postMessage({ kind: 'p0b2-version' }, [channel.port2])
    })
    return (await probe(reg.active)) === expected.version &&
      (await probe(navigator.serviceWorker.controller)) === expected.version &&
      (!expected.waiting || (await probe(reg.waiting)) === expected.waitingVersion)
  }, { version, waiting, waitingVersion: waiting ? (version === 1 ? 2 : 1) : null },
  { timeout: 30000 })
}
async function openControlled(context, origin) {
  const page = await context.newPage()
  const entry = await page.goto(origin + '/#/app/files', { waitUntil: 'domcontentloaded' })
  assert.equal(entry?.status(), 200, 'Production login App Shell document must load')
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'visible', timeout: 30000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  const refreshed = await page.reload({ waitUntil: 'domcontentloaded' })
  assert.equal(refreshed?.status(), 200, 'Reloaded production App Shell document must load')
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller),
    null, { timeout: 30000 })
  return page
}
async function inspectCache(page) {
  return page.evaluate(async () => {
    const result = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) result.push(new URL(request.url).pathname)
    }
    return result
  })
}
async function importVersion(page, url) {
  return page.evaluate(async pathname => (await import(pathname)).version, url)
}
async function runCase(origin, kind, mobile) {
  // Request counters are per browser context; do not reuse first-case hits.
  observed.assets[oldName] = 0
  observed.assets[newName] = 0
  fs.rmSync(archive, { recursive: true, force: true })
  fs.mkdirSync(archive)
  seed(imageV1)
  servedWorker = 1
  const context = await browser.newContext({ serviceWorkers: 'allow',
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) })
  try {
    let page = await openControlled(context, origin)
    await waitForWorker(page, 1, false)
    const oldRequestsBeforeUpgrade = observed.assets[oldName] || 0
    assert.equal(oldRequestsBeforeUpgrade, 0, 'Old lazy file must not have been fetched')
    // New image replaces the launch version; archive, not the image, serves assets.
    seed(imageV2)
    servedWorker = 2
    await page.evaluate(() => { window.__p0b2OriginalDocument = 'v1-document' })
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    await waitForWorker(page, 1, true)
    assert.equal(await importVersion(page, oldURL), 'old-lazy-v1')
    assert.equal(await importVersion(page, newURL), 'new-lazy-v2')
    assert.ok((observed.assets[oldName] || 0) > oldRequestsBeforeUpgrade,
      'Old lazy module must first hit the real HTTP asset archive AFTER upgrade')
    const actualLazy = await page.evaluate(async url => {
      const response = await fetch(url, { cache: 'reload', credentials: 'omit' })
      return { status: response.status, mime: response.headers.get('content-type'),
        size: (await response.arrayBuffer()).byteLength, redirected: response.redirected }
    }, realLazyPath)
    assert.equal(actualLazy.status, 200, 'Real compiled Vite lazy chunk remains served')
    assert.match(actualLazy.mime || '', /javascript/)
    assert.equal(actualLazy.size, originalRealLazySize)
    assert.equal(actualLazy.redirected, false)
    assert.equal(await page.evaluate(() => fetch('/api/v1/nodes/root').then(r => r.status)), 401)
    assert.equal(await page.evaluate(() => window.__p0b2OriginalDocument), 'v1-document')
    const bad = await page.evaluate(async () => {
      const response = await fetch('/assets/forgotten-ffffffff.js', { cache: 'reload' })
      return { status: response.status, mime: response.headers.get('content-type') }
    })
    assert.equal(bad.status, 404)
    assert.doesNotMatch(bad.mime || '', /text\/html/)
    const cacheURLs = await inspectCache(page)
    assert.ok(!cacheURLs.some(value => value.startsWith('/api/') ||
      value === oldURL || value === newURL), 'No private/lazy cache in public SW')
    await page.close()
    page = await openControlled(context, origin)
    await waitForWorker(page, 2, false)
    // Real archive is append-only even when the deployed image is rolled back.
    seed(imageV1)
    servedWorker = 1
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    await waitForWorker(page, 2, true)
    await page.close()
    page = await openControlled(context, origin)
    await waitForWorker(page, 1, false)
    assert.equal(await importVersion(page, oldURL), 'old-lazy-v1')
    assert.equal(await importVersion(page, newURL), 'new-lazy-v2')
    assert.equal(fs.readFileSync(path.join(archive, oldName), 'utf8'), oldBody)
    assert.equal(fs.readFileSync(path.join(archive, newName), 'utf8'), newBody)
    await page.close()
    return { case: kind, physicalDevice: false, twoIndependentBuilds: false,
      browser: 'Chromium', realViteLazyChunkTransport: true,
      archiveSeeding: true, oldLazyAfterUpgrade: true,
      waitingNoForcedReload: true, rollbackOldLazy: true,
      missingChunk404: true, privateNetworkOnly: true }
  } finally {
    await context.close()
  }
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  const summary = { schema: 'xdrive-pwa-old-lazy-p0b2a-v1',
    commit: process.env.XD_PR_HEAD || null, physicalDevice: false,
    twoIndependentBuilds: false, cases: [], passed: false }
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox'] })
    await new Promise((resolve, reject) => {
      app.once('error', reject)
      app.listen(0, '127.0.0.1', resolve)
    })
    const origin = 'http://127.0.0.1:' + app.address().port
    summary.cases.push(await runCase(origin, 'desktop-chromium', false))
    summary.cases.push(await runCase(origin, 'mobile-390px-emulation', true))
    assert.equal(observed.credentials, 0, 'Public fixture must not receive credentials')
    assert.ok(observed.privateApi > 0)
    summary.passed = true
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log(JSON.stringify(summary))
  } catch (error) {
    summary.error = String(error && error.message || error).slice(0, 500)
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.error(summary.error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => app.listening ? app.close(resolve) : resolve())
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
void main()
