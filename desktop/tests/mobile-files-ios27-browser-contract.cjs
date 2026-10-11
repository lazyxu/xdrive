const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const runner = read('desktop/scripts/mobile-web-app-browser.cjs')
const workflow = read('.github/workflows/ci.yml')
const web = read('web/src/WebFileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')

test('09C: real Chrome 375/390/899/900 acceptance is actually part of Web CI', () => {
  for (const key of ['test/mobile-files-ios27-real-chrome-', '--scenario=files-ios27-chrome',
    'files-ios27-browser-parity', 'XD_PR_HEAD', 'tested-checkout.sha']) {
    assert.ok(workflow.includes(key), 'missing browser CI contract: ' + key)
  }
  assert.ok(runner.includes('async function filesIos27ChromeAcceptance(origin)'))
  for (const width of [375, 390, 899, 900]) {
    assert.ok(runner.includes('{ width: ' + width + ', height:'),
      'missing a measured boundary viewport: ' + width)
  }
})

test('09C: authentic built Web and Mobile use exactly one business and scroll owner', () => {
  for (const key of ['max-width:899.95px', 'compactMobile ? (', '<MobileFiles',
    'useXDriveFileExplorerWorkspace', 'getSelectionActionDisabledReason={getSelectionActionDisabledReason}']) {
    assert.ok(web.includes(key), 'shared Web adapter regressed: ' + key)
  }
  for (const key of ['data-xdrive-mobile-files', 'data-xdrive-file-explorer-scroll-host']) {
    assert.ok(mobile.includes(key), 'Mobile viewport contract missing: ' + key)
  }
  assert.ok(!mobile.includes('new XDriveApi('))
  assert.ok(!mobile.includes('fetch('))
  assert.ok(runner.includes("'[data-mobile-files-item]'"))
  assert.ok(runner.includes("'[data-xdrive-file-explorer-item]'"))
})

test('09C: real browser fixture checks canonical Server Node/revision and operation payload', () => {
  for (const key of ['const filesIos27Fixture = {', 'accepted: [], operations: []',
    "assert.deepEqual(body.items, [{ id: 100, revision: 1 }])",
    "assert.equal(body.parent_id, 1", "assert.equal(body.type, 'copy')",
    'GET /api/v1/nodes/1/children', 'FileExplorer route preserved after queued Server operation',
    'physicalIphone: false, liveServer: false',
    "check('no unknown API or external requests'"]) {
    assert.ok(runner.includes(key), 'missing real browser contract: ' + key)
  }
})

test('09C: screenshot evidence is tied to exact tested code, without claiming physical iOS', () => {
  for (const key of ['result.builtWebSHA256', 'result.runnerSHA256',
    'files-ios27-transport-parity', 'page.screenshot({ path: path.join(outputDir']) {
    assert.ok(runner.includes(key), 'missing source/screenshot evidence: ' + key)
  }
  assert.ok(workflow.includes('npm run build'))
  assert.ok(workflow.includes('npm install --prefix'))
  assert.ok(workflow.includes('node ../desktop/scripts/mobile-web-app-browser.cjs'))
})

test('09C: native Chrome measures settled 44px menu targets after Grow transition', () => {
  // A CSS minHeight:44 alone is not evidence while MUI Grow is scaled.
  // Assert the real bounding-box gate and both enter/settled diagnostics.
  for (const needle of [
    'const opening = {}', 'const settled = {}',
    'await page.waitForTimeout(400)',
    'paperTransform: paperStyle?.transform',
    'settled[action].boxHeight >= 43.5',
    'parseFloat(settled[action].cssMinHeight) >= 44',
  ]) {
    assert.ok(runner.includes(needle), 'missing transition-aware physical hitbox gate: ' + needle)
  }
})

test('09C: Mobile 899px MUI sm MenuItem auto min-height cannot override 44px context targets', () => {
  // The real Chrome measurement found a steady-state computed 0px min-height
  // at 899px despite the earlier per-row sx.minHeight=44 source contract.
  // A descendant selector scoped to the context Popover paper outranks MUI's
  // @media (min-width:600px) default for shared and Mobile-local MenuItems.
  assert.ok(mobile.includes("'& .MuiMenuItem-root': { minHeight: MIN_TOUCH }"))
  assert.ok(mobile.includes("maxHeight: 'min(70dvh, 560px)'"))
  assert.ok(runner.includes("parseFloat(settled[action].cssMinHeight) >= 44"))
  assert.ok(runner.includes("settled[action].boxHeight >= 43.5"))
})

test('09C2: native Chrome traverses 403 → 409 → success for Mobile and wide rename', () => {
  for (const item of [
    "const filesIos27Fixture = {",
    "if (filesIos27ChromeScenario && key === 'PATCH /api/v1/nodes/100')",
    "renameRejectQueue = [403, 409]",
    "filesIos27Fixture.renameAttempts.push(attempt)",
    "filesIos27RenameAcceptance(viewport, narrow, row)",
    "filesIos27Fixture.renameAttempts.length === viewports.length * 3",
    "allNodes.get(100).revision === 2",
  ]) {
    assert.ok(runner.includes(item), 'Missing real browser rename parity gate: ' + item)
  }
})

test('09C2: browser requires exact immutable If-Match on all denied and accepted API writes', () => {
  for (const contract of [
    "assert.equal(request.headers()['if-match'], '\"1\"'",
    "filesIos27Fixture.renameRejectQueue.shift() ?? 200",
    "status === 403", "status !== 200",
    "return {", "const node = allNodes.get(100)",
    "allNodes.get(100).revision === 1",
  ]) {
    assert.ok(runner.includes(contract), 'Missing Server fixture guard: ' + contract)
  }
})

test('09C2: native Chrome handles the actual two presentations while sharing one Web rename adapter', () => {
  const shared = read('ui/shared/src/mui/FileExplorer.tsx')
  const name = read('ui/shared/src/mui/FileNameDialog.tsx')
  for (const key of ["page.locator('[data-mobile-files-item-rename]')",
    "page.getByRole('menuitem', { name: /重命名/ })",
    "page.getByRole('dialog', { name: /^重命名/ })",
    "page.getByRole('textbox', { name: '重命名 document-001.txt', exact: true })",
    "'/api/v1/nodes/100'", "page.screenshot({ path: path.join(outputDir"]) {
    assert.ok(runner.includes(key), 'Chrome acceptance must exercise actual UI: ' + key)
  }
  assert.ok(mobile.includes('<XDriveFileNameDialog'))
  assert.ok(name.includes('xDriveFileNameValidationError'))
  assert.ok(shared.includes('const submitRename = async'))
  assert.ok(web.includes('api.rename(node.id, node.revision, name)'))
  assert.ok(!mobile.includes('api.rename('))
})

test('09C2: each width uses a clean built-Web document after resetting the canonical Server fixture', () => {
  for (const fragment of [
    "Object.assign(allNodes.get(100), { name: 'document-001.txt', revision: 1 })",
    "rootChildren.find(node => node.id === 100) === allNodes.get(100)",
    "await page.reload({ waitUntil: 'domcontentloaded' })",
  ]) {
    assert.ok(runner.includes(fragment), 'cross-viewport rename trials cannot reuse stale SPA state: ' + fragment)
  }
})


test('09E: native Chrome checks More/Sort/selection menu hitboxes at 375/390/899px', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  assert.ok(mobile.includes('const MOBILE_FILES_MENU_TOUCH_SX = {'))
  assert.ok(mobile.includes("'& .MuiMenuItem-root': { minHeight: MIN_TOUCH }"))
  for (const name of [
    'data-mobile-files-selection-menu', 'data-mobile-files-more-menu',
    'data-mobile-files-arrange-menu', 'data-mobile-files-saved-search-menu',
    'data-mobile-files-collection-menu',
  ]) assert.ok(mobile.includes(name), 'missing scoped menu: ' + name)
  assert.match(runner, /if \(narrow\) \{\s*await filesIos27MobileMenuTouchAcceptance\(viewport\);/)
  for (const name of ["menu.locator('.MuiMenuItem-root').evaluateAll",
    'item.boxHeight >= 43.5', 'parseFloat(item.cssMinHeight) >= 44',
    "await sample('more')", "await sample('arrange')", "await sample('selected')",
    'filesIos27RenameAcceptance(viewport, narrow, row)']) {
    assert.ok(runner.includes(name), 'missing actual native Chrome acceptance: ' + name)
  }
})


test('09F: actual Chromium Recent/Favorites/Saved Search collection menus share Web Server DTOs', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.ok(runner.includes('async function filesIos27CollectionMenusAcceptance(origin)'))
  assert.ok(runner.includes('await filesIos27CollectionMenusAcceptance(origin)'))
  for (const text of [
    "'[data-mobile-files-collection-row=\"recent\"]'",
    "'[data-mobile-files-collection-row=\"favorites\"]'",
    "'[data-mobile-files-saved-options=\"17\"]'",
    "await page.keyboard.press('Shift+F10')",
    "'[data-mobile-files-collection-action=\"copy\"]'",
    "'/api/v1/nodes/103'", "'/api/v1/file-favorites/104'",
    "'/api/v1/file-saved-searches/17'",
    "await sampleMenu('recent-keyboard', 4)",
    "await sampleMenu('favorites', 4)",
    "await sampleMenu('saved-search', 3)",
    "parseFloat(item.computedMinHeight) >= 44",
    "deniedSaved.status() === 403", "acceptedSaved.status() === 204",
    "filesIos27Fixture.favoriteNodeIDs.length === 0",
    "filesIos27Fixture.savedSearches.length === 0",
    "writesAfter === writesBefore",
  ]) assert.ok(runner.includes(text), '09F missing physical browser/API acceptance: ' + text)
  for (const field of [
    "onCollectionAction={collectionAction}",
    "onUnfavorite={id => favorites.unfavorite(id)}",
    "onDeleteSavedSearch={id => organization.deleteSavedSearch(id)}",
    "const node = await api.node(entry.id)",
  ]) assert.ok(adapter.includes(field), 'collection action must remain owned by wide Web: ' + field)
  for (const key of [
    'data-mobile-files-collection-row={owner}',
    'data-mobile-files-saved-options={entry.id}',
    'MOBILE_FILES_MENU_TOUCH_SX',
    'props.onCollectionAction?.(entry, action)',
  ]) assert.ok(mobile.includes(key), 'Mobile must retain shared presentation: ' + key)
  assert.ok(!mobile.includes('new XDriveApi('))
  assert.ok(!mobile.includes('fetch('))
})


test('09G: Chrome collection DELETE success matches genuine Gin 204 and one shared REST adapter', () => {
  const favoriteGo = read('internal/api/file_favorites.go')
  const savedGo = read('internal/api/file_organization.go')
  const favoritePG = read('internal/api/file_favorites_integration_test.go')
  const savedPG = read('internal/api/file_organization_integration_test.go')
  const api = read('web/src/api.ts')
  const web = read('web/src/WebFileExplorer.tsx')
  const mobile = read('web/src/MobileFiles.tsx')
  for (const token of [
    'filesIos27Fixture.rejectNextUnfavorite ? 403 : 204',
    'filesIos27Fixture.rejectNextSavedDelete ? 403 : 204',
    'acceptedFavorite.status() === 204',
    'acceptedSaved.status() === 204',
    '[[104,403],[104,204]]',
    '[[17,403],[17,204]]',
    'if (body?.__fixtureNoContent)',
    'await route.fulfill({ status: 204 })',
  ]) assert.ok(runner.includes(token), 'browser must test actual empty-body Gin 204: ' + token)
  assert.ok(favoriteGo.includes('Where("owner_id = ? AND node_id = ?", userID(c), nodeID)'))
  assert.ok(favoriteGo.includes('c.Status(http.StatusNoContent)'))
  assert.ok(savedGo.includes('if result.RowsAffected == 0'))
  assert.ok(savedGo.includes('fail(c, http.StatusNotFound, "saved search not found")'))
  assert.ok(favoritePG.includes('foreign DELETE modified A'))
  assert.ok(savedPG.includes('foreign saved-rule writes mutated A'))
  assert.ok(api.includes('if (response.status === 204) return undefined as T'))
  assert.ok(web.includes('onUnfavorite={id => favorites.unfavorite(id)}'))
  assert.ok(web.includes('onDeleteSavedSearch={id => organization.deleteSavedSearch(id)}'))
  assert.ok(!mobile.includes('new XDriveApi('))
  assert.ok(!mobile.includes('fetch('))
})

test('09H: mobile Files breadcrumb navigation uses measured 44px hit targets', () => {
  assert.match(mobile,
    /data-mobile-files-crumb-id=\{String\(crumb\.id\)\}[\s\S]{0,450}minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, flexShrink: 0/)
  assert.ok(runner.includes('async function filesIos27BreadcrumbTouchAcceptance(viewport, origin)'))
  assert.ok(runner.includes('await filesIos27BreadcrumbTouchAcceptance(viewport, origin)'))
  for (const required of [
    'data-mobile-files-crumb-id="1"',
    'data-mobile-files-crumb-id="2"',
    'boxWidth >= 43.5 && item.boxHeight >= 43.5',
    'parseFloat(item.cssMinWidth) >= 44 && parseFloat(item.cssMinHeight) >= 44',
    String.raw`page.waitForURL(/\/files\?dir=1$/)`,
    "page.locator('[data-xdrive-file-explorer-scroll-host]').count() === 1",
  ]) assert.ok(runner.includes(required), 'Missing real browser breadcrumb gate: ' + required)
  assert.ok(!mobile.includes('new XDriveApi('))
  assert.ok(!mobile.includes('fetch('))
})

test('09H: StrictMode cleanup releases only its own deep-link navigation request', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  assert.match(web, /const routedRequest = \{\s*directoryID: initialDirectoryID,\s*lifecycleKey,\s*navigationIntentID,\s*dispatched: false,\s*\}/)
  assert.ok(web.includes('routedDirectoryRef.current = routedRequest'))
  assert.ok(web.includes('const pendingRoute = routedDirectoryRef.current'))
  assert.ok(web.includes('isNavigationIntentCurrent(pendingRoute.navigationIntentID)'))
  assert.ok(web.includes('if (routedDirectoryRef.current === routedRequest && !routedRequest.dispatched)'))
  assert.ok(web.includes('routedRequest.dispatched = true'))
  assert.ok(web.includes('routedDirectoryRef.current.directoryID !== initialDirectoryID'))
  assert.ok(web.includes('routedDirectoryRef.current.lifecycleKey !== lifecycleKey'))
  assert.ok(web.includes('if (!initialDirectoryID) return'))
  assert.ok(!web.includes('if (!initialDirectoryID || current?.id === initialDirectoryID) return'))
  assert.ok(web.includes('if (!active || !isNavigationIntentCurrent(navigationIntentID)) return'))
  assert.ok(runner.includes('await root.waitFor()'))
  assert.ok(runner.includes('await folder.waitFor()'))
  assert.ok(runner.includes('nested-directory range loaded by the shared Server adapter'))
  assert.ok(runner.includes("key.startsWith('user GET /api/v1/nodes/2/children')"))
})

test('09H: browser verifies ancestor navigation and same-App deep-link re-entry', () => {
  assert.ok(runner.includes('ancestor navigation does not bounce to the old nested route'))
  assert.ok(runner.includes('await page.waitForTimeout(250)'))
  assert.ok(runner.includes('directory changes can re-enter the old route in the same app'))
  assert.ok(runner.includes("location.hash = '#/app/files?dir=2'"))
  assert.ok(runner.includes('await folder.waitFor()'))
  assert.ok(runner.includes('same shared virtual scroll owner after route re-entry'))
})

test('09H: explicit root deep links outrank persisted folder restoration in Chrome', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  assert.ok(web.includes('A URL-provided destination is authoritative'))
  assert.ok(runner.includes('explicit directory deep link overrides a restored last-folder session'))
  assert.ok(runner.includes("page.url().endsWith('/files?dir=1')"))
  assert.ok(runner.includes('await page.waitForTimeout(250)'))
})

test('09H: explicit URL overrides saved-session restore without forking the workspace', () => {
  const navigation = read('ui/shared/src/mui/FileExplorerNavigation.ts')
  const workspace = read('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
  const web = read('web/src/WebFileExplorer.tsx')
  assert.ok(navigation.includes('skipInitialSessionRestore = false'))
  assert.ok(navigation.includes("initialNavigationSourceRef.current === 'session' && !skipInitialSessionRestore"))
  assert.ok(navigation.includes("initialSessionRestorePendingRef.current = source === 'session' && !skipInitialSessionRestore"))
  assert.match(navigation, /if \(skipInitialSessionRestore\) \{\s*initialSessionRestorePendingRef\.current = false\s*return/)
  assert.ok(workspace.includes('skipInitialSessionRestore,'))
  assert.ok(web.includes('skipInitialSessionRestore: Boolean(initialDirectoryID)'))
  assert.ok(runner.includes('explicit directory deep link overrides a restored last-folder session'))
})
