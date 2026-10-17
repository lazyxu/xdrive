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

test('no JSAPI4 production loader or leaked Browser AK is introduced by signed proof', () => {
  const router = read('internal/api/router.go')
  const bootstrap = read('internal/api/baidu_jsapi_bootstrap_candidate.go')
  const candidate = read('internal/api/baidu_geoconv_signed_quota.go')
  assert.equal(router.includes('/_BMapService/'), false)
  assert.equal(router.includes('/baidu-jsapi/session'), false)
  assert.equal(bootstrap.includes('RuntimeEnabled: true'), false)
  assert.equal(candidate.includes('func (s *Server)'), false)
  assert.equal(candidate.includes('http.Handler'), false)
  assert.match(candidate, /ctx.Err\(\)/)
})
