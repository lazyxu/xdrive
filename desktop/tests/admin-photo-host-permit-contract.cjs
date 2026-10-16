const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Photo Host v1 model inference permit is a non-deployed cross-language codec', () => {
  const python = read('services/photo-face-analyzer/admission_permit.py')
  const pythonTests = read('services/photo-face-analyzer/tests/test_admission_permit.py')
  const go = read('internal/photointelligence/admission_permit.go')
  const goTests = read('internal/photointelligence/admission_permit_test.go')
  const model = read('services/photo-face-analyzer/analyzer.py')
  const router = read('internal/api/router.go')
  const goIngress = read('internal/photointelligence/face_unix.go')
  const semantic = read('internal/photointelligence/semantic_unix.go')
  const creative = read('internal/photointelligence/creative_unix.go')

  assert.match(python, /DOMAIN = "xdrive\.photo\.model-permit\.v1"/)
  assert.match(python, /MAX_LIFETIME_SECONDS = 30/)
  assert.match(python, /MAX_FUTURE_SKEW_SECONDS = 5/)
  assert.match(python, /MAX_REPLAY_ENTRIES = 32768/)
  assert.match(python, /def verify_v1\(/)
  assert.match(python, /hmac\.compare_digest\(mac, expected\)/)
  assert.match(python, /return replay\.consume\(/)
  assert.match(go, /func SignPhotoModelPermitV1\(/)
  assert.match(go, /"xdrive\.photo\.model-permit\.v1"/)
  assert.match(pythonTests, /EXPECTED_MAC = "2dfe4e035ef32e2ff7d947a9ffdfd4b8df07a869bce49818bed232866f00b2ce"/)
  assert.match(goTests, /2dfe4e035ef32e2ff7d947a9ffdfd4b8df07a869bce49818bed232866f00b2ce/)
  // Critical: no runtime Handler or Go model client may begin enforcing,
  // signing or exposing this codec until all admission lease paths are ready.
  assert.doesNotMatch(model, /\bimport admission_permit\b|\bfrom admission_permit import\b/)
  for (const source of [router, goIngress, semantic, creative]) {
    assert.doesNotMatch(source, /SignPhotoModelPermitV1|x-xdrive-model-permit/i)
  }
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
