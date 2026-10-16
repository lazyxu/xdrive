const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

const knownRoutes = [
  'GET /v1/creative-cutout-canary',
  'GET /v1/face-detector-canary',
  'GET /v1/semantic-image-canary',
  'GET /v1/smart-model-canary',
  'POST /v1/analyze',
  'POST /v1/creative-generate',
  'POST /v1/semantic-image',
  'POST /v1/semantic-text',
  'POST /v1/smart-analyze',
]

test('offline per-member migration reports must not turn into live Photo Host authorization', () => {
  const source = read('internal/photointelligence/model_member_rollout_offline.go')
  const tests = read('internal/photointelligence/model_member_rollout_offline_test.go')
  const roster = read('internal/photointelligence/model_expected_roster_offline.go')
  const modelHandler = read('services/photo-face-analyzer/analyzer.py')
  const router = read('internal/api/router.go')

  assert.match(source, /func VerifyOfflinePhotoModelAllMembersPreparedV1\(/)
  assert.match(source, /VerifyOfflinePhotoModelExpectedRosterV1\(/)
  assert.match(source, /ed25519\.Verify\(/)
  assert.match(source, /c\.RosterSHA256 != rosterDigest/)
  assert.match(source, /len\(reports\) != len\(roster\.ExpectedServerIDs\)/)
  assert.match(source, /bytes\.Equal\(key, pinnedOperator\)/)
  assert.match(source, /offlinePhotoModelMemberPreparedMode\s+= "prepared-v1"/)
  const actual = [...source.matchAll(/"((?:GET|POST) \/v1\/[a-z-]+)"/g)].map(match => match[1])
  assert.deepEqual(actual, knownRoutes)
  assert.match(roster, /offlinePhotoModelExpectedRosterMaxMembers = 32/)
  for (const name of [
    'TestOfflinePhotoModelAllMembersPreparedCurrentSignedFixture',
    'TestOfflinePhotoModelAllMembersPreparedRejectsMixedOldAbsentOrUntrusted',
    'TestOfflinePhotoModelAllMembersPreparedRejectsExpiredOrUnsigned',
    'TestOfflinePhotoModelMemberPreparedCanonicalRejectsClaimDrift',
  ]) assert.ok(tests.includes('func ' + name + '('), 'missing negative test: ' + name)

  // Test-only Go crypto must NOT be imported by running Server/HTTP clients.
  for (const dir of ['internal/api', 'internal/photointelligence', 'cmd/server']) {
    for (const filename of fs.readdirSync(path.join(root, dir))) {
      if (!filename.endsWith('.go') || filename.endsWith('_test.go') ||
        (dir === 'internal/photointelligence' && filename === 'model_member_rollout_offline.go')) continue
      assert.doesNotMatch(read(dir + '/' + filename), /\bVerifyOfflinePhotoModelAllMembersPreparedV1\s*\(/,
        'unexpected production rollout verifier call: ' + dir + '/' + filename)
    }
  }
  assert.match(modelHandler, /self\.model_permit_verifier = None/)
  assert.doesNotMatch(modelHandler, /member-prepared|model_member_rollout_offline/)
  assert.doesNotMatch(router, /VerifyOfflinePhotoModelAllMembersPreparedV1|member-prepared/)
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
