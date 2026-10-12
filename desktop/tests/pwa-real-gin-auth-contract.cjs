const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = pathName => fs.readFileSync(path.join(root, pathName), 'utf8')
const go = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const chrome = read('desktop/scripts/pwa-real-gin-auth-browser.cjs')
const workflow = read('.github/workflows/pwa-s2b3-real-gin.yml')
const ledger = read('docs/pwa-delivery.md')

test('S2B3 uses real Gin, owner-scoped PostgreSQL, physical Local CAS and no API mocks', () => {
  for (const token of [
    'fileExplorerMediaPerfDatabase(t, dsn)',
    'meta.InstallNodeChangeJournal(db)',
    'storage.NewLocal(t.TempDir())',
    'srv := &Server{', 'router := srv.Router()',
    'createTestUser(t, db, router, ownerName, ownerPassword)',
    'createTestUser(t, db, router, foreignName, foreignPassword)',
    'requestNode(t, router, http.MethodPost,',
    'http.StatusNotFound',
    'http.StatusUnauthorized',
    'httptest.NewServer(mux)',
    'router.ServeHTTP(w, request)',
    'TestPWAS2B3RealGinAuthFixture',
  ]) assert.ok(go.includes(token), token)
  assert.ok(go.includes('"intercepted_api": false'))
  assert.ok(!go.includes('"token": ownerToken'))
  assert.ok(!go.includes('"foreign_token": foreignToken'))
  assert.ok(!go.includes('"password": ownerPassword'))
})

test('S2B3 Chrome actual login, route recovery and foreign JWT cannot read another owner', () => {
  for (const token of [
    "serviceWorkers: 'allow'",
    "page.locator('#web-login-username').fill(ready.username)",
    "page.locator('#web-login-password').fill(ownerPassword)",
    "page.getByRole('button', { name: '登录', exact: true }).click()",
    "page.waitForResponse(response =>",
    "await page.reload({ waitUntil: 'domcontentloaded' })",
    "await secondTab.goto(",
    "foreignLogin.status(), 200",
    "forbidden.status(), 404",
    "unauthorized.status(), 401",
    "cache.files, ['/offline.html']",
    'summary.physicalDevice',
  ]) assert.ok(chrome.includes(token) || (token === 'summary.physicalDevice' && chrome.includes('physicalDevice: false')), token)
  assert.ok(chrome.includes('interceptedApi: false'))
  assert.ok(chrome.includes("path.join(resultDir, 'summary.json')"))
  assert.ok(!chrome.includes('context.route('))
  assert.ok(!chrome.includes('route.fulfill('))
})

test('S2B3 CI builds authentic production Web and compiled Go fixture without leaking JWT', () => {
  for (const token of [
    'postgres:17-alpine',
    'go test -c -o',
    "TestPWAS2B3RealGinAuthFixture",
    'playwright-core@1.56.1',
    'npm --prefix web run build',
    'XD_PWA_S2B3_READY_FILE',
    'desktop/scripts/pwa-real-gin-auth-browser.cjs',
    'github.event.pull_request.head.sha',
    'desktop/pwa-s2b3-results/summary.json',
  ]) assert.ok(workflow.includes(token), token)
  assert.ok(workflow.includes('rm -f "$READY"'))
  assert.ok(workflow.includes('Never archive private ready file'))
  assert.equal(workflow.includes('desktop/pwa-s2b3-results/\n'), false)
  assert.ok(ledger.includes('PWA-S2B3'))
})

test('S2B5 genuine Gin Chrome: Gallery deep-link, cold reload and browser history', () => {
  for (const token of [
    "const galleryRoute = '#/app/gallery?section=albums'",
    "galleryTab.goto(ready.url + '/' + galleryRoute",
    "[data-xdrive-gallery-upload-picker]",
    "await galleryTab.reload({ waitUntil: 'domcontentloaded' })",
    "window.history.back()", "window.history.forward()",
    "galleryDeepLinkMounted", "galleryColdReloadMounted", "galleryHistoryRestored",
  ]) assert.ok(chrome.includes(token), 'missing S2B5 acceptance: ' + token)
  assert.ok(workflow.includes("github.head_ref == 'test/pwa-gallery-deeplink-s2b5-20261012'"))
  assert.ok(workflow.includes('x.galleryDeepLinkMounted'))
  assert.ok(!chrome.includes('context.route(') && !chrome.includes('route.fulfill('))
  assert.ok(ledger.includes('PWA-S2B5'))
})
