#!/usr/bin/env node
'use strict'
// P1-B2 real Chromium persistent-profile IndexedDB relaunch. This test
// starts two independent Chrome processes with one on-disk profile. It does
// not claim an installed iOS PWA, live ACL E2E, or offline new-process shell.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const ts = require(path.resolve(__dirname, '../../web/node_modules/typescript'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')

const sourcePath = path.resolve(__dirname, '../../web/src/pwaOfflineDirectory.ts')
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const browserBinary = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(browserBinary && fs.existsSync(browserBinary), 'Real Chrome/Chromium binary is required')
const server = http.createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end('Not Found'); return }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
  res.end('<!doctype html><title>xDrive P1-B2 public browser harness</title>')
})
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-b2-'))

async function run() {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  const launch = () => chromium.launchPersistentContext(profileDir, {
    headless: true, executablePath: browserBinary, viewport: { width: 390, height: 844 },
  })
  const attach = async ctx => {
    const page = await ctx.newPage()
    await page.goto(origin + '/')
    await page.addScriptTag({ content: '(function(){ var exports = {};\n' + transpiled +
      '\nwindow.xDriveOfflineTest = exports; })();' })
    return page
  }
  let ctx
  try {
    ctx = await launch()
    const first = await attach(ctx)
    const recorded = await first.evaluate(async () => {
      const store = window.xDriveOfflineTest
      const owner = {
        origin: location.origin, userID: 27, username: 'saved-owner',
        instanceID: '11111111-1111-4111-8111-111111111111',
      }
      if (await store.xDrivePwaReadRelaunchOwner() !== null) {
        throw new Error('owner restored without opt-in')
      }
      await store.xDrivePwaSetOfflineConsent(owner, true)
      const input = {
        id: 1234, name: 'last-visited',
        totalCount: 100000,
        items: Array.from({ length: 100000 }, (_, i) => ({
          id: i + 1, type: 'file', name: 'item-' + i, revision: 1,
          access_token: 'NEVER_STORE_TOKEN', exif: { gps: 'PRIVATE' },
        })),
      }
      if (!await store.xDrivePwaCaptureVisitedDirectory(owner, input)) {
        throw new Error('consented 100k first range was not captured')
      }
      const hint = await store.xDrivePwaReadRelaunchOwner()
      if (!hint || hint.instanceID !== owner.instanceID || hint.userID !== owner.userID) {
        throw new Error('saved hint differs from verified origin and owner')
      }
      window.offlineOwner = owner
      return { total: input.items.length, bounded: (await store.xDrivePwaReadOfflineDirectories(owner))
        .directories[0].items.length }
    })
    assert.deepEqual(recorded, { total: 100000, bounded: 20 })
    await ctx.close()
    ctx = null

    // A genuine separate browser process: previous JS globals are gone.
    ctx = await launch()
    const second = await attach(ctx)
    await ctx.setOffline(true)
    const restored = await second.evaluate(async () => {
      const api = window.xDriveOfflineTest
      const owner = await api.xDrivePwaReadRelaunchOwner()
      if (!owner) throw new Error('persistent-profile owner hint missing')
      const saved = await api.xDrivePwaReadOfflineDirectories(owner)
      if (!saved.consented || saved.revalidated !== false || saved.directories.length !== 1 ||
          saved.directories[0].items.length !== 20 || saved.directories[0].partial !== true ||
          saved.directories[0].totalCount !== 100000) throw new Error('stale snapshot became live')
      const otherInstance = {
        ...owner, instanceID: '22222222-2222-4222-8222-222222222222',
      }
      const mismatch = api.xDrivePwaVerifiedIdentityMatches(owner, {
        id: owner.userID, username: owner.username, pwa_offline_instance_id: otherInstance.instanceID,
      })
      const denied = await api.xDrivePwaReadOfflineDirectories(otherInstance)
      if (mismatch || denied.consented || denied.directories.length) {
        throw new Error('cross-instance snapshot privilege confusion')
      }
      if (JSON.stringify(saved).includes('NEVER_STORE_TOKEN') ||
          JSON.stringify(saved).includes('PRIVATE')) throw new Error('private Node leaked')
      return { historicalOnly: true, items: saved.directories[0].items.length, owner }
    })
    assert.equal(restored.items, 20)
    await ctx.setOffline(false)
    const cleared = await second.evaluate(async () => {
      const api = window.xDriveOfflineTest
      const owner = await api.xDrivePwaReadRelaunchOwner()
      const cache = await caches.open('p1b2-public-shell-test-sentinel')
      await cache.put('/p1b2-public', new Response('only-public'))
      await api.xDrivePwaSetOfflineConsent(owner, false)
      const afterDisable = await api.xDrivePwaReadRelaunchOwner()
      const disabled = await api.xDrivePwaReadOfflineDirectories(owner)
      if (afterDisable || disabled.consented) throw new Error('disabled scope still readable')
      await api.xDrivePwaSetOfflineConsent(owner, true)
      await api.xDrivePwaClearOfflineMetadata()
      const afterLogout = await api.xDrivePwaReadRelaunchOwner()
      const retained = await cache.match('/p1b2-public')
      return { hintCleared: afterLogout === null, publicCachePreserved: retained &&
        await retained.text() === 'only-public' }
    })
    assert.deepEqual(cleared, { hintCleared: true, publicCachePreserved: true })
    console.log('PWA_P1B2_REAL_CHROME ' + JSON.stringify({
      head: process.env.XD_PR_HEAD || null, chrome: ctx.browser()?.version() || 'unknown',
      twoBrowserProcesses: true, persistentProfile: true, logicalRows: 100000,
      offlineHistoricalItems: restored.items, staleFlag: restored.historicalOnly,
      crossInstanceRejected: true, consentRevocation: true, logoutPurge: cleared.hintCleared,
      publicShellPreserved: cleared.publicCachePreserved, physicalIOS: false,
      installedOfflineRelaunchE2E: false, performanceAfter: null,
    }))
  } finally {
    if (ctx) await ctx.close()
  }
}
run().catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => { server.close(); fs.rmSync(profileDir, { recursive: true, force: true }) })
