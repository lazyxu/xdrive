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

test('09I-C live Mobile/Wide Move and confirmed Delete share one queued Go operation and owner fence', () => {
  for (const label of [
    '"a-mobile-move.txt"', '"b-wide-move.txt"',
    '"c-mobile-delete.txt"', '"d-wide-delete.txt"',
    'mobileMoveTarget', 'wideMoveTarget',
    'meta.FileOperationTypeMove', 'meta.FileOperationTypeDelete',
    'IOS27_FILES_LIVE_GO_MUTATION_QUEUED',
    'foreignOperations != 0', 'operation.ItemsJSON',
  ]) assert.ok(fixture.includes(label), 'missing real Gin/PostgreSQL mutation evidence: ' + label)
  for (const label of [
    'async function queueMutationFromUI(',
    '[data-mobile-files-context-selection-action="move-to"]',
    "name: '移动到…'", "name: '移动到这里'",
    "'[data-mobile-files-context-action=\"delete\"]'", "getByText('删除', { exact: true })", "getByRole('dialog').filter({ hasText: expectedTitle })", "name: '移到回收站'",
    "'/api/v1/file-operations'", "posted.items[0].revision === revision",
    "queued.total_items === 1", 'results.mutationQueues.length === 4',
    "denied === 404", 'new Set(results.mutationQueues.map',
    "await row.click()", "row.getAttribute('aria-selected')", "deleteMenuDiagnostic",
  ]) assert.ok(browser.includes(label), 'missing actual browser move/delete path: ' + label)
  assert.ok(web.includes("onMove={selected => openDestination('move'"))
  assert.ok(web.includes('onRemoveMany(nodes)'))
  assert.ok(mobile.includes('props.onMove([item])'))
  assert.ok(mobile.includes('props.onDelete([item])'))
  assert.doesNotMatch(browser, /route\.fulfill\(/)
})

// MUI v7 forwards aria-label to the Modal root, not the role=dialog Paper.
// The actual Paper has aria-labelledby from the item-specific DialogTitle.
test('09I-C real Delete targets its own dialog by item-specific text, not a generic name/attribute', () => {
  assert.ok(browser.includes("page.getByRole('dialog').filter({ hasText: expectedTitle })"))
  assert.ok(browser.includes("const expectedTitle = '将“' + sourceName + '”移到回收站？'"))
  assert.ok(browser.includes("dialog.locator('.MuiDialogTitle-root').innerText()"))
  assert.ok(browser.includes("title.includes(expectedTitle)"))
  assert.ok(browser.includes("delete-missing-dialog"))
  assert.doesNotMatch(browser, /getByRole\('dialog', \{ name: '确认操作' \}\)/)
  assert.doesNotMatch(browser, /page\.locator\('\[role="dialog"\]\[aria-label=/)
})

test('09I-C single-file Wide Delete selects exactly one row before invoking the real context action', () => {
  assert.ok(browser.includes("if (!mobile && kind === 'delete')"))
  assert.ok(browser.includes('await row.click()'))
  assert.ok(browser.includes("row.getAttribute('aria-selected')"))
  assert.ok(browser.includes("page.getByRole('menuitem').filter({ has: page.getByText('删除', { exact: true }) }).first()"))
  assert.ok(browser.includes("'delete-missing-menu'"))
})

test('09I-C Wide context Delete is located by its visible label, ignoring genuine shortcut suffix', () => {
  assert.ok(browser.includes("page.getByRole('menuitem').filter({ has: page.getByText('删除', { exact: true }) }).first()"))
  assert.ok(!browser.includes("getByRole('menuitem', { name: '删除', exact: true })"))
})

test('09I-D1 genuine 2-item Mobile/Wide selections submit real queued batch Delete to one Server API', () => {
  for (const label of [
    '"e-mobile-batch-a.txt"', '"f-mobile-batch-b.txt"',
    '"g-wide-batch-a.txt"', '"h-wide-batch-b.txt"',
    '"mobile_batch_delete_nodes"', '"wide_batch_delete_nodes"',
    'IOS27_FILES_LIVE_GO_BATCH_DELETE_QUEUED',
    'operation.TotalItems != 2', 'seenGroups[matched]',
    'operation.Status != meta.FileOperationStatusQueued',
  ]) assert.ok(fixture.includes(label), 'missing persisted real-Go batch verification: ' + label)
  for (const label of [
    'async function queueBatchDeleteFromUI(', 'async function findBatchRow(',
    "name: '文件操作菜单'", "'[data-mobile-files-more-menu]'",
    "name: '选择', exact: true", "row.getAttribute('aria-pressed')",
    "name: '删除已选'", "modifiers: ['Control']",
    "row.getAttribute('aria-selected')", "'删除所选项目', { exact: true }",
    '将所选 2 个项目移到回收站？',
    'posted.items.every(item =>', 'queued.total_items === 2',
    "foreignBatch === 404", 'results.batchDeletes.length === 2',
  ]) assert.ok(browser.includes(label), 'missing real Chromium multi-select mutation: ' + label)
  assert.ok(web.includes('onRemoveMany(nodes)'))
  assert.ok(mobile.includes('props.onDelete(selection)'))
  assert.doesNotMatch(browser, /route\.fulfill\(/)
})

test('09I-D1 every viewport arms the real Gin list listener before its guaranteed reload', () => {
  const start = browser.indexOf('for (const viewport of [')
  const end = browser.indexOf('  // Real owner isolation', start)
  const gate = browser.slice(start, end)
  const goto = gate.indexOf("await page.goto(fixture.url + '/#/app/files?dir=' + fixture.root_id,")
  const listener = gate.indexOf('const listResponse = page.waitForResponse(')
  const reload = gate.indexOf("await page.reload({ waitUntil: 'domcontentloaded' })")
  const bytesRead = gate.indexOf('const data = await response.json()', listener)
  assert.ok(start >= 0 && end > start && goto >= 0 &&
    goto < listener && listener < reload && reload < bytesRead,
    'same-hash SPA navigation may not fetch: rearm listener before explicit reload and read that HTTP body')
  assert.equal((gate.match(/await page\.reload\(/g) || []).length, 1,
    'one guaranteed reload, never invalidate the captured response with another navigation')
  assert.ok(gate.includes('new URL(r.url()).pathname === rootPath'))
  assert.ok(gate.includes("r.request().method() === 'GET' && r.status() === 200"))
})


test('09I-D2 actual nested-source Mobile/Wide two-item Copy-to/Move-to use shared persisted queues', () => {
  for (const label of [
    'batch-operation-sources', 'i-mobile-batch-copy-a.txt', 'j-mobile-batch-copy-b.txt',
    'k-wide-batch-copy-a.txt', 'l-wide-batch-copy-b.txt',
    'm-mobile-batch-move-a.txt', 'n-mobile-batch-move-b.txt',
    'o-wide-batch-move-a.txt', 'p-wide-batch-move-b.txt',
    'ready["batch_source_id"]', 'IOS27_FILES_LIVE_GO_BATCH_DESTINATION_QUEUED',
    'operation.Status != meta.FileOperationStatusQueued', 'operation.TotalItems != 2',
    'seen[matched]',
  ]) assert.ok(fixture.includes(label), 'missing genuine PostgreSQL batch destination check: ' + label)
  for (const label of [
    'async function queueBatchDestinationFromUI(',
    "'/#/app/files?dir=' + fixture.batch_source_id",
    "name: '文件操作菜单'", "name: '选择', exact: true",
    "name: '更多已选操作'", "'[data-mobile-files-selection-menu]'",
    "name: '复制到…', exact: true", "name: '移动已选'",
    "modifiers: ['Control']", "row.getAttribute('aria-pressed')",
    "row.getAttribute('aria-selected')",
    "'[data-xdrive-file-explorer-destination-dialog]'",
    'queued.total_items === 2', 'posted.parent_id === targetID', 'validSources',
    'results.batchDestinations.length === 4', 'denied === 404',
  ]) assert.ok(browser.includes(label), 'missing authentic two-file Chromium action: ' + label)
  assert.ok(web.includes("onCopyTo={selected => openDestination('copy', selected, crumbs)}"))
  assert.ok(web.includes("onMove={selected => openDestination('move', selected, crumbs)}"))
  assert.ok(mobile.includes('props.onCopyTo(selection)'))
  assert.ok(mobile.includes('props.onMove(selection)'))
  assert.doesNotMatch(browser, /route\.fulfill\(/)
})


test('09I-D2 nested destination selection walks the real shared picker to its root target', () => {
  const begin = browser.indexOf('async function queueBatchDestinationFromUI(')
  const end = browser.indexOf('async function main()', begin)
  const block = browser.slice(begin, end)
  const open = block.indexOf("const dialog = page.locator('[data-xdrive-file-explorer-destination-dialog]')")
  const root = block.indexOf("await breadcrumbButtons.first().click()", open)
  const choose = block.indexOf("await target.click()", root)
  const submit = block.indexOf("submit.click()", choose)
  assert.ok(open >= 0 && root > open && choose > root && submit > choose,
    'must navigate the real root breadcrumb before choosing a sibling target and submitting')
  assert.ok(block.includes("'[aria-label=\"目标文件夹路径\"] button'"))
  assert.ok(block.includes("'nested destination picker must expose a usable root ancestor crumb'"))
  assert.ok(block.includes('breadcrumbButtons.last().isDisabled()'))
  assert.ok(block.includes('breadcrumbButtons.first().isEnabled()'))
})


const worker = read('internal/api/files_ios27_live_go_worker_effects_test.go')

test('09I-D3 actual Chromium queued operations run real Worker, validate physical CAS and Trash restore', () => {
  for (const required of [
    'srv := &Server{', 'router := srv.Router()',
    'assertIOS27FilesLiveWorkerEffects(t, srv, db, router, peer.URL, token, after.OwnerID,',
    'mobileBatchCopyA.ID', 'wideBatchCopyB.ID', 'mobileBatchMoveA.ID',
    'wideBatchMoveB.ID', 'mobileBatchA.ID', 'wideBatchB.ID',
  ]) assert.ok(fixture.includes(required), 'missing D3 genuine browser source binding: ' + required)
  for (const required of [
    'const expectedOperations = 12',
    'srv.processNextFileOperation(ctx)',
    'meta.FileOperationStatusCompleted',
    'op.ProcessedItems != op.TotalItems',
    'op.ProcessedBytes != op.TotalBytes',
    'clientpkg.New(apiURL, token)', 'client.DownloadTo(ctx, id, &data)',
    'client.Trash(ctx)', 'client.RestoreTrash(ctx, spec.ID, node.Revision)',
    'source.File', 'dest[0].File.SHA256', 'node.Revision != spec.Revision+1',
    'node.TrashRootID == nil', 'remaining, err := client.Trash(ctx)',
    'afterBlobs != beforeBlobs',
    'IOS27_FILES_REAL_WORKER_COPY_COMPLETED',
    'IOS27_FILES_REAL_WORKER_MOVE_COMPLETED',
    'IOS27_FILES_REAL_WORKER_DELETE_TRASH_RESTORE_COMPLETED',
  ]) assert.ok(worker.includes(required), 'missing real Worker/physical CAS proof: ' + required)
  assert.doesNotMatch(worker, /enqueueFileOperation\(|route\.fulfill\(|mockFileOperation\(/)
  assert.ok(ci.includes("startsWith(github.head_ref, 'test/mobile-files-ios27-live-go-')"))
})
