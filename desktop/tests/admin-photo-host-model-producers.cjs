const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const sorted = list => [...list].sort()

// Exactly 4 Info, 4 synthetic canary and 5 inference routes exist today.
const families = [
  { name: 'face', info: '/v1/info', canary: '/v1/face-detector-canary', posts: ['/v1/analyze'] },
  { name: 'smart', info: '/v1/smart-info', canary: '/v1/smart-model-canary', posts: ['/v1/smart-analyze'] },
  { name: 'semantic', info: '/v1/semantic-info', canary: '/v1/semantic-image-canary', posts: ['/v1/semantic-image', '/v1/semantic-text'] },
  { name: 'creative', info: '/v1/creative-info', canary: '/v1/creative-cutout-canary', posts: ['/v1/creative-generate'] },
]

// Ten direct Go selectors reduce to nine model-execution HTTP routes:
// manual and foreground Semantic EmbedText share the same POST endpoint.
const producers = [
  ['internal/photointelligence/face_runner.go::r.Analyzer.Analyze', '/v1/analyze'],
  ['internal/photointelligence/smart_runner.go::r.Analyzer.Analyze', '/v1/smart-analyze'],
  ['internal/photointelligence/semantic_runner.go::r.Analyzer.EmbedImage', '/v1/semantic-image'],
  ['internal/api/media_creative.go::s.PhotoCreativeAnalyzer.Generate', '/v1/creative-generate'],
  ['internal/api/media_semantic_search_admission.go::a.SemanticAnalyzer.EmbedText', '/v1/semantic-text'],
  ['internal/api/admin_photo_host_semantic_probe.go::s.PhotoSemanticAnalyzer.EmbedText', '/v1/semantic-text'],
  ['internal/api/admin_photo_host_face_detector_probe.go::prober.ProbeSyntheticFaceDetection', '/v1/face-detector-canary'],
  ['internal/api/admin_photo_host_smart_probe.go::prober.ProbeSyntheticVisualOCR', '/v1/smart-model-canary'],
  ['internal/api/admin_photo_host_semantic_image_probe.go::prober.ProbeSyntheticImage', '/v1/semantic-image-canary'],
  ['internal/api/admin_photo_host_creative_probe.go::prober.ProbeSyntheticCutout', '/v1/creative-cutout-canary'],
]

test('all four production Unix model clients keep fixed routes, methods and parent request contexts', () => {
  for (const family of families) {
    const source = read('internal/photointelligence/' + family.name + '_unix.go')
    const paths = [...source.matchAll(/"http:\/\/xdrive-photo-([a-z]+)(\/v1\/[a-z-]+)"/g)]
      .map(m => m[1] + ':' + m[2])
    assert.deepEqual(sorted(paths), sorted([family.info, family.canary, ...family.posts]
      .map(p => family.name + ':' + p)), family.name + ': unknown route')

    const requests = [...source.matchAll(/http\.NewRequestWithContext\(/g)]
    const scoped = [...source.matchAll(/http\.NewRequestWithContext\(\s*ctx\s*,/g)]
    assert.equal(requests.length, 3, family.name + ': request factory changed')
    assert.equal(scoped.length, 3, family.name + ': detached model request context')
    const gets = [...source.matchAll(/http\.NewRequestWithContext\(\s*ctx\s*,\s*http\.MethodGet\s*,\s*"http:\/\/xdrive-photo-[a-z]+(\/v1\/[a-z-]+)"/g)]
      .map(m => m[1])
    assert.deepEqual(sorted(gets), sorted([family.info, family.canary]))

    if (family.name === 'semantic') {
      const posts = [...source.matchAll(/a\.postJSON\(\s*ctx\s*,\s*"http:\/\/xdrive-photo-semantic(\/v1\/[a-z-]+)"/g)]
        .map(m => m[1])
      assert.deepEqual(sorted(posts), sorted(family.posts))
      assert.match(source, /http\.NewRequestWithContext\(\s*ctx\s*,\s*http\.MethodPost\s*,\s*target\s*,/)
    } else {
      const posts = [...source.matchAll(/http\.NewRequestWithContext\(\s*ctx\s*,\s*http\.MethodPost\s*,\s*"http:\/\/xdrive-photo-[a-z]+(\/v1\/[a-z-]+)"/g)]
        .map(m => m[1])
      assert.deepEqual(sorted(posts), sorted(family.posts))
    }

    assert.match(source, /bytes\.NewReader\(body\)/)
    assert.match(source, /a\.addHeaders\(req\)/)
    assert.match(source, /a\.client\.Do\(req\)/)
    assert.doesNotMatch(source, /\bhttp\.(?:NewRequest|Get|Post)\(/)
    assert.doesNotMatch(source, /\bcontext\.(?:Background|TODO)\(/)
    assert.doesNotMatch(source, /x-xdrive-model-permit/i)
    assert.doesNotMatch(source, /\/v1\/host-apply-ack/)
  }
})

test('Python private Handler and Go/Python permit route allowlists agree on nine execution routes', () => {
  const python = read('services/photo-face-analyzer/analyzer.py')
  const goPermit = read('internal/photointelligence/admission_permit.go')
  const pyPermit = read('services/photo-face-analyzer/admission_permit.py')
  const gets = [...python.matchAll(/if method == "GET" and target == "([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(sorted(gets), sorted(families.flatMap(f => [f.info, f.canary])))
  const postTuple = python.match(/if method == "POST" and target in \(([\s\S]*?)\):/)
  assert.ok(postTuple, 'missing explicit five-route Python POST dispatcher')
  const posts = [...postTuple[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(sorted(posts), sorted(families.flatMap(f => f.posts)))
  assert.equal([...python.matchAll(/self\._require_model_permit\("GET", target, b"", headers\)/g)].length, 4)
  assert.equal([...python.matchAll(/self\._require_model_permit\(method, target, payload, headers\)/g)].length, 1)
  assert.match(python, /self\.model_permit_verifier = None/)
  assert.match(python, /if method == "POST" and target == "\/v1\/host-apply-ack"/)
  assert.doesNotMatch(python, /(?:from|import)\s+model_permit_guard/)
  for (const route of families.flatMap(f => [f.canary, ...f.posts])) {
    assert.ok(goPermit.includes('"' + route + '"'), 'missing Go permit route ' + route)
    assert.ok(pyPermit.includes('"' + route + '"'), 'missing Python permit route ' + route)
  }
})

test('the reviewed 10 Go producer selectors cover all 9 permitted model execution routes', () => {
  const inventory = read('desktop/tests/admin-photo-host-ingress-inventory.cjs')
  const match = inventory.match(/const expected = \[([\s\S]*?)\n\]/)
  assert.ok(match, 'prior fixed Go selector inventory missing')
  const oldSelectors = [...match[1].matchAll(/^\s*'([^']+)'/gm)].map(m => m[1])
  assert.equal(producers.length, 10)
  assert.deepEqual(sorted(producers.map(p => p[0])), sorted(oldSelectors))
  const modelExecution = families.flatMap(f => [f.canary, ...f.posts])
  assert.deepEqual(sorted(new Set(producers.map(p => p[1]))), sorted(modelExecution))

  // Inventory is static review evidence, NOT a signed request, trusted
  // Server membership epoch, verified drain, or Host stop authorization.
  const workloads = read('internal/api/photo_host_admission_workloads.go')
  const manual = read('internal/api/admin_photo_host_inference_admission.go')
  const foreground = read('internal/api/media_semantic_search_admission.go')
  assert.match(workloads, /tryAcquirePhotoHostAdmission\(ctx, s\.DB\)/)
  assert.match(manual, /tryAcquirePhotoHostAdmission\(parent, s\.DB\)/)
  assert.match(foreground, /photoHostRunAdmittedSyntheticInference\(inferenceCtx/)
  for (const source of [workloads, manual, foreground]) {
    assert.doesNotMatch(source, /runOfflinePhotoModelRPC|issueOfflinePhotoModelPermitV1/)
  }
  const router = read('internal/api/router.go')
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
