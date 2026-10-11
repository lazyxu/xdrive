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
  for (const key of ['const filesIos27Fixture = { accepted: [], operations: [] }',
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
