'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const view = read('ios/XDriveIOS/NativeLocalPhotoViewerFilmstrip.swift')
const policy = read('ios/XDriveIOS/NativeLocalPhotoViewerFilmstripPolicy.swift')
const swift = read('ios/tests/NativeLocalPhotoViewerFilmstripPolicyChecks.swift')

test('only one authorized bounded PhotoKit source may supply a filmstrip target', () => {
  assert.match(policy, /static let maximumLoaded = 64/)
  assert.match(policy, /Set\(loaded\.map\(\\\.id\)\)\.count == loaded\.count/)
  assert.match(policy, /loaded\.firstIndex\(of: current\)/)
  assert.match(policy, /loaded\.contains\(requested\)/)
  assert.match(view, /phase == \.active && authorized/)
  assert.match(view, /XDriveIOSNativeLocalFilmstripPolicy\.selectedIndex/)
  assert.match(view, /XDriveIOSNativeLocalFilmstripPolicy\.target/)
  assert.match(view, /onSelect\(item\)/)
  for (const term of [
    'revoked permission', 'other page', 'changed target revision',
    'changed current revision', 'oversize page', 'duplicate identifier',
    'unsupported kind', 'invalid live video', 'changed kind'
  ]) assert.ok(swift.includes(term), 'missing Swift verification: ' + term)
})

test('visible-only native filmstrip thumbs cannot request iCloud or retain retired pixels', () => {
  assert.match(view, /ScrollViewReader/)
  assert.match(view, /LazyHStack/)
  assert.match(view, /scroll\.scrollTo\(current\.id, anchor: \.center\)/)
  assert.match(view, /options\.isNetworkAccessAllowed = false/)
  assert.match(view, /asset\.creationDate == item\.capturedAt/)
  assert.match(view, /asset\.modificationDate == item\.modifiedAt/)
  assert.match(view, /self\.generation == token/)
  assert.match(view, /PHImageManager\.default\(\)\.cancelImageRequest\(requestID\)/)
  assert.match(view, /\.onDisappear \{ loader\.cancel\(\) \}/)
  assert.doesNotMatch(view + policy, /URLSession|UploadSession|Bearer|UserDefaults|WKWebView|isNetworkAccessAllowed = true/)
})

test('actual local PhotoKit Viewer mounts the filmstrip inside its existing L3 bottom controls', () => {
  const gallery = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
  const detail = gallery.slice(gallery.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    gallery.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'))
  assert.match(detail, /private func selectFilmstrip\(_ next: XDrivePhotoKitScanCandidate\)/)
  assert.match(detail, /guard currentPageAuthorized, !crossing, !photoActionBusy,/)
  assert.match(detail, /!model\.downloadingFromICloud, photoShareSession == nil/)
  assert.match(detail, /XDriveIOSNativeLocalFilmstripPolicy\.target\(/)
  assert.match(detail, /current: filmstripKey\(viewed\), requested: filmstripKey\(next\)/)
  assert.match(detail, /in: keys, authorized: currentPageAuthorized/)
  assert.match(detail, /\) != nil else \{ return \}\s*show\(next\)/)
  assert.match(detail, /if currentPageAuthorized && visibleItems\.count > 1 \{/)
  assert.match(detail, /XDriveIOSNativeLocalViewerFilmstrip\(/)
  assert.match(detail, /current: viewed,\s*loaded: visibleItems,/)
  assert.match(detail, /onSelect: \{ next in selectFilmstrip\(next\) \}/)
  assert.match(detail, /\.safeAreaInset\(edge: \.bottom\)/)
  assert.match(detail, /\.onChange\(of: changes\.generation\)/)
  assert.match(detail, /\.task\(id: viewed\.id\)/)
  assert.doesNotMatch(detail, /filmstrip.*UserDefaults|filmstrip.*URLSession/)
})
