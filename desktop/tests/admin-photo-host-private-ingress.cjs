const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const source = read('services/photo-face-analyzer/analyzer.py')
const start = source.indexOf('class AnalyzerHandler(socketserver.StreamRequestHandler):')
const finish = source.indexOf('    @staticmethod\n    def _require_protocol(', start)
assert.ok(start >= 0 && finish > start, 'model handler boundary missing')
const handler = source.slice(start, finish)

const expectedRoutes = [
  '/v1/host-apply-ack',
  '/v1/info',
  '/v1/face-detector-canary',
  '/v1/smart-info',
  '/v1/smart-model-canary',
  '/v1/semantic-info',
  '/v1/semantic-image-canary',
  '/v1/creative-info',
  '/v1/creative-cutout-canary',
  '/v1/analyze',
  '/v1/smart-analyze',
  '/v1/semantic-image',
  '/v1/semantic-text',
  '/v1/creative-generate',
]

test('private Python Unix HTTP Photo Host routes are an exact 14-entry owner-reviewed registry', () => {
  const literalRoutes = Array.from(
    handler.matchAll(/["'](\/v1\/[a-z0-9-]+)["']/g), match => match[1],
  )
  assert.deepEqual([...new Set(literalRoutes)].sort(), expectedRoutes.slice().sort())
  const receiveBody = handler.indexOf('payload = self.rfile.read(length)')
  const ordinaryAuth = handler.indexOf('self._authorize(headers)')
  const post = handler.indexOf('if method == "POST" and target in (')
  const hostAck = handler.indexOf('if method == "POST" and target == "/v1/host-apply-ack":')
  assert.ok(hostAck >= 0 && hostAck < ordinaryAuth)
  assert.ok(ordinaryAuth > 0 && ordinaryAuth < post && ordinaryAuth < receiveBody)
  assert.ok(handler.slice(hostAck, ordinaryAuth).includes('self._authorize_host_apply(headers)'),
    'Host Apply ACK must use independent token and authenticate before body')
  assert.ok(handler.slice(ordinaryAuth, post).includes('self._require_protocol('),
    'GET model info/canary routes must retain per-protocol checks')
  const writeBody = handler.slice(post)
  for (const route of expectedRoutes.filter(r => [
    '/v1/analyze', '/v1/smart-analyze', '/v1/semantic-image',
    '/v1/semantic-text', '/v1/creative-generate',
  ].includes(r))) {
    assert.ok(writeBody.includes('"' + route + '"'), 'missing inference dispatch ' + route)
  }
  assert.equal((handler.match(/if not self\.server\.state\.token:/g) || []).length, 4,
    'fixed canaries must explicitly reject model token not configured')
  assert.match(source, /socketserver\.UnixStreamServer/)
  assert.match(source, /os\.chmod\(socket_path, 0o660\)/)
})

test('private model route auth is NOT a PostgreSQL fleet admission or safe-stop proof', () => {
  const provider = read('internal/api/photo_host_admission_fence.go')
  const router = read('internal/api/router.go')
  const compose = read('deploy/docker-compose.yml')
  const authStart = source.indexOf('    def _authorize(self, headers:')
  const authEnd = source.indexOf('\n    def _write_binary(', authStart)
  assert.ok(authStart > 0 && authEnd > authStart)
  const auth = source.slice(authStart, authEnd)
  assert.match(auth, /expected = self\.server\.state\.token/)
  assert.match(auth, /hmac\.compare_digest\(supplied, expected\)/)
  // This is a negative safety observation, NOT approval to keep tokenless inference:
  // deployed model auth is currently optional and a local Unix peer can bypass
  // fenced Go admissions. Track it as an explicit stop blocker.
  assert.match(auth, /if not expected:\s+return/)
  assert.match(compose, /XD_FACE_ANALYZER_TOKEN:\s+\$\{XD_PHOTO_FACE_ANALYZER_TOKEN:-\}/)
  assert.match(provider, /pg_try_advisory_lock_shared\(\$1\)/)
  assert.doesNotMatch(source, /pg_try_advisory_lock_shared|xd_photo_host_admission_gates/)
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})


test('opt-in model bearer required-v1 is deployment-owned and denies tokenless startup', () => {
  const model = read('services/photo-face-analyzer/analyzer.py')
  const testSource = read('services/photo-face-analyzer/tests/test_private_ingress.py')
  const compose = read('deploy/docker-compose.yml')
  const env = read('deploy/.env.example')
  const router = read('internal/api/router.go')
  assert.match(compose, /XD_PHOTO_PRIVATE_INGRESS_POLICY:\s+\$\{XD_PHOTO_PRIVATE_INGRESS_POLICY:-legacy\}/)
  assert.match(env, /XD_PHOTO_PRIVATE_INGRESS_POLICY=legacy/)
  assert.match(model, /def validate_private_ingress_policy\(/)
  assert.match(model, /PRIVATE_INGRESS_REQUIRE_BEARER_V1 = "require-bearer-v1"/)
  assert.match(model, /re\.fullmatch\(r"\[0-9a-f\]\{64\}", token\)/)
  assert.match(model, /hmac\.compare_digest\(token, host_apply_token\)/)
  assert.match(model, /response\["private_ingress_policy_mode"\] = self\.private_ingress_policy/)
  assert.match(model, /private_policy = validate_private_ingress_policy\(/)
  assert.match(model, /private_ingress_policy=private_policy/)
  assert.match(model, /model-private bearer enforcement not confirmed/)
  assert.match(testSource, /test_strict_mode_info_and_existing_private_unix_bearer_enforcement/)
  assert.match(testSource, /test_opt_in_strict_model_bearer_policy_fails_closed_before_runtime_start/)
  // The model startup policy is NOT a browser toggle, no new Host actions.
  assert.doesNotMatch(router, /admin\.(?:POST|PUT|DELETE)\(".*photo-intelligence\/host\/(?:stop|restart|freeze|disable)/)
})
