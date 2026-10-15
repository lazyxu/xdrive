'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }

test('A3b3a2a one Gallery contract on Web, Mobile Web and Desktop', () => {
  const models = read('ui/shared/src/models.ts')
  const shared = read('ui/shared/src/mui/MediaGallery.tsx')
  const port = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  for (const text of [models, shared, port, web, desktop]) {
    assert.match(text, /MediaPlacesViewport|listPlacesViewport/)
  }
  assert.match(port, /resolveXDriveTransport\([\s\S]*?port\.listPlacesViewport!\(bounds, limit, offset, signal\)/)
  assert.match(web, /api\.mediaPlacesViewport\(bounds, limit, offset, signal\)/)
  assert.match(desktop, /xDriveDesktopViewportRequest\(signal, requestID\s*=>[\s\S]*?agent\.getMediaPlacesViewport\(bounds, limit, offset, requestID\)/)
  assert.doesNotMatch(web, /BrowserAK|BMAP_PROXY_URL/)
})

test('A3b3a2a authenticated Agent and cancellation reach Server Context', () => {
  const server = read('internal/api/router.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const bridge = read('cmd/xdrive-agent/desktop_ipc_media_places_viewport.go')
  const ctrl = read('cmd/xdrive-agent/cloud_files.go')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const cli = read('desktop/src/main/agent_client.cts')
  const rest = read('web/src/api.ts')
  assert.match(server, /authed\.GET\("\/media\/places\/viewport"/)
  assert.match(agent, /mux\.HandleFunc\("GET \/v1\/media\/places\/viewport", h\.mediaPlacesViewport\)/)
  assert.match(bridge, /CloudMediaPlacesViewport\(r\.Context\(\), bounds, limit, offset\)/)
  assert.match(ctrl, /cli\.MediaPlacesViewport\(ctx, bounds, limit, offset\)/)
  assert.match(main, /viewportRequests\.run\(event\.sender, requestID, async signal/)
  assert.match(main, /requireAgentCapability\(hello, 'media-gallery'\)/)
  assert.match(main, /mediaPlacesViewport\([\s\S]*?limit, offset, signal/)
  assert.match(preload, /agent:get-media-places-viewport/)
  assert.match(cli, /'GET', `\/v1\/media\/places\/viewport\?\$\{query\.toString\(\)\}`, undefined, 10_000, signal/)
  assert.match(rest, /mediaPlacesViewport\([\s\S]*?\{ signal, cache: 'no-store' \}/)
  assert.doesNotMatch(bridge, /\.MediaPlaces\(ctx, 1000\)|AK|Baidu/)
})

test('A3b3a2a no unapproved dynamic JSAPI runtime or alternate map Provider', () => {
  const s = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(s, /return ErrGateClosed/)
  assert.match(s, /reviewedJSAPI4ChildResourceCount = 0/)
  const docs = read('docs/gallery-places-ios27-roadmap.md')
  assert.match(docs, /iOS 27/)
  assert.match(docs, /52px/)
})
