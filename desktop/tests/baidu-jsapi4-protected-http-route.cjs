'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('A3 Caddy routes JSAPI4 to Go, never to SPA or a wildcard Baidu proxy', () => {
  const caddy = read('deploy/Caddyfile.common')
  assert.match(caddy, /handle \/_BMapService\/\*\s*\{[^}]*reverse_proxy server:8080/s)
  assert.ok(caddy.indexOf('handle /_BMapService/*') <
    caddy.indexOf('handle /api/*'))
  assert.match(caddy, /header Cache-Control "private, no-store"/)
  assert.match(caddy, /header Referrer-Policy "no-referrer"/)
  assert.doesNotMatch(caddy, /reverse_proxy\s+https?:\/\/api\.map\.baidu\.com/)
  const worker = read('assets/icon/web/sw.js')
  assert.match(worker, /if \(request\.mode === 'navigate'\)/)
  assert.match(worker, /if \(!SHELL_PATHS\.has\(url\.pathname\)/)
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return/)
  assert.match(worker, /url\.pathname !== '\/' && url\.pathname !== '\/index\.html'/)
})

test('A3 Go binds only one reviewed map resource and a Bearer-authenticated mint', () => {
  const router = read('internal/api/router.go')
  assert.match(router, /ApprovedJSAPI4ChildPaths\(\)/)
  assert.match(router, /s\.baiduJSAPI4RuntimeResourceHTTP/)
  assert.match(router, /authed\.POST\("\/media\/places\/baidu-jsapi\/session", s\.baiduJSAPI4SessionHTTP\)/)
  assert.match(read("internal/baidumapjsapi/provider_family.go"), /ValidateJSAPI4ProviderFamilyRequest/)
  assert.doesNotMatch(router, /reverse_proxy\s+https?:\/\/api\.map\.baidu\.com/)
  const handlers = read('internal/api/baidu_jsapi4_http.go')
  for (const token of [
    'InstallBaiduJSAPI4OperatorRelease',
    'ClearBaiduJSAPI4OperatorRelease',
    'currentBaiduJSAPI4OperatorRelease',
    'baiduJSAPI4SignedLiveLoader',
    's.baiduJSAPI4Authority.Load() != authority',
  ]) assert.ok(handlers.includes(token), token)
  const legacySession = handlers.match(
    /func \(s \*Server\) baiduJSAPI4SessionHTTP\(c \*gin\.Context\) \{[\s\S]*?\n\}/
  )?.[0]
  assert.ok(legacySession, 'legacy session handler must exist as an explicit deny')
  assert.match(legacySession, /http\.StatusForbidden/)
  assert.match(legacySession, /isolated_map_required/)
  assert.doesNotMatch(legacySession,
    /IssueMapSession|SetCookie|BootstrapCandidate|currentBaiduJSAPI4OperatorRelease/,
    'old Gallery-origin Cookie mint must be unconditionally unreachable')
  const childTicket = read('internal/api/baidu_jsapi4_isolated_ticket.go')
  assert.match(childTicket, /func \(s \*Server\) baiduJSAPI4ChildTicketHTTP/)
  assert.match(childTicket, /func \(s \*Server\) baiduJSAPI4ChildRedeemHTTP/)
  assert.match(childTicket, /baidumapjsapi\.IssueMapSession/)
  assert.match(childTicket, /cookie\.Partitioned\s*=\s*true/)
  assert.match(childTicket, /cookie\.SameSite\s*=\s*http\.SameSiteNoneMode/)
  assert.match(router, /authed\.POST\("\/media\/places\/baidu-jsapi\/child-ticket",\s*s\.baiduJSAPI4ChildTicketHTTP\)/)
  assert.match(router, /r\.POST\("\/_xdrive_baidu_isolated\/session",\s*s\.baiduJSAPI4ChildRedeemHTTP\)/)
  assert.doesNotMatch(handlers,
    /os\.Getenv|localhost|window|eval\(|\/\/api\.map\.baidu\.com/)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  const signed = read('internal/baidumapjsapi/release_attestation.go')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(read('internal/api/baidu_jsapi4_managed_runtime.go'), /verifyBaiduJSAPI4ManagedRelease\(/)
  assert.match(signed, /VerifyManagedJSAPI4ProductionRelease\(/)
  assert.match(read('internal/api/baidu_jsapi_config.go'),
    /RuntimeEnabled:\s+approved/)
})

test('A3 shared Web/Mobile/Desktop media backend remains intact', () => {
  const a = read('web/src/mediaGalleryAdapter.ts')
  const b = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(a, /listPlacesViewport/)
  assert.match(b, /listPlacesViewport/)
  assert.match(read('ui/shared/src/mui/MediaGallery.tsx'),
    /XDriveMediaGalleryPlacesMap/)
  assert.match(read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),
    /XDriveMediaGalleryBaiduStaticMap/)
})
