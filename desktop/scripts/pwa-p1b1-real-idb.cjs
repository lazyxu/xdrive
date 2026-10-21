#!/usr/bin/env node
'use strict'
// P1-B1: real Chromium IndexedDB and opt-in privacy regression. The loopback
// page deliberately has no authenticated Web App or production file API.
// This is a browser storage test, NOT an iOS Safari or offline ACL proof.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require(path.resolve(__dirname, '../../web/node_modules/typescript'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const sourcePath = path.resolve(__dirname, '../../web/src/pwaOfflineDirectory.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const browserBinary = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(browserBinary && fs.existsSync(browserBinary), 'Real Chromium executable required')

const webServer = http.createServer((request, response) => {
  if (request.url !== '/') {
    response.writeHead(404)
    response.end('Not Found')
    return
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end('<!doctype html><html><head><title>xDrive P1 IndexedDB fixture</title></head><body>public test only</body></html>')
})

async function main() {
  await new Promise((resolve, reject) => {
    webServer.once('error', reject)
    webServer.listen(0, '127.0.0.1', resolve)
  })
  const address = webServer.address()
  const url = 'http://127.0.0.1:' + address.port + '/'
  const browser = await chromium.launch({ headless: true, executablePath: browserBinary })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const attach = async target => {
      await target.goto(url)
      await target.addScriptTag({
        content: '(function(){ var exports = {};\n' + transpiled +
          '\nwindow.xDriveOfflineTest = exports; })();',
      })
    }
    await attach(page)
    const outcome = await page.evaluate(async () => {
      const api = window.xDriveOfflineTest
      const instanceA = '11111111-1111-4111-8111-111111111111'
      const instanceB = '22222222-2222-4222-8222-222222222222'
      const owner = { origin: location.origin, userID: 9, username: 'idb-test', instanceID: instanceA }
      const alternateServer = { ...owner, instanceID: instanceB }
      const otherOwner = { ...owner, userID: 10 }
      if (!api.xDrivePwaOfflineAvailable()) throw new Error('secure-loopback IndexedDB unavailable')
      const first = await api.xDrivePwaReadOfflineDirectories(owner)
      if (first.consented || first.directories.length) throw new Error('cache auto-enabled without consent')
      const input = {
        id: 333, name: 'Visited',
        totalCount: 100000,
        items: Array.from({ length: 100000 }, (_, n) => ({
          id: n + 1, type: 'file', name: 'Item ' + n, size: 55, revision: 7,
          token: 'SECRET_TOKEN_DO_NOT_PERSIST', sha256: 'SECRET_HASH',
          media: { exif: 'PRIVATE_EXIF' },
        })),
      }
      if (await api.xDrivePwaCaptureVisitedDirectory(owner, input)) {
        throw new Error('capture without opt-in was accepted')
      }
      await api.xDrivePwaSetOfflineConsent(owner, true)
      if (!await api.xDrivePwaCaptureVisitedDirectory(owner, input)) {
        throw new Error('verified opt-in capture did not persist')
      }
      const saved = await api.xDrivePwaReadOfflineDirectories(owner)
      const foreign = await api.xDrivePwaReadOfflineDirectories(alternateServer)
      const foreignAccount = await api.xDrivePwaReadOfflineDirectories(otherOwner)
      if (!saved.consented || saved.revalidated !== false ||
          saved.directories.length !== 1 || saved.directories[0].items.length !== 20 ||
          saved.directories[0].totalCount !== 100000 || !saved.directories[0].partial) {
        throw new Error('partial read-only snapshot shape wrong')
      }
      if (foreign.consented || foreign.directories.length ||
          foreignAccount.consented || foreignAccount.directories.length) {
        throw new Error('Server or Owner scope crossover')
      }
      if (/SECRET_TOKEN|SECRET_HASH|PRIVATE_EXIF/.test(JSON.stringify(saved))) {
        throw new Error('private raw fields were persisted')
      }
      if (!('caches' in window)) throw new Error('CacheStorage unavailable')
      const publicCache = await caches.open('p1b1-public-app-shell-sentinel')
      await publicCache.put('/p1b1-public-sentinel', new Response('public-only'))
      window.pwaIDBOwner = owner
      return { consent: saved.consented, items: saved.directories[0].items.length, originalCount: 100000 }
    })
    assert.equal(outcome.items, 20)

    // The account-scoped data remains readable without network, but it never
    // becomes verified live ACL or a full FileExplorer service.
    await context.setOffline(true)
    const offline = await page.evaluate(async () => {
      const r = await window.xDriveOfflineTest.xDrivePwaReadOfflineDirectories(window.pwaIDBOwner)
      return { historicalOnly: r.revalidated === false, entries: r.directories[0]?.items.length ?? 0 }
    })
    assert.deepEqual(offline, { historicalOnly: true, entries: 20 })
    await context.setOffline(false)

    // A second physical browser tab sees a non-sensitive clear notification.
    const peer = await context.newPage()
    await attach(peer)
    await peer.evaluate(() => {
      window.pwaPurgeCount = 0
      window.pwaStopPurge = window.xDriveOfflineTest.xDrivePwaObserveOfflinePurge(() => { window.pwaPurgeCount++ })
    })
    const result = await page.evaluate(async () => {
      await window.xDriveOfflineTest.xDrivePwaClearOfflineMetadata()
      const after = await window.xDriveOfflineTest.xDrivePwaReadOfflineDirectories(window.pwaIDBOwner)
      const publicCache = await caches.open('p1b1-public-app-shell-sentinel')
      const kept = await publicCache.match('/p1b1-public-sentinel')
      return {
        consent: after.consented, directories: after.directories.length,
        publicShellPreserved: Boolean(kept && await kept.text() === 'public-only'),
      }
    })
    assert.deepEqual(result, { consent: false, directories: 0, publicShellPreserved: true })
    await peer.waitForFunction(() => window.pwaPurgeCount > 0, null, { timeout: 3000 })
    await peer.evaluate(() => window.pwaStopPurge())
    await peer.close()
    await page.close()
    await context.close()
    console.log('PWA_P1B1_REAL_IDB ' + JSON.stringify({
      sha: process.env.XD_PR_HEAD || null, browser: browser.version(),
      secureContext: true, optIn: true, totalItems: outcome.originalCount,
      storedItems: outcome.items, offlineHistoricalOnly: offline.historicalOnly,
      crossInstanceOwnerDenied: true, crossTabPurge: true,
      publicSWCacheUntouched: result.publicShellPreserved,
      physicalIOS: false, performanceAfterClaim: false,
    }))
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => webServer.close())
