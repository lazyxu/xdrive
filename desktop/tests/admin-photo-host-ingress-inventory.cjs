const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

// Deliberately enumerate production direct model selectors, including fixed
// canary method values. This is an owner-reviewed static regression barrier,
// NOT an exhaustive runtime call-graph proof or all-instance stop permit.
const modelSelector = /\b(?:[A-Za-z_]\w*\.)?(?:Analyzer|(?:Photo)?(?:Face|Smart|Semantic|Creative)Analyzer)\.(?:Analyze|EmbedText|EmbedImage|Generate|ProbeSynthetic[A-Za-z0-9_]*)\b|\bprober\.ProbeSynthetic[A-Za-z0-9_]+\b/g
const expected = [
  'internal/api/admin_photo_host_creative_probe.go::prober.ProbeSyntheticCutout',
  'internal/api/admin_photo_host_face_detector_probe.go::prober.ProbeSyntheticFaceDetection',
  'internal/api/admin_photo_host_semantic_image_probe.go::prober.ProbeSyntheticImage',
  'internal/api/admin_photo_host_semantic_probe.go::s.PhotoSemanticAnalyzer.EmbedText',
  'internal/api/admin_photo_host_smart_probe.go::prober.ProbeSyntheticVisualOCR',
  'internal/api/media_creative.go::s.PhotoCreativeAnalyzer.Generate',
  'internal/api/media_semantic_search_admission.go::a.SemanticAnalyzer.EmbedText',
  'internal/photointelligence/face_runner.go::r.Analyzer.Analyze',
  'internal/photointelligence/semantic_runner.go::r.Analyzer.EmbedImage',
  'internal/photointelligence/smart_runner.go::r.Analyzer.Analyze',
]

test('Photo Host Go inference selectors require an explicit reviewed ingress inventory', () => {
  const observed = []
  for (const directory of ['internal/api', 'internal/photointelligence', 'cmd/server']) {
    const filenames = fs.readdirSync(path.join(root, directory))
    for (const filename of filenames) {
      if (!filename.endsWith('.go') || filename.endsWith('_test.go')) continue
      const relative = directory + '/' + filename
      for (const match of read(relative).matchAll(modelSelector)) {
        observed.push(relative + '::' + match[0])
      }
    }
  }
  // A newly introduced direct entrypoint must update this exact allowlist and
  // the authoritative docs after proving which shared admission lease it owns.
  // Removing or moving a protected sink also requires a fresh safety review.
  assert.deepEqual(observed.sort(), expected.slice().sort())
})

test('every currently enumerated source-level Go model entrypoint is fenced before inference', () => {
  const scheduler = read('internal/api/photo_intelligence_scheduler.go')
  const creative = read('internal/api/media_creative.go')
  const search = read('internal/api/media_semantic_search.go')
  const adapter = read('internal/api/media_semantic_search_admission.go')
  const guard = read('internal/api/admin_photo_host_inference_admission.go')
  const fence = read('internal/api/photo_host_admission_fence.go')

  // Photo face/smart/semantic owner-runner calls are scheduled under the
  // existing owner lease, rather than installing a second pool connection.
  assert.match(scheduler, /Lease:\s+s\.photoHostOwnerAdmissionLeaseProvider\(/)
  for (const runner of ['photoFaceRunner', 'photoSmartRunner', 'photoSemanticRunner']) {
    assert.ok(scheduler.includes('s.' + runner + '.RunOwnerBatch(ctx, ownerID,'),
      runner + ' no longer uses the shared scheduler')
  }
  assert.match(creative, /Lease:\s+s\.photoHostCreativeAdmissionLeaseProvider\(taskKey\)/)
  assert.match(creative, /s\.PhotoCreativeAnalyzer\.Generate\(ctx, task\)/)

  // Only a cache-miss foreground EmbedText call owns the narrow shared lease;
  // release it before user-index SQL. Cache hits execute no model inference.
  assert.match(search, /photoHostAdmissionFencedSemanticAnalyzer\s*\{/)
  assert.match(adapter, /photoHostRunAdmittedSyntheticInference\(inferenceCtx/)
  assert.match(adapter, /a\.SemanticAnalyzer\.EmbedText\(leasedCtx, text\)/)

  // All five fixed administrator canaries share the identical PG admission,
  // 2-second heartbeat and lost-lease cancellation. None may invoke a new
  // private inference route outside the existing explicit-click preflight.
  for (const filename of [
    'admin_photo_host_creative_probe.go',
    'admin_photo_host_face_detector_probe.go',
    'admin_photo_host_semantic_image_probe.go',
    'admin_photo_host_semantic_probe.go',
    'admin_photo_host_smart_probe.go',
  ]) {
    assert.match(read('internal/api/' + filename),
      /photoHostRunAdmittedSyntheticInference\(ctx, func\(inferenceCtx context\.Context\)/)
  }
  assert.match(guard, /tryAcquirePhotoHostAdmission\(parent, s\.DB\)/)
  assert.match(guard, /lease\.Heartbeat\(parent\)/)
  assert.match(guard, /lease\.Close\(\)/)
  assert.match(fence, /pg_try_advisory_lock_shared\(\$1\)/)

  // No authorization to stop or restart can be inferred from static coverage.
  const router = read('internal/api/router.go')
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*(?:photo-intelligence\/host\/(?:stop|restart|freeze|disable))"/)
  assert.doesNotMatch(adapter + guard, /docker (?:stop|restart)|stopHost|restartHost/)
})
