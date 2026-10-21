'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const workflow = read('.github/workflows/pwa-go-hot-session-b2b2b1.yml')
const shell = read('scripts/pwa-go-hot-session-b2b2b1.sh')
const chrome = read('desktop/scripts/pwa-go-hot-session-b2b2b1.cjs')
const doc = read('docs/pwa-go-hot-session-b2b2b1.md')
const server = read('cmd/server/main.go')
const config = read('internal/config/config.go')
const version = read('internal/api/router.go')
const caddy = read('deploy/Caddyfile.common')
const archive = read('deploy/pwa-archive-assets.sh')

test('Two immutable full production Go binaries share actual DB/CAS/JWT, not API mocks', () => {
  for (const evidence of [
    'e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4',
    'npm --prefix release-a/web run build', 'npm --prefix release-b/web run build',
    'cd release-a && go build', 'cd release-b && go build',
    'go-A', 'go-B', './cmd/server', 'postgres:17-alpine',
    'github.event.pull_request.head.sha || github.sha',
  ]) assert.ok(workflow.includes(evidence), evidence)
  for (const evidence of [
    'XD_DATABASE_URL="$XD_TEST_DATABASE_URL"',
    'XD_JWT_SECRET="pwa-b2b2b1-synthetic-shared-ci-key-only-2026"',
    'XD_STORAGE_ROOT="$CAS"',
    'XD_PWA_B2B2B1_A_SERVER',
    'XD_PWA_B2B2B1_B_SERVER',
    'wait_ready "$PORT_A"', 'wait_ready "$PORT_B"',
    'admin create --username pwa-b2b2b1-owner --password-stdin',
  ]) assert.ok(shell.includes(evidence), evidence)
  assert.ok(config.includes('XD_JWT_SECRET is required'))
  assert.ok(config.includes('XD_DATABASE_URL'))
  assert.ok(server.includes('srv.Router().Run(cfg.ListenAddr)'))
  assert.ok(version.includes('c.JSON(http.StatusOK, version.Metadata())'))
})

test('Actual Caddy with original route block and immutable dual lazy archives', () => {
  for (const evidence of [
    'caddy:2.10.2-alpine',
    'caddy validate --config /etc/caddy/Caddyfile',
    'caddy run --config /etc/caddy/Caddyfile',
    'import xdrive_app',
    'pwa-archive-assets.sh', 'Caddyfile.common'
  ]) assert.ok(shell.includes(evidence), evidence)
  assert.ok(caddy.includes('handle /api/*'))
  assert.ok(caddy.includes('handle /assets/*'))
  assert.ok(caddy.includes('reverse_proxy server:8080'))
  assert.ok(archive.includes('immutable asset collision'))
  for (const evidence of [
    "spawnSync('docker', ['exec', container, 'caddy', 'reload'",
    "assert.notEqual(original, next",
    'version === expected',
    "assert.equal(res.status(), 200)",
    'assert.equal(digest(data), asset.hash)',
    "assert.equal(unknown.status(), 404)",
  ]) assert.ok(chrome.includes(evidence), evidence)
})

test('Real UI single browser JWT and owner survive A to B to A native upstream reload', () => {
  for (const evidence of [
    "chromium.launch(", "page.goto(origin + '/#/app/files'",
    "page.locator('#web-login-username')", "page.locator('#web-login-password')",
    "/api/v1/nodes/root", "/api/v1/me",
    "method: 'POST'",
    "'/directories'",
    "configure(goB)", "configure(goA)",
    "assert.equal(after.token, held.token",
    "assert.equal(rollback.token, held.token)",
    "assert.equal(after.userId, held.userId)",
    "assert.equal(after.rootId, held.rootId)",
    "assert.equal(after.folderStatus, 200)",
    "assert.equal(rollback.folderStatus, 200)",
    "navigator.serviceWorker.controller",
  ]) assert.ok(chrome.includes(evidence), evidence)
  assert.doesNotMatch(chrome, /context\.route\(|route\.fulfill\(|skipWaiting\(/)
})

test('No fake long upload, iOS acceptance, or private payload artifacts', () => {
  assert.ok(chrome.includes('realUploadDuringSwitch: false'))
  assert.ok(chrome.includes('oldSWHeldWaiting: false'))
  assert.ok(chrome.includes('physicalIOS: false'))
  assert.ok(shell.includes('rm -rf "$WORK"'))
  assert.ok(workflow.includes('pwa-b2b2b1-results/summary.json'))
  assert.ok(workflow.includes('Never upload original Go logs'))
  assert.ok(!workflow.includes('private-go-A.log'))
  assert.ok(doc.includes('不是 17 MiB 上传'))
  assert.ok(doc.includes('尚未验证'))
  assert.ok(doc.includes('真实 Caddy'))
  assert.ok(doc.includes('真实 Go'))
})
