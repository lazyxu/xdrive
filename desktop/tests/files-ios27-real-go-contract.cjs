const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const fixture = read('internal/api/files_ios27_live_go_browser_integration_test.go')
const browser = read('desktop/scripts/files-ios27-real-go-browser.cjs')
const ci = read('.github/workflows/ci.yml')
const web = read('web/src/WebFileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')

test('09I-A genuine Chromium uses production Gin/PostgreSQL and no synthetic REST fulfilment', () => {
  for (const label of [
    'TestIOS27FilesLiveGoFixture', 'fileExplorerMediaPerfDatabase(t, dsn)',
    'meta.InstallNodeChangeJournal(db)', 'router.ServeHTTP(w, r)',
    '&meta.PhotoIntelligenceReanalyzeIntent{}',
    '&meta.BackgroundOwnerCancellation{}', '&meta.ArchivePrepareRun{}',
    'createTestUser(t, db, router', 'http.StatusNotFound',
    'IOS27_FILES_LIVE_GO_VERIFIED', 'os.WriteFile(readyPath, payload, 0600)',
  ]) assert.ok(fixture.includes(label), 'missing actual-Go fixture: ' + label)
  for (const label of [
    'actualGoServer: true, postgresql17: true',
    'interceptedAPI: false', 'page.waitForResponse(',
    'response.request().postDataJSON()', 'same PostgreSQL Node ID and revision',
    'actual Gin rename response', 'actual Node revision header',
    'real PostgreSQL foreign-owner Node must be invisible',
  ]) assert.ok(browser.includes(label), 'missing real-browser contract: ' + label)
  assert.doesNotMatch(browser, /route\.fulfill\(|__fixtureStatus|local-browser-qa-token/)
  assert.ok(browser.includes('return route.continue()'))
  assert.ok(browser.includes("results.patches.map(item => item.actualStatus).join(',') === '409,200,409,200'"))
})

test('09I-A Mobile/Wide four-width test shares one Web adapter and virtualizer', () => {
  for (const width of [375, 390, 899, 900]) {
    assert.ok(browser.includes('width: ' + width), 'missing measured viewport ' + width)
  }
  assert.ok(browser.includes('[data-xdrive-file-explorer-scroll-host]'))
  assert.ok(browser.includes('[data-xdrive-mobile-app-header]'))
  assert.ok(browser.includes('[data-xdrive-workspace-background] .MuiAppBar-root'))
  assert.ok(browser.includes("mobile ? Math.abs(headerHeight - 52) <= 1 : headerHeight >= 48"))
  assert.ok(browser.includes('[data-mobile-files-item-rename]'))
  assert.ok(browser.includes('[data-xdrive-file-explorer-item]'))
  assert.ok(browser.includes("await screenshot('live-go-mobile-409')"))
  assert.ok(browser.includes("await screenshot('live-go-wide-409')"))
  assert.ok(web.includes('useXDriveFileExplorerWorkspace'))
  assert.ok(web.includes('useXDriveFileExplorerOperationController'))
  assert.ok(mobile.includes('props.onRename(renaming, name)'))
  assert.doesNotMatch(mobile, /new XDriveApi\(|fetch\(['"]\/api/)
})

test('09I-A exact-head CI reuses Go API PostgreSQL17 and never publishes JWTs', () => {
  assert.ok(ci.includes('Actual Chromium Files 375/390/899/900 to Gin and PostgreSQL17'))
  assert.ok(ci.includes("startsWith(github.head_ref, 'test/mobile-files-ios27-live-go-')"))
  assert.ok(ci.includes('XD_FILES_PR_HEAD: ${{ github.event.pull_request.head.sha }}'))
  assert.ok(ci.includes('go test -c -o "$RUNNER_TEMP/xdrive-files-live-go-api.test"'))
  assert.ok(ci.includes('desktop/scripts/files-ios27-real-go-browser.cjs'))
  assert.ok(ci.includes("grep -q 'IOS27_FILES_LIVE_GO_VERIFIED'"))
  assert.ok(ci.includes('name: files-ios27-real-go-postgres'))
  assert.ok(ci.includes('path: ${{ runner.temp }}/xdrive-ios27-files-live-go/'))
  assert.ok(ci.includes('rm -f "$READY"'))
  assert.ok(!browser.includes('JSON.stringify(fixture)'))
  assert.ok(!browser.includes('results.token'))
  assert.ok(ci.includes('--scenario=files-ios27-chrome'))
})

test('09I-B real Mobile/Wide Copy-to queues persist exact Node IDs, revisions, destinations and owner isolation', () => {
  for (const label of [
    'mobile-copy-target', 'wide-copy-target', 'foreignRoot := requestNode',
    'IOS27_FILES_LIVE_GO_COPY_QUEUED', 'operation.ItemsJSON',
    'len(queued) != 2', 'meta.FileOperationTypeCopy',
  ]) assert.ok(fixture.includes(label), 'missing real PostgreSQL copy proof: ' + label)
  for (const label of [
    'async function queueCopyFromUI(', '[data-mobile-files-context-selection-action="copy-to"]',
    "name: '复制到…'", '[data-xdrive-file-explorer-destination-dialog]',
    "'/api/v1/file-operations'", 'queued.parent_id === targetID',
    'posted.items[0].revision === fixture.node_revision + 2',
    'foreignCopy === 404', 'results.copyQueues.length === 2',
  ]) assert.ok(browser.includes(label), 'missing real Chromium copy contract: ' + label)
  assert.doesNotMatch(browser, /route\.fulfill\(/)
  assert.ok(web.includes('useXDriveFileExplorerOperationController'))
  assert.ok(mobile.includes('props.onCopyTo([item])'))
})
