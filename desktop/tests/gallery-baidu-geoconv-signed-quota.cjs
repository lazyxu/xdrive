const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('signed account reservation reuses the one c6 atomic lower-cap transaction', () => {
  const candidate = read('internal/api/baidu_geoconv_signed_quota.go')
  const old = read('internal/api/baidu_geoconv_quota.go')
  const verifier = read('internal/api/baidu_geoconv_entitlement_proof.go')
  assert.match(candidate, /func reserveBaiduGeoconvSignedAccountQuota\(/)
  assert.match(candidate, /verifyBaiduGeoconvAccountEvidence\(/)
  assert.match(candidate, /reserveBaiduGeoconvQuotaWithLowerAccountCaps\(/)
  assert.match(candidate, /SELECT clock_timestamp\(\)/)
  assert.match(old, /func reserveBaiduGeoconvQuotaWithLowerAccountCaps\(/)
  assert.match(old, /reserveBaiduGeoconvCadenceTxWithCaps\(/)
  assert.match(verifier, /baiduGeoconvPinnedOperatorPublicKey = ""/)
  assert.match(verifier, /func verifyPinnedBaiduGeoconvAccountEvidence\(/)
  // A second independent fleet/Owner SQL writer is the exact scope rejected in #1980.
  for (const forbidden of [
    'INSERT INTO xd_baidu_geoconv_quota_buckets',
    'UPDATE xd_baidu_geoconv_quota_buckets',
    'http.Client', 'net/http', 'api.map.baidu.com',
    'BMapLoader', 'BrowserAK', 'RuntimeEnabled',
  ]) {
    assert.equal(candidate.includes(forbidden), false, forbidden)
  }
})

test('signed Geoconv remains private when JSAPI4 has real but unapproved HTTP entry', () => {
  const router = read('internal/api/router.go')
  const bootstrap = read('internal/api/baidu_jsapi_bootstrap_candidate.go')
  const candidate = read('internal/api/baidu_geoconv_signed_quota.go')
  const live = read('internal/api/baidu_jsapi4_http.go')
  const resources = read('internal/baidumapjsapi/resource_policy.go')
  const release = read('internal/baidumapjsapi/release_attestation.go')
  // A3c11 deliberately provides REAL protected entry points. Old A3c7
  // "no route exists" source assumptions must not hide a production gap.
  assert.match(router, /ApprovedJSAPI4ChildPaths\(\)/)
  assert.match(router, /s\.baiduJSAPI4RuntimeResourceHTTP/)
  assert.match(router, /authed\.POST\("\/media\/places\/baidu-jsapi\/session", s\.baiduJSAPI4SessionHTTP\)/)
  assert.match(live, /currentBaiduJSAPI4OperatorRelease\(/)
  assert.match(live, /baiduJSAPI4SignedLiveLoader\(/)
  // Unlike Geoconv, JSAPI is still default NO-GO: no pinned release signer
  // or complete reviewed JS, tile, font, WASM child inventory.
  assert.match(resources, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(release, /VerifyManagedJSAPI4ProductionRelease\(/)
  assert.equal(bootstrap.includes('RuntimeAuthorized:     true'), false)
  assert.equal(candidate.includes('func (s *Server)'), false)
  assert.equal(candidate.includes('http.Handler'), false)
  assert.match(candidate, /ctx.Err\(\)/)
})
