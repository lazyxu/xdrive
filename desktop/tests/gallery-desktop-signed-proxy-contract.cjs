'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const benchmark = fs.readFileSync(path.join(
  root, 'desktop/scripts/gallery-desktop-signed-video-proxy-main.cjs'), 'utf8')
const serverFixture = fs.readFileSync(path.join(
  root, 'internal/api/gallery_desktop_signed_proxy_fixture_integration_test.go'), 'utf8')
test('Desktop signed video proxy benchmark exercises actual Gin Agent and Chromium request lifetimes', () => {
  assert.doesNotThrow(() => new vm.Script(benchmark))
  for (const token of [
    "AgentIPCClient", "DesktopFilePreviewProxy",
    "agent.cloudFilePreviewTicket(nodeID)",
    "(input, init) => net.fetch(input, init)",
    "win.webContents.executeJavaScript",
    "agent.mediaThumbnail(asset.node_id, undefined, 1)",
    "await sleep(160)",
    "upstreamCanceled", "serverActiveAfter160Ms",
    "assert.equal(rows.length, 36)",
    "cancelled.length === 6",
    "gallery-desktop-signed-video-proxy.json",
    "fixture.decodable_video",
  ]) {
    assert(benchmark.includes(token), 'missing real Agent→signed Gin preview measurement: ' + token)
  }
})
test('Desktop benchmark fixture reuses actual Server 12 sized assets and owner/session-issued tickets', () => {
  for (const token of [
    'TestGalleryDesktopSignedVideoProxyFixture',
    'galleryVideoRangeSeedAsset',
    'galleryVideoRangeCountingStore',
    'auth.HashPassword',
    'postgres.Open',
    'meta.RefreshToken',
    'galleryVideoRangeDelayedWriter',
    'activeSlow',
    'cancelledSlow',
    'emittedSlow',
    'httptest.NewServer',
    '"__bench/stats"',
    // gofmt aligns Go map values; assert the contract, not whitespace.
    '"decodable_video": false',
  ]) {
    if (token === '"__bench/stats"') {
      assert(serverFixture.includes('"/__bench/stats"'))
      continue
    }
    if (token === '"decodable_video": false') {
      assert.match(serverFixture, /"decodable_video":\s*false/,
        'fixture must reject interpreting pseudo bytes as codec-decodable media')
      continue
    }
    assert(serverFixture.includes(token),
      'missing real signed Gin/Pg transport fixture: ' + token)
  }
})
