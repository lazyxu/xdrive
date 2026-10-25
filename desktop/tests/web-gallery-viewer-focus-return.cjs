const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'web/src/galleryViewerReturnFocus.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleExports = {}
new Function('exports', compiled)(moduleExports)
const { xDriveCaptureGalleryViewerFocus: capture, xDriveRestoreGalleryViewerFocus: restore } = moduleExports

function makeTile(id, index, connected = true) {
  const calls = []
  const tile = {
    tagName: 'DIV', isConnected: connected,
    dataset: { xdriveMediaNodeId: String(id), xdriveMediaIndex: String(index) },
    closest(selector) { return selector === '[data-xdrive-media-tile]' ? this : null },
    focus(options) { calls.push(options) },
    calls,
  }
  return tile
}
function makeHost(tiles = []) {
  const owned = new Set(tiles)
  return {
    isConnected: true,
    contains(node) { return owned.has(node) },
    querySelector(selector) {
      return tiles.find(tile => tile.isConnected &&
        selector.includes(`data-xdrive-media-index="${tile.dataset.xdriveMediaIndex}"`) &&
        selector.includes(`data-xdrive-media-node-id="${tile.dataset.xdriveMediaNodeId}"`)) ?? null
    },
    attach(tile) { owned.add(tile); tiles.push(tile) },
  }
}
const body = { isConnected: true, tagName: 'BODY' }

test('real focused Gallery tile returns keyboard focus with preventScroll after Viewer closes', () => {
  const tile = makeTile(701, 64)
  const host = makeHost([tile])
  const saved = capture(host, 701, 64, tile)
  assert.equal(saved?.tile, tile)
  assert.equal(restore(host, saved, body), true)
  assert.deepEqual(tile.calls, [{ preventScroll: true }])
  assert.equal(restore(host, saved, tile), true, 'already-focused tile is success')
  assert.equal(tile.calls.length, 1)
})

test('virtualized tile replacement is focusable only with exact Node ID and logical index', () => {
  const old = makeTile(702, 127)
  const host = makeHost([old])
  const saved = capture(host, 702, 127, old)
  old.isConnected = false
  const recycled = makeTile(999, 127)
  host.attach(recycled)
  assert.equal(restore(host, saved, body), false, 'recycled row is not the same photo')
  assert.equal(recycled.calls.length, 0)
  const replacement = makeTile(702, 127)
  host.attach(replacement)
  assert.equal(restore(host, saved, body), true)
  assert.deepEqual(replacement.calls, [{ preventScroll: true }])
})

test('unrelated focus, wrong index, detached host and click-origin without focused tile do not steal focus', () => {
  const tile = makeTile(800, 20)
  const host = makeHost([tile])
  assert.equal(capture(host, 800, 21, tile), null)
  assert.equal(capture(host, 801, 20, tile), null)
  assert.equal(capture(host, 800, 20, null), null)
  const saved = capture(host, 800, 20, tile)
  assert.equal(restore(host, saved, { tagName: 'BUTTON', isConnected: true }), false)
  assert.deepEqual(tile.calls, [])
  host.isConnected = false
  assert.equal(restore(host, saved, body), false)
  assert.deepEqual(tile.calls, [])
})

test('focus return is integrated only into the existing authenticated Gallery scroll-return path', () => {
  const app = fs.readFileSync(path.join(repo, 'web/src/App.tsx'), 'utf8')
  const tile = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  assert.match(tile, /data-xdrive-media-node-id=\{item\.node\.id\}/)
  assert.match(app, /focus: xDriveCaptureGalleryViewerFocus\(/)
  assert.match(app, /focusRestored = xDriveRestoreGalleryViewerFocus\(/)
  assert.match(app, /saved\.ownerApi === api/)
  assert.match(app, /saved\.ownerApi !== api/)
  assert.match(app, /window\.location\.hash === saved\.callerHash/)
  assert.match(app, /Math\.abs\(window\.innerWidth - saved\.viewportWidth\) <= 1/)
  assert.match(app, /window\.setTimeout\(stopReturnGuard, 650\)/)
  // The opener is a DOM identity only: no new HTTP, Owner Range or media token.
  const open = app.slice(app.indexOf('onOpenViewer={(item, context) => {'),
    app.indexOf('const contextID = xDriveCreateWebAppBrowseSession', app.indexOf('onOpenViewer={(item, context) => {')))
  assert.doesNotMatch(open, /fetch\(|api\.mediaItem|api\.node\(/)
})
