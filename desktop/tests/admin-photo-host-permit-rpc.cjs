const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8')

test('offline full-RPC admission retains one SQL session until synthetic callback returns', () => {
  const guard = read('internal/api/photo_host_model_permit_rpc_offline.go')
  const tests = read('internal/api/photo_host_model_permit_rpc_offline_test.go')
  const issuer = read('internal/api/photo_host_model_permit_offline.go')
  const router = read('internal/api/router.go')
  const handler = read('services/photo-face-analyzer/analyzer.py')
  const client = read('internal/photointelligence/semantic_unix.go')
  assert.match(guard, /func \(l \*photoHostAdmissionLease\) runOfflinePhotoModelRPC\(/)
  assert.match(guard, /l\.issueOfflinePhotoModelPermitV1\(/)
  assert.match(guard, /go func\(\) \{/)
  assert.match(guard, /l\.Heartbeat\(ctx\)/)
  assert.match(guard, /callErr := invoke\(ctx, claim, mac, body\)/)
  assert.match(guard, /finalHeartbeat := l\.Heartbeat\(ctx\)/)
  assert.match(guard, /return errOfflinePhotoModelPermitUnavailable/)
  assert.match(tests, /TestOfflinePhotoModelRPCMaintainsLeaseDuringRemoteCallbackPostgres/)
  assert.match(tests, /TestOfflinePhotoModelRPCRejectsLostLeaseAndCanceledParentPostgres/)
  assert.match(tests, /TestOfflinePhotoModelRPCRefusesMissingRevisionOrCallbackFailurePostgres/)
  assert.match(issuer, /photoHostAdmissionLockID\(\)/)
  // This is a test-only protocol exercise, not a request header rollout.
  for (const source of [router, client]) {
    assert.doesNotMatch(source, /runOfflinePhotoModelRPC|issueOfflinePhotoModelPermitV1|x-xdrive-model-permit/i)
  }
  // The Python Handler legitimately recognizes a TEST-INJECTED permit header
  // from #1746, but production must not import the offline test guard.
  assert.doesNotMatch(handler, /runOfflinePhotoModelRPC|issueOfflinePhotoModelPermitV1|import model_permit_guard|from model_permit_guard import/)
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
