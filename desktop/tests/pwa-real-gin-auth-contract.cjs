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
    "assertXDrivePublicShellCache(cache)",
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

test('S2B6 genuine private PNG CAS, authorized Gallery Range and cold Viewer', () => {
  for (const token of [
    'storage.ContentAddressedKey(hash)', 'local.Put(context.Background(), casKey',
    '&meta.MediaMetadata{}', '&meta.PhotoAsset{}', '&meta.PhotoResource{}',
    '"media_node_id": picNode.ID', 'foreignToken, nil, http.StatusNotFound',
  ]) assert.ok(go.includes(token), 'S2B6 Go fixture: ' + token)
  for (const token of [
    "localStorage.getItem('xdrive.access_token')",
    '/api/v1/media/items?range=true&limit=10&offset=0',
    'mediaRange200', 'mediaViewer200', 'mediaViewerColdReload', 'mediaForeign404',
    "const viewerRoute = '#/app/media-viewer?node='",
    "viewerTab.locator('[data-xdrive-web-viewer]').waitFor()",
    "foreignMedia.status(), 404",
  ]) assert.ok(chrome.includes(token), 'S2B6 Chrome: ' + token)
  assert.ok(workflow.includes("github.head_ref == 'test/pwa-real-gallery-viewer-s2b6-20261012'"))
  assert.ok(workflow.includes('x.mediaViewerColdReload'))
  assert.ok(ledger.includes('PWA-S2B6'))
})

test('S2B7: root App observes public-share hash and isolates share-specific password state', () => {
  const app = read('web/src/App.tsx')
  const publicView = read('web/src/PublicShare.tsx')
  for (const evidence of [
    'function xDrivePublicShareTokenFromHash(hash: string)',
    'const [publicShareToken, setPublicShareToken] = useState(',
    "window.addEventListener('hashchange', syncShareRoute)",
    "window.addEventListener('popstate', syncShareRoute)",
    "window.removeEventListener('hashchange', syncShareRoute)",
    "window.removeEventListener('popstate', syncShareRoute)",
    '<PublicShareView key={publicShareToken} token={publicShareToken} />',
  ]) assert.ok(app.includes(evidence), 'missing dynamic share routing: ' + evidence)
  assert.ok(publicView.includes('new XDriveApi()'))
  assert.ok(!publicView.includes('localStorage'), 'public share cannot read logged-in credentials')
  assert.ok(ledger.includes('PWA-S2B7'))
})

test('S2B7: real Chrome Gin public share, denial, history, isolation and revocation', () => {
  for (const evidence of [
    'privateShareTokens = new Set()',
    'redactedBrowserFailure(error)',
    "window.location.hash = '#/s/' + token",
    "const anonymousContext = await browser.newContext(",
    "metadataPath = '/api/v1/public/share'",
    "'/api/v1/public/share/download-ticket'",
    "window.history.back()", "window.history.forward()",
    "'pwa-s2b6-private.png'",
    'publicShareAnonymous', 'publicShareWrongPassword',
    'publicShareHistoryIsolation', 'publicShareRevoked',
    'publicShareViewerReturn', 'publicSharePublicOnlyCache',
    "assertXDrivePublicShellCache(cachePaths)",
  ]) assert.ok(chrome.includes(evidence), 'missing exact S2B7 acceptance: ' + evidence)
  assert.ok(!chrome.includes('context.route(') && !chrome.includes('route.fulfill('))
  assert.ok(workflow.includes("github.head_ref == 'fix/pwa-public-share-hash-history-s2b7-20261012'"))
  assert.ok(workflow.includes('x.publicShareViewerReturn'))
  assert.ok(workflow.includes('x.publicShareRevoked'))
})

test('S2B8 authentic Gallery tile → original decoded PNG Viewer → same-document Back', () => {
  for (const token of [
    "const tileGalleryRoute = '#/app/gallery'",
    "galleryTab.locator('[data-xdrive-media-tile]').first()",
    "await tile.click()",
    "new URLSearchParams(hash.split('?')[1]).get('node') === String(nodeID)",
    "interactiveViewer.locator('[data-xdrive-image-phase=\"original\"]')",
    "image.naturalWidth > 0 && image.naturalHeight > 0",
    "getByRole('button', { name: '返回', exact: true }).first().click()",
    'sameDocument', 'sameHost', 'sameGrid', 'scrollOffsetRestored',
    'galleryTileViewer200', 'galleryTileOriginalDecoded', 'galleryTileViewerReturn',
  ]) assert.ok(chrome.includes(token), 'missing real S2B8 Gallery route and decode: ' + token)
  assert.ok(workflow.includes("github.head_ref == 'test/pwa-gallery-viewer-return-s2b8-20261024'"))
  assert.ok(workflow.includes('galleryTileViewerReturn'))
  assert.ok(!chrome.includes('context.route(') && !chrome.includes('route.fulfill('))
})

test('S2B8 genuine PostgreSQL fixture migrates current quota and person-cluster tables', () => {
  for (const model of [
    '&meta.LocalPushQuotaHold{}',
    '&meta.PhotoFace{}', '&meta.PhotoPersonCluster{}',
    '&meta.PhotoPersonClusterFace{}', '&meta.PhotoPersonClusterState{}',
    '&meta.PhotoPersonSuggestionReview{}',
  ]) assert.ok(go.includes(model), 'real Go browser fixture missing ' + model)
  assert.ok(chrome.includes('const [badTicket] = await Promise.all(['))
  assert.ok(chrome.includes('assert.equal(badTicket.status(), 401)'))
  assert.ok(chrome.includes('currentMeta.count, 0'))
})

test('S2B8: wrong-password share test targets the actual form submit and checks HTTP 401', () => {
  const publicUI = read('web/src/PublicShare.tsx')
  assert.ok(publicUI.includes('type="submit"'))
  assert.ok(publicUI.includes('下载文件'))
  assert.ok(chrome.includes("getByRole('button', { name: '下载文件', exact: true }).click()"))
  assert.ok(chrome.includes("new URL(response.url()).pathname === '/api/v1/public/share/download-ticket'"))
  assert.ok(chrome.includes('assert.equal(badTicket.status(), 401)'))
  assert.ok(chrome.includes('assert.equal(currentMeta.count, 0)'))
})

test('S2B8 failed real browser case records only fixed checkpoint and numeric HTTP status', () => {
  assert.ok(chrome.includes("wrongPasswordTicketStatuses: []"))
  assert.ok(chrome.includes("sample.wrongPasswordTicketStatuses.push(response.status())"))
  assert.ok(chrome.includes("summary.cases.push({ ...sample, failedAt: checkpoint })"))
  assert.ok(chrome.includes("sample.galleryTileOriginalDecoded = true"))
  assert.ok(chrome.includes("sample.galleryTileViewerReturn = true"))
  assert.ok(chrome.includes("assert.equal(badTicket.status(), 401)"))
  assert.ok(chrome.includes("assert.equal(currentMeta.count, 0)"))
})

test('S2B8 real public-share history uses a unique heading locator', () => {
  // The current shared Explorer intentionally renders both a title and a file row
  // for a single file; Playwright strict getByText must not treat these as one.
  const heading = "getByRole('heading', { name: 'pwa-s2b6-private.png', exact: true }).waitFor()"
  assert.equal(chrome.split(heading).length - 1, 3,
    'S2B7 history / Viewer return should resolve the exact visible share heading')
  assert.ok(!chrome.includes("anonymousPage.getByText('pwa-s2b6-private.png', { exact: true }).waitFor()") ||
    chrome.includes("await anonymousPage.locator('input[type=\"password\"]').waitFor()"),
    'share history must not rely on ambiguous duplicate filename text')
  assert.ok(chrome.includes('sample.publicShareHistoryIsolation = true'))
  assert.ok(chrome.includes('sample.publicShareViewerReturn = true'))
})

test('S2B8 real Gallery Back respects actual section route, not an assumed root hash', () => {
  assert.ok(chrome.includes('const callerHash = window.location.hash'))
  assert.ok(chrome.includes('document: document.documentElement, host, grid, offset: host.scrollTop, callerHash'))
  assert.ok(chrome.includes('beforeTile.callerHash'))
  assert.ok(chrome.includes('sameCallerRoute: entry?.callerHash === location.hash'))
  assert.ok(chrome.includes('returned.sameCallerRoute'))
  assert.ok(chrome.includes('sample.galleryBackDiagnostic'))
  assert.ok(chrome.includes('viewerReturn: window.history.state?.viewerReturn === true'))
  assert.ok(!chrome.includes('await galleryTab.waitForFunction(hash => location.hash === hash, tileGalleryRoute)'))
})
