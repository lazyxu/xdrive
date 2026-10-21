#!/usr/bin/env node
'use strict'
// B2b2b-1: keep ONE real browser JWT/Owner against the SAME PostgreSQL and
// physical CAS while genuine Caddy reloads between TWO running cmd/server
// binaries compiled from different, immutable source SHAs.
// No API mocks, no background transfer claim, no production credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const out = process.env.XD_PWA_B2B2B1_OUTPUT
const common = process.env.XD_PWA_B2B2B1_CADDY_COMMON
const port = process.env.XD_PWA_B2B2B1_CADDY_PORT
const goA = process.env.XD_PWA_B2B2B1_A_PORT
const goB = process.env.XD_PWA_B2B2B1_B_PORT
const container = process.env.XD_PWA_B2B2B1_CADDY_NAME
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
const aDist = process.env.XD_PWA_B2B2B1_A_DIST
const bDist = process.env.XD_PWA_B2B2B1_B_DIST
const aSha = process.env.XD_PWA_B2B2B1_A_SHA
const bSha = process.env.XD_PWA_B2B2B1_B_SHA
assert([out, common, port, goA, goB, container, chrome, aDist, bDist, aSha, bSha].every(Boolean))
assert(/^[a-f0-9]{40}$/.test(aSha) && /^[a-f0-9]{40}$/.test(bSha) && aSha !== bSha)
assert(fs.existsSync(chrome))
const origin = 'http://127.0.0.1:' + port
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const summary = {
  schema: 'xdrive-pwa-b2b2b1-real-caddy-shared-session-v1',
  sourceA: aSha, sourceB: bSha, actualCmdServerAB: true,
  actualCaddyReload: false, samePostgresAndCAS: true,
  originalJWTReused: false, sameOwnerAndFolder: false,
  realBrowserApp: true, realUploadDuringSwitch: false,
  oldSWHeldWaiting: false, physicalIOS: false,
  passes: [], passed: false
}
fs.mkdirSync(out, { recursive: true })
function failClosed(result, label) {
  assert.equal(result.status, 0, label + ' process failed')
}
function configure(upstream) {
  assert([goA, goB].includes(String(upstream)))
  const original = fs.readFileSync(common, 'utf8')
  assert(/reverse_proxy 127\.0\.0\.1:\d+/.test(original))
  // Rewrite an existing bind-mounted inode, then invoke Caddy's REAL admin
  // reload command. Only a locally generated test config is ever modified.
  const next = original.replace(/reverse_proxy 127\.0\.0\.1:\d+/g,
    'reverse_proxy 127.0.0.1:' + upstream)
  assert.notEqual(original, next, 'real Caddy upstream must actually change')
  fs.writeFileSync(common, next)
  failClosed(spawnSync('docker', ['exec', container, 'caddy', 'reload',
    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
  { encoding: 'utf8', timeout: 20000 }), 'real caddy reload')
}
async function requestVersion(ctx, expected) {
  for (let i = 0; i < 30; i++) {
    const r = await ctx.request.get(origin + '/api/v1/version', { timeout: 2500 })
      .catch(() => null)
    if (r && r.status() === 200) {
      const body = await r.json()
      if (body.version === expected) return body.version
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Caddy never served the expected independently compiled Go build: ' + expected)
}
async function ownerSnapshot(page, oldFolder) {
  return page.evaluate(async expectedFolder => {
    const token = localStorage.getItem('xdrive.access_token')
    if (!token || token.length < 16) return { status: 0 }
    const opts = { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }
    const root = await fetch('/api/v1/nodes/root', opts)
    const me = await fetch('/api/v1/me', opts)
    const body = root.ok ? await root.json() : {}
    const user = me.ok ? await me.json() : {}
    const folder = expectedFolder
      ? await fetch('/api/v1/nodes/' + expectedFolder, opts) : null
    return { token, rootStatus: root.status, meStatus: me.status,
      folderStatus: folder?.status || null,
      rootId: body.id, userId: user.id }
  }, oldFolder)
}
function lazy(pathname) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pathname, '.vite/manifest.json'), 'utf8'))
  const candidates = Object.values(manifest).filter(v =>
    v.isDynamicEntry && /^assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.js$/.test(v.file || ''))
  assert(candidates.length)
  const file = candidates[0].file
  const bytes = fs.readFileSync(path.join(pathname, file))
  return { url: '/' + file, hash: digest(bytes), size: bytes.length }
}
async function main() {
  let browser
  try {
    const archived = [lazy(aDist), lazy(bDist)]
    browser = await chromium.launch({ executablePath: chrome, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({ serviceWorkers: 'allow',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    const initialVersion = 'pwa-b2b2b1-A'
    const targetVersion = 'pwa-b2b2b1-B'
    assert.equal(await requestVersion(context, initialVersion), initialVersion)
    for (const asset of archived) {
      const res = await context.request.get(origin + asset.url)
      assert.equal(res.status(), 200)
      assert.match(res.headers()['cache-control'] || '', /immutable/)
      assert.match(res.headers()['content-type'] || '', /javascript|ecmascript/)
      const data = await res.body()
      assert.equal(data.length, asset.size)
      assert.equal(digest(data), asset.hash)
    }
    const unknown = await context.request.get(origin + '/assets/pwa-nonexistent-ffffffff.js')
    assert.equal(unknown.status(), 404)
    assert.doesNotMatch(unknown.headers()['content-type'] || '', /html/)
    const original = await page.goto(origin + '/#/app/files', { waitUntil: 'commit' })
    assert.equal(original?.status(), 200)
    await page.locator('#web-login-username').waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('#web-login-username').fill('pwa-b2b2b1-owner')
    await page.locator('#web-login-password').fill('Pwa-B2b2b1-Synthetic-Only_2026!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForFunction(() => {
      const token = localStorage.getItem('xdrive.access_token')
      return typeof token === 'string' && token.length > 16
    }, null, { timeout: 30000 })
    const first = await ownerSnapshot(page)
    assert.equal(first.rootStatus, 200)
    assert.equal(first.meStatus, 200)
    assert(Number.isSafeInteger(first.rootId) && first.rootId > 0)
    assert(Number.isSafeInteger(first.userId) && first.userId > 0)
    const creation = await page.evaluate(async parent => {
      const token = localStorage.getItem('xdrive.access_token')
      const response = await fetch('/api/v1/nodes/' + parent + '/directories', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'pwa-b2b2b1-persistent-folder' })
      })
      return { status: response.status, body: response.ok ? await response.json() : null }
    }, first.rootId)
    assert.equal(creation.status, 201)
    assert(Number.isSafeInteger(creation.body?.id) && creation.body.id > 0)
    const folderId = creation.body.id
    const before = await ownerSnapshot(page, folderId)
    assert.equal(before.folderStatus, 200)
    await page.evaluate(() => { document.documentElement.dataset.pwaB2b2b1Held = 'original-document' })
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload({ waitUntil: 'commit' })
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const oldController = await page.evaluate(() =>
      navigator.serviceWorker.controller?.scriptURL || '')
    assert(oldController.endsWith('/sw.js'))
    const held = await ownerSnapshot(page, folderId)
    assert.equal(held.folderStatus, 200)
    // The external native controller, not the browser, switches actual Caddy.
    configure(goB)
    assert.equal(await requestVersion(context, targetVersion), targetVersion)
    const after = await ownerSnapshot(page, folderId)
    assert.equal(after.rootStatus, 200)
    assert.equal(after.meStatus, 200)
    assert.equal(after.folderStatus, 200)
    assert.equal(after.token, held.token, 'same JWT used across two real Go processes')
    assert.equal(after.rootId, held.rootId)
    assert.equal(after.userId, held.userId)
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL), oldController)
    configure(goA)
    assert.equal(await requestVersion(context, initialVersion), initialVersion)
    const rollback = await ownerSnapshot(page, folderId)
    assert.equal(rollback.folderStatus, 200)
    assert.equal(rollback.token, held.token)
    assert.equal(rollback.rootId, held.rootId)
    assert.equal(rollback.userId, held.userId)
    summary.actualCaddyReload = true
    summary.originalJWTReused = true
    summary.sameOwnerAndFolder = true
    summary.passes.push({ scenario: 'A-to-B-to-A-one-JWT', actualVersions: true,
      originalOwnerPreserved: true, originalFolder200: true,
      archivedAandBLazySHA256: true, cachePrivateData: false })
    summary.passed = true
    console.log('PWA_B2B2B1_SHARED_SESSION_CADDY_GO_ABA_VERIFIED')
    await context.close()
  } catch (error) {
    // Never serialize the live browser JWT, Caddy auth headers or file contents.
    summary.errorCode = (error?.name || 'Error').replace(/[^A-Za-z0-9]/g, '').slice(0, 40)
    console.error('PWA_B2B2B1_FAIL: ' + summary.errorCode)
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    await browser?.close()
  }
}
void main()
