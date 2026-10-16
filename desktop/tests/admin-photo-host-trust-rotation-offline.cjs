const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('offline dual-signed operator transition has no live service, UI or Host stop writer', () => {
  const rotator = read('internal/photointelligence/model_trust_rotation_offline.go')
  const tests = read('internal/photointelligence/model_trust_rotation_offline_test.go')
  const roster = read('internal/photointelligence/model_expected_roster_offline.go')
  const model = read('services/photo-face-analyzer/analyzer.py')
  const router = read('internal/api/router.go')
  const preflight = read('internal/api/admin_photo_host_preflight.go')
  assert.match(rotator, /func VerifyOfflinePhotoTrustRotationV1\(/)
  assert.match(rotator, /ed25519\.Verify\(pinnedCurrentKey/)
  assert.match(rotator, /ed25519\.Verify\(proposedNextKey/)
  assert.match(rotator, /newDigest != reviewedNextKeySHA256/)
  assert.match(rotator, /candidate\.Sequence <= trustedSequenceFloor/)
  assert.match(rotator, /VerifyOfflinePhotoModelExpectedRosterV1\(/)
  assert.match(rotator, /len\(candidate\.RevokedServerIDs\) >= len\(previousRoster\.ExpectedServerIDs\)/)
  assert.match(roster, /offlinePhotoModelExpectedRosterMaxMembers = 32/)
  for (const name of [
    'TestOfflinePhotoTrustRotationTwoKeyApprovalAndDeterministicTranscript',
    'TestOfflinePhotoTrustRotationRejectsUntrustedApprovals',
    'TestOfflinePhotoTrustRotationRequiresIndependentSequenceAndExpiry',
  ]) assert.ok(tests.includes('func ' + name + '('), 'missing offline negative regression: ' + name)

  for (const dir of ['internal/api', 'internal/photointelligence', 'cmd/server']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (!name.endsWith('.go') || name.endsWith('_test.go') ||
          (dir === 'internal/photointelligence' && name === 'model_trust_rotation_offline.go')) continue
      assert.doesNotMatch(read(dir + '/' + name), /\bVerifyOfflinePhotoTrustRotationV1\s*\(/,
        'unexpected production trust key rotation entry: ' + dir + '/' + name)
    }
  }
  assert.match(model, /self\.model_permit_verifier = None/)
  assert.doesNotMatch(model + router + preflight, /xdrive\.photo\.trust-rotation|VerifyOfflinePhotoTrustRotationV1/)
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
