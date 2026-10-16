const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Photo Host offline permit issuer requires live shared session and explicit revision', () => {
  const issuer = read('internal/api/photo_host_model_permit_offline.go')
  const fixture = read('internal/api/photo_host_model_permit_offline_test.go')
  const admission = read('internal/api/photo_host_admission_fence.go')
  const python = read('services/photo-face-analyzer/analyzer.py')
  const goFace = read('internal/photointelligence/face_unix.go')
  const router = read('internal/api/router.go')
  assert.match(issuer, /func \(l \*photoHostAdmissionLease\) issueOfflinePhotoModelPermitV1\(/)
  assert.match(issuer, /l\.mu\.Lock\(\)/)
  assert.match(issuer, /pg_backend_pid\(\)/)
  assert.match(issuer, /mode = 'ShareLock'/)
  assert.match(issuer, /objsubid = 1/)
  assert.match(issuer, /l\.conn\.QueryRowContext\(bounded, lockQuery, l\.key\)/)
  assert.match(issuer, /SELECT revision, frozen FROM xd_photo_host_admission_gates/)
  assert.match(issuer, /err != nil \|\| frozen \|\| revision <= 0/)
  assert.match(issuer, /photointelligence\.SignPhotoModelPermitV1\(/)
  assert.match(fixture, /TestOfflinePhotoPermitLiveSQLLeaseAndRevisionPostgres/)
  assert.match(fixture, /TestOfflinePhotoPermitRejectsFakeConnAndExclusiveWriterPostgres/)
  assert.match(admission, /pg_try_advisory_lock_shared\(\$1\)/)
  // An offline codec and test issuer MUST NOT change live model traffic.
  for (const source of [python, goFace, router]) {
    assert.doesNotMatch(source, /issueOfflinePhotoModelPermitV1|SignPhotoModelPermitV1/)
  }
  assert.doesNotMatch(router,
    /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
