const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('signed expected-roster candidate stays offline and cannot silently enable private model ingress', () => {
  const roster = read('internal/photointelligence/model_expected_roster_offline.go')
  const rosterTests = read('internal/photointelligence/model_expected_roster_offline_test.go')
  const liveHandler = read('services/photo-face-analyzer/analyzer.py')
  const router = read('internal/api/router.go')
  const preflight = read('internal/api/admin_photo_host_preflight.go')

  assert.match(roster, /func VerifyOfflinePhotoModelExpectedRosterV1\(/)
  assert.match(roster, /ed25519\.Verify\(/)
  assert.match(roster, /ValidAnalyzerRuntimeInstanceID\(r\.ModelBootID\)/)
  assert.match(roster, /offlinePhotoModelExpectedRosterMaxMembers = 32/)
  assert.match(roster, /offlinePhotoModelExpectedRosterMaxTTL\s+= 300/)
  assert.match(rosterTests, /TestOfflinePhotoModelRosterCanonicalDeterministic/)
  assert.match(rosterTests, /TestOfflinePhotoModelRosterRejectsMalformedManifests/)
  assert.match(rosterTests, /TestOfflinePhotoModelRosterRequiresTrustedPinnedFactsAndSignature/)

  // The verifier is a test-only crypto building block, not a trusted
  // deployment binding. No running Go entry point may call it in this phase.
  for (const dir of ['internal/api', 'internal/photointelligence', 'cmd/server']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (!name.endsWith('.go') || name.endsWith('_test.go') ||
        (dir === 'internal/photointelligence' && name === 'model_expected_roster_offline.go')) continue
      assert.doesNotMatch(read(dir + '/' + name),
        /\bVerifyOfflinePhotoModelExpectedRosterV1\s*\(/,
        'unexpected production roster verifier call: ' + dir + '/' + name)
    }
  }

  assert.match(liveHandler, /self\.model_permit_verifier = None/)
  assert.doesNotMatch(liveHandler, /expected-roster|expected_roster|model_expected_roster/)
  assert.doesNotMatch(router + preflight, /expected-roster|expected_roster|VerifyOfflinePhotoModelExpectedRosterV1/)
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
