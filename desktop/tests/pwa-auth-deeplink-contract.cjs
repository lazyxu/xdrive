const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const script = read('desktop/scripts/pwa-browser-install-offline.cjs')
const ci = read('.github/workflows/pwa-s2b-auth.yml')
const app = read('web/src/App.tsx')
const runtime = read('web/src/webAppRuntime.ts')
const ledger = read('docs/pwa-delivery.md')

test('S2B2: genuine login is performed in real Chrome, not a pre-seeded access token', () => {
  for (const token of [
    "XD_PWA_S2B_AUTH === '1'", 'handleAuthFixture(req, res, pathname)',
    "'POST /api/v1/auth/login'", "'GET /api/v1/me'",
    "'GET /api/v1/nodes/42'", "'GET /api/v1/nodes/42/children'",
    "'GET /api/v1/sources'", "'GET /api/v1/file-recent'",
    "'POST /api/v1/file-recent/42'",
    "page.locator('#web-login-username').fill('qa-pwa')",
    "page.locator('#web-login-password').fill(",
    "page.getByRole('button', { name: '登录', exact: true }).click()",
    "'fixture-browser-only-token'", 'observed.authFileReads',
  ]) assert.ok(script.includes(token), token)
  assert.ok(script.includes('observed.authLogin, 2'))
  assert.ok(app.includes('persistSession(sessionFromAuth(result))'))
  assert.ok(runtime.includes('window.location.hash'))
})

test('S2B2: authenticated cold reload uses the same Files route without caching private API responses', () => {
  assert.ok(script.includes("await until(() => observed.authFileReads > afterLoginReads"))
  assert.ok(script.includes("assert.equal(new URL(page.url()).hash, expectedHash)"))
  assert.ok(script.includes("result.authenticatedDeepLink = true"))
  assert.ok(script.includes("result.authenticatedColdReload = true"))
  assert.ok(script.includes("assert.deepEqual(cacheAfterLogin.paths, ['/offline.html'])"))
  assert.ok(script.includes("observed.authUnknown, 0"))
  assert.ok(script.includes('observed.authUnknownRoutes.push(key)'))
  assert.ok(script.includes('observed.authRecentTouches.push(id)'))
  assert.ok(script.includes("observed.unauthorized, 0"))
})

test('S2B2: exact-head CI keeps browser secrets fixture-only and output minimal', () => {
  for (const key of [
    "XD_PWA_S2B_AUTH: '1'", 'playwright-core@1.56.1',
    'desktop/scripts/pwa-browser-install-offline.cjs',
    'desktop/pwa-s2b2-results/summary.json',
    'npm --prefix web run build',
    'github.event.pull_request.head.sha',
  ]) assert.ok(ci.includes(key), key)
  assert.equal(ci.includes('desktop/pwa-s2b2-results/\n'), false)
  assert.ok(script.includes('physicalDevice: false'))
  assert.ok(ledger.includes('PWA-S2B2'))
})
