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
