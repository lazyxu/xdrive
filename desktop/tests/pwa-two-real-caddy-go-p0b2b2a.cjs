'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const workflow = read('.github/workflows/pwa-two-real-caddy-go-p0b2b2a.yml')
const shell = read('scripts/pwa-two-real-caddy-go-p0b2b2a.sh')
const browser = read('desktop/scripts/pwa-two-real-caddy-go-p0b2b2a.cjs')
const fixture = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const common = read('deploy/Caddyfile.common')
const archive = read('deploy/pwa-archive-assets.sh')
const doc = read('docs/pwa-two-real-caddy-go-p0b2b2a.md')

test('P0-B2b2a compiles two immutable real Go API versions and two real Vite versions', () => {
  assert.ok(workflow.includes('e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4'))
  for (const token of [
    'npm --prefix release-a/web run build',
    'npm --prefix release-b/web run build',
    'cd release-a && go test -c -o',
    'cd release-b && go test -c -o',
    'pwa-go-a.test', 'pwa-go-b.test',
    'github.event.pull_request.head.sha || github.sha',
    'postgres:17-alpine',
    'node --check release-b/desktop/scripts/pwa-two-real-caddy-go-p0b2b2a.cjs'
  ]) assert.ok(workflow.includes(token), token)
  assert.ok(shell.includes('run_case "Aweb-Bgo"'))
  assert.ok(shell.includes('run_case "Bweb-Ago"'))
  assert.ok(shell.includes('test "$B_SHA" != "$A_SHA"'))
  assert.ok(!workflow.includes('skip_ci: true'))
})

test('P0-B2b2a executes the real Caddy binary with actual production routing rules', () => {
  for (const token of [
    'docker pull caddy:2.10.2-alpine',
    'docker image inspect caddy:2.10.2-alpine',
    'docker run --rm --network host',
    'caddy validate --config /etc/caddy/Caddyfile',
    'caddy run --config /etc/caddy/Caddyfile',
    'docker exec "$CONTAINER" caddy version',
    'sed "s/server:8080/127.0.0.1:$API_PORT/g"',
    'import xdrive_app',
    'deploy/Caddyfile.common',
    'sh "$B/deploy/pwa-archive-assets.sh"',
    'XD_PWA_B2B2_GO_SHA='
  ]) assert.ok(workflow.includes(token) || shell.includes(token), token)
  assert.ok(common.includes('handle /api/*'))
  assert.ok(common.includes('handle /assets/*'))
  assert.ok(common.includes('reverse_proxy server:8080'))
  assert.ok(archive.includes('immutable asset collision'))
  assert.doesNotMatch(shell, /skipWaiting|location\.reload/)
})

test('P0-B2b2a keeps API calls genuine and verifies Web/Go cross-version Owner boundaries', () => {
  for (const token of [
    "const { chromium } = require(",
    'waitUntil: ' + "'commit'",
    "page.locator('#web-login-username')",
    "page.locator('#web-login-password')",
    "page.getByRole('button', { name: '登录', exact: true })",
    '/api/v1/auth/login', '/api/v1/nodes/root',
    '/api/v1/media/items/', '/api/v1/version',
    'foreignFile.status(), 404',
    'foreignMedia.status(), 404',
    "navigator.serviceWorker.ready",
    "caches.keys()",
    "crypto.createHash('sha256')",
    'const bytes = await response.body()',
    "assert.equal(hash(bytes), asset.sha256",
    "missing.status(), 404",
  ]) assert.ok(browser.includes(token), token)
  assert.doesNotMatch(browser, /context\.route\(|route\.fulfill\(|fakeGin|fakeCaddy/)
  assert.ok(fixture.includes('TestPWAS2B3RealGinAuthFixture'))
  assert.ok(fixture.includes('httptest.NewServer(mux)'))
  assert.ok(fixture.includes('router.ServeHTTP(w, request)'))
  assert.ok(fixture.includes('meta.InstallNodeChangeJournal(db)'))
})

test('P0-B2b2a does not leak test secrets or overstate unattended uploads/iOS', () => {
  for (const token of [
    'physicalIOS: false',
    'runningUploadDuringUpgrade: false',
    'actualCaddyBinary: true',
    'independentlyCompiledGoServer: true',
    'actualPostgreSQL: true',
    'actualLocalCAS: true',
    '/__test/pwa-s2b3/finish',
    "summary.passed = true"
  ]) assert.ok(browser.includes(token), token)
  for (const token of [
    'Never upload local Gin logs, private readiness JSON, JWT or browser profiles',
    'desktop/pwa-b2b2a-results/summary.json'
  ]) assert.ok(workflow.includes(token), token)
  assert.ok(shell.includes('rm -f "$READY" "$LOCAL/private-gin.log"'))
  assert.ok(doc.includes('不是生产环境安全验收'))
  assert.ok(doc.includes('上传'))
  assert.ok(doc.includes('真实 Caddy'))
  assert.ok(doc.includes('真实 Go'))
})
