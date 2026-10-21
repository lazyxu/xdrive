#!/usr/bin/env node
'use strict'
// P0-B2b1: two INDEPENDENT production Vite builds from different real Git SHAs.
// The public HTTP fixture mirrors the existing Caddy headers and /assets 404,
// but does not claim to execute Caddy/Go or prove real Server API version skew.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const root = path.resolve(__dirname, '../..')
const aDist = path.resolve(process.env.XD_PWA_B2B_A_DIST || '')
const bDist = path.resolve(process.env.XD_PWA_B2B_B_DIST || '')
const aSource = process.env.XD_PWA_B2B_A_SHA || ''
const bSource = process.env.XD_PWA_B2B_B_SHA || ''
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
const archiveScript = path.join(root, 'deploy/pwa-archive-assets.sh')
const output = path.resolve(process.env.XD_PWA_B2B_RESULT_DIR ||
  path.join(root, 'desktop/pwa-b2b1-results'))
assert(/^[0-9a-f]{40}$/.test(aSource) && /^[0-9a-f]{40}$/.test(bSource) &&
  aSource !== bSource, 'Require two distinct immutable Git source SHAs')
assert(chrome && fs.existsSync(chrome), 'Real Chromium/Chrome executable required')
assert(fs.existsSync(archiveScript), 'Actual POSIX PWA public archive required')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function release(id, source, dist) {
  assert(fs.existsSync(path.join(dist, 'index.html')), id + ': real production index absent')
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
  const entries = Object.values(manifest).filter(entry => entry.isEntry)
  assert.equal(entries.length, 1, id + ': require one genuine Vite app entry')
  const entry = entries[0].file
  assert(/^assets\/[\w./-]+-[\w-]{6,}\.js$/.test(entry), id + ': invalid entry')
  const candidates = Object.entries(manifest).filter(([, v]) =>
    v.isDynamicEntry && /^assets\/[\w./-]+-[\w-]{6,}\.js$/.test(v.file || ''))
  assert(candidates.length > 0, id + ': no real dynamic chunks')
  const lazy = candidates.sort(([x], [y]) =>
    Number(/PwaInstallDialog/i.test(y)) - Number(/PwaInstallDialog/i.test(x)))[0][1].file
  const worker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8')
  const revision = worker.match(/const SHELL_REVISION = '([0-9a-f]{20})'/)?.[1]
  assert(revision, id + ': no actual revisioned production SW')
  assert(!worker.includes(JSON.stringify('/' + lazy)),
    id + ': selected dynamic chunk is unexpectedly in mandatory SW precache')
  const entryBytes = fs.readFileSync(path.join(dist, entry))
  const lazyBytes = fs.readFileSync(path.join(dist, lazy))
  assert(entryBytes.length && lazyBytes.length, id + ': empty build chunks')
  return { id, source, dist, manifest, entry, lazy, revision, worker,
    entryDigest: hash(entryBytes), lazyDigest: hash(lazyBytes), lazySize: lazyBytes.length }
}
const a = release('A', aSource, aDist)
const b = release('B', bSource, bDist)
assert.notEqual(a.revision, b.revision, 'Two actual release SW revisions must differ')
assert.notEqual(a.entryDigest, b.entryDigest, 'Two actual compiled app entries must differ')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-b2b1-'))
const archive = path.join(work, 'public-immutable-assets')
fs.mkdirSync(archive)
const versions = { A: a, B: b }
let active = a
let browser
const observed = { assets: Object.create(null), privateRequests: 0, credentials: 0,
  documents: 0, workers: 0, staticAssets: 0, browserEvents: [], preflight: null }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp',
  '.avif': 'image/avif', '.wasm': 'application/wasm' }
function seed(rel) {
  const result = spawnSync('sh', [archiveScript, path.join(rel.dist, 'assets'), archive],
    { encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, 'Real archived build failed: ' + result.stderr)
}
function localFile(dir, name) {
  let decoded
  try { decoded = decodeURIComponent(name) } catch { return null }
  const rootDir = path.resolve(dir)
  const file = path.resolve(rootDir, decoded)
  return file.startsWith(rootDir + path.sep) ? file : null
}
function serveFile(req, res, file, cacheControl, assetName) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' })
    res.end('not found')
    return
  }
  if (assetName) observed.assets[assetName] = (observed.assets[assetName] || 0) + 1
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' })
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file))
}
const server = http.createServer((req, res) => {
  let target
  try { target = new URL(req.url, 'http://localhost') }
  catch { res.writeHead(400); res.end(); return }
  if (req.headers.cookie || req.headers.authorization) observed.credentials++
  if (target.pathname === '/' || target.pathname === '/index.html') observed.documents++
  if (target.pathname === '/sw.js') observed.workers++
  if (target.pathname.startsWith('/assets/')) observed.staticAssets++
  if (target.pathname.startsWith('/api/')) {
    observed.privateRequests++
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"error":"unauthenticated-private-fixture"}')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return
  }
  if (target.pathname.startsWith('/assets/')) {
    const name = target.pathname.slice('/assets/'.length)
    serveFile(req, res, localFile(archive, name),
      'public, max-age=31536000, immutable', name)
    return
  }
  const requested = target.pathname === '/' ? 'index.html' : target.pathname.slice(1)
  serveFile(req, res, localFile(active.dist, requested),
    target.pathname === '/' || target.pathname === '/index.html' ||
    target.pathname === '/sw.js' || target.pathname === '/site.webmanifest'
      ? 'no-cache, must-revalidate' : 'no-store', null)
})
async function openControlled(context, origin) {
  const page = await context.newPage()
  // Transport-only diagnostics. Paths are from this local synthetic PUBLIC
  // fixture; never store full URLs, query strings, headers or user credentials.
  for (const kind of ['request', 'response', 'requestfailed']) {
    page.on(kind, event => {
      try {
        const url = new URL(event.url())
        if (url.origin === origin && observed.browserEvents.length < 18)
          observed.browserEvents.push({ kind, path: url.pathname,
            ...(kind === 'response' ? { status: event.status() } : {}) })
      } catch {}
    })
  }
  const initial = await page.goto(origin + '/#/app/files', { waitUntil: 'commit' })
  assert.equal(initial?.status(), 200, 'Real production app HTML required')
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'visible', timeout: 30000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  const reload = await page.reload({ waitUntil: 'commit' })
  assert.equal(reload?.status(), 200)
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null,
    { timeout: 30000 })
  return page
}
async function waitActive(page, version) {
  await page.waitForFunction(async targetRevision => {
    const reg = await navigator.serviceWorker.getRegistration()
    const keys = await caches.keys()
    return Boolean(reg?.active && !reg.waiting && navigator.serviceWorker.controller) &&
      keys.includes('xdrive-pwa-public-shell-' + targetRevision) &&
      !keys.some(k => k.startsWith('xdrive-pwa-public-shell-') &&
        k !== 'xdrive-pwa-public-shell-' + targetRevision)
  }, version.revision, { timeout: 30000 })
}
async function waitWaiting(page, oldVersion, newVersion) {
  await page.waitForFunction(async values => {
    const reg = await navigator.serviceWorker.getRegistration()
    const keys = await caches.keys()
    return Boolean(reg?.active && reg.waiting &&
      navigator.serviceWorker.controller === reg.active) &&
      keys.includes('xdrive-pwa-public-shell-' + values.old) &&
      keys.includes('xdrive-pwa-public-shell-' + values.next)
  }, { old: oldVersion.revision, next: newVersion.revision }, { timeout: 30000 })
}
async function realLazy(page, version, before) {
  const result = await page.evaluate(async file => {
    const response = await fetch('/' + file, { cache: 'reload', credentials: 'omit' })
    const buffer = await response.arrayBuffer()
    const sha = await crypto.subtle.digest('SHA-256', buffer)
    const digest = Array.from(new Uint8Array(sha)).map(n =>
      n.toString(16).padStart(2, '0')).join('')
    return { status: response.status, mime: response.headers.get('content-type'),
      cache: response.headers.get('cache-control'), size: buffer.byteLength,
      redirected: response.redirected, digest }
  }, version.lazy)
  assert.equal(result.status, 200)
  assert.match(result.mime || '', /javascript/)
  assert.match(result.cache || '', /immutable/)
  assert.equal(result.size, version.lazySize)
  assert.equal(result.digest, version.lazyDigest)
  assert.equal(result.redirected, false)
  assert.ok((observed.assets[version.lazy.slice('assets/'.length)] || 0) > before,
    version.id + ': first genuine lazy HTTP read must reach archive after release change')
  const module = await page.evaluate(async file => await import('/' + file).then(m =>
    Object.keys(m).length), version.lazy)
  assert.ok(module > 0, version.id + ': real compiled ESM must execute in Chromium')
  return result
}
async function cacheIsPublic(page, from, to) {
  const paths = await page.evaluate(async () => {
    const result = []
    for (const key of await caches.keys()) {
      const cache = await caches.open(key)
      for (const request of await cache.keys()) result.push(new URL(request.url).pathname)
    }
    return result
  })
  assert.ok(paths.includes('/index.html'), 'App Shell must exist in public SW cache')
  assert.ok(!paths.some(url => url.startsWith('/api/') ||
    url === '/' + from.lazy || url === '/' + to.lazy),
  'Private URL or real lazy entry must not be pre-cached')
}
async function runScenario(origin, initial, target, label) {
  active = initial
  const context = await browser.newContext({
    serviceWorkers: 'allow', viewport: label === 'rollback' ?
      { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(label === 'rollback' ? { isMobile: true, hasTouch: true } : {}) })
  try {
    let page = await openControlled(context, origin)
    await waitActive(page, initial)
    const count = observed.assets[initial.lazy.slice('assets/'.length)] || 0
    // Browser did not request the non-preloaded lazy chunk in this context.
    await page.evaluate(() => { window.__xdriveB2bHeldClient = 'old-controller' })
    seed(target)
    active = target
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    await waitWaiting(page, initial, target)
    assert.equal(await page.evaluate(() => window.__xdriveB2bHeldClient), 'old-controller')
    const oldLazy = await realLazy(page, initial, count)
    assert.equal(await page.evaluate(() => fetch('/api/v1/nodes/root').then(r => r.status)), 401)
    const missing = await page.evaluate(async () => {
      const response = await fetch('/assets/not-present-b2b1-ffffffff.js',
        { cache: 'reload', credentials: 'omit' })
      return { status: response.status, mime: response.headers.get('content-type') }
    })
    assert.equal(missing.status, 404)
    assert.doesNotMatch(missing.mime || '', /html/)
    await cacheIsPublic(page, initial, target)
    await page.close()
    page = await openControlled(context, origin)
    await waitActive(page, target)
    const nextCount = observed.assets[target.lazy.slice('assets/'.length)] || 0
    const nextLazy = await realLazy(page, target, nextCount)
    await cacheIsPublic(page, initial, target)
    await page.close()
    return { scenario: label, initial: initial.source, deployed: target.source,
      realBuilds: true, realManifestLazyESM: true, liveOldSWWaiting: true,
      noForcedReload: true, oldLazySHA256: oldLazy.digest, newLazySHA256: nextLazy.digest,
      privateNetworkOnly: true, missingAsset404: true, physicalIOS: false }
  } finally {
    await context.close()
  }
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  const summary = { schema: 'xdrive-pwa-two-real-web-releases-b2b1-v1',
    sourceA: a.source, sourceB: b.source, revisionA: a.revision,
    revisionB: b.revision, independentProductionWebBuilds: true,
    distinctActualLazySHA256: a.lazyDigest !== b.lazyDigest,
    actualGoServerVersions: false, actualCaddyBinary: false,
    physicalIOS: false, cases: [], passed: false }
  try {
    seed(a)
    browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox'] })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const origin = 'http://127.0.0.1:' + server.address().port
    // Separate Node HTTP admission from Chrome navigation. The test fails
    // closed if the local fixture itself cannot serve real release HTML.
    observed.preflight = await new Promise((resolve, reject) => {
      const probe = http.get(origin + '/index.html', response => {
        response.resume()
        response.once('end', () => resolve({
          status: response.statusCode,
          mime: response.headers['content-type'] || '',
        }))
      })
      probe.setTimeout(5000, () => probe.destroy(new Error('HTTP fixture preflight timeout')))
      probe.on('error', reject)
    })
    assert.equal(observed.preflight.status, 200)
    assert.ok(observed.preflight.mime.startsWith('text/html'))
    summary.cases.push(await runScenario(origin, a, b, 'upgrade'))
    summary.cases.push(await runScenario(origin, b, a, 'rollback'))
    assert.equal(observed.credentials, 0, 'Public fixture must remain anonymous')
    assert.ok(observed.privateRequests >= 2)
    for (const item of [a, b]) {
      const archived = fs.readFileSync(path.join(archive, item.lazy.slice('assets/'.length)))
      assert.equal(hash(archived), item.lazyDigest, item.id + ': archived bytes changed')
    }
    summary.passed = true
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log(JSON.stringify(summary))
  } catch (error) {
    summary.error = String(error?.stack || error).slice(0, 900)
    summary.diagnostics = observed
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.error(summary.error)
    console.error(JSON.stringify({ httpPreflight: observed.preflight, documents: observed.documents,
      workers: observed.workers, staticAssets: observed.staticAssets,
      browserEvents: observed.browserEvents }))
    process.exitCode = 1
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve())
    fs.rmSync(work, { recursive: true, force: true })
  }
}
void main()
