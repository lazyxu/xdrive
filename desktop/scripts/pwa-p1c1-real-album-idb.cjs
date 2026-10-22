#!/usr/bin/env node
'use strict'
// P1-C1: genuine persistent Chromium IndexedDB album projection. No iOS/WAN
// claim and no authenticated real-Go media service in this isolated fixture.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const ts = require(path.resolve(__dirname, '../../web/node_modules/typescript'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/pwaOfflineDirectory.ts'), 'utf8')
const script = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const binary = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(binary && fs.existsSync(binary), 'Real Chromium executable required')
const webServer = http.createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end('Not Found'); return }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
  res.end('<!doctype html><title>xDrive P1-C1 public Chrome fixture</title>')
})
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-p1c1-'))
async function main() {
  await new Promise((resolve, reject) => {
    webServer.once('error', reject)
    webServer.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + webServer.address().port
  const launch = () => chromium.launchPersistentContext(profile, {
    executablePath: binary, headless: true, viewport: { width: 390, height: 844 },
  })
  const attach = async ctx => {
    const page = await ctx.newPage()
    await page.goto(origin + '/')
    await page.addScriptTag({
      content: '(function(){ var exports={};\n' + script +
        '\nwindow.xDriveP1C1=exports; })();',
    })
    return page
  }
  let ctx = null
  try {
    ctx = await launch()
    const first = await attach(ctx)
    const seeded = await first.evaluate(async () => {
      const api = window.xDriveP1C1
      const owner = {
        origin: location.origin, instanceID: '11111111-1111-4111-8111-111111111111',
        userID: 38, username: 'album-owner',
      }
      const input = Array.from({ length: 100000 }, (_, n) => ({
        id: 'album-' + n, name: 'Album ' + n,
        kind: 'manual', item_count: 100000, revision: 7,
        cover_node_id: n + 1000, token: 'SECRET_CANARY',
        query: { has_location: true, gps: 'SECRET_GPS' },
      }))
      if (await api.xDrivePwaCaptureAlbumSummaries(owner, input)) {
        throw new Error('album snapshot accepted before consent')
      }
      await api.xDrivePwaSetOfflineConsent(owner, true)
      if (!await api.xDrivePwaCaptureAlbumSummaries(owner, input)) {
        throw new Error('consented album projection write rejected')
      }
      // Coexist with folder snapshots in the same account record.
      await api.xDrivePwaCaptureVisitedDirectory(owner, {
        id: 73, name: 'Visited', totalCount: 100000, items: [
          { id: 8, type: 'file', name: 'JPEG.jpg', revision: 3 },
        ],
      })
      const read = await api.xDrivePwaReadAlbumSummaries(owner)
      const dirs = await api.xDrivePwaReadOfflineDirectories(owner)
      if (!read.consented || read.revalidated !== false ||
          read.snapshot?.albums.length !== 24 ||
          read.snapshot.totalAtCapture !== 100000 ||
          dirs.directories[0]?.items.length !== 1) throw new Error('bounded mixed snapshot failed')
      if (/SECRET_CANARY|SECRET_GPS|cover_node_id|query/.test(JSON.stringify(read))) {
        throw new Error('Album secret/cover/query leaked')
      }
      const foreign = await api.xDrivePwaReadAlbumSummaries({
        ...owner, instanceID: '22222222-2222-4222-8222-222222222222',
      })
      if (foreign.consented || foreign.snapshot) throw new Error('cross Server snapshot exposed')
      return { count: read.snapshot.albums.length, total: read.snapshot.totalAtCapture }
    })
    assert.deepEqual(seeded, { count: 24, total: 100000 })
    await ctx.close()
    ctx = null

    ctx = await launch()
    const second = await attach(ctx)
    await ctx.setOffline(true)
    const relaunch = await second.evaluate(async () => {
      const api = window.xDriveP1C1
      const owner = await api.xDrivePwaReadRelaunchOwner()
      if (!owner) throw new Error('consented Owner hint missing on cold restart')
      const albums = await api.xDrivePwaReadAlbumSummaries(owner)
      if (albums.revalidated !== false || albums.snapshot?.albums.length !== 24) {
        throw new Error('historical albums unavailable/offline or wrongly authorized')
      }
      return { owner, albumCount: albums.snapshot.albums.length }
    })
    assert.equal(relaunch.albumCount, 24)
    await ctx.setOffline(false)
    const cleared = await second.evaluate(async () => {
      const api = window.xDriveP1C1
      const owner = await api.xDrivePwaReadRelaunchOwner()
      const cache = await caches.open('p1c1-public-app-shell-sentinel')
      await cache.put('/public-p1c1', new Response('public-only'))
      await api.xDrivePwaSetOfflineConsent(owner, false)
      const read = await api.xDrivePwaReadAlbumSummaries(owner)
      const hint = await api.xDrivePwaReadRelaunchOwner()
      const response = await cache.match('/public-p1c1')
      if (read.consented || read.snapshot || hint) throw new Error('revocation retained private album data')
      return { revoked: true, publicShell: response && await response.text() === 'public-only' }
    })
    assert.deepEqual(cleared, { revoked: true, publicShell: true })
    console.log('PWA_P1C1_REAL_ALBUM_IDB ' + JSON.stringify({
      sha: process.env.XD_PR_HEAD || null, chrome: ctx.browser()?.version() || 'unknown',
      processes: 2, optIn: true, sampledFrom100k: seeded.total,
      storedAlbumSummaries: seeded.count, offlineReadVerified: false,
      crossOwnerServerIsolated: true, consentRevoked: true, publicCacheIntact: true,
      physicalIOS: false, matchedPerformanceAfter: null,
    }))
  } finally {
    if (ctx) await ctx.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => { webServer.close(); fs.rmSync(profile, { recursive: true, force: true }) })
