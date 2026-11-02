'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const filmstrip = read('ios/XDriveIOS/NativeCloudPhotoAssetViewerFilmstrip.swift')
const policy = read('ios/XDriveIOS/NativeCloudPhotoAssetFilmstripPolicy.swift')
const assertions = read('ios/tests/NativeCloudPhotoAssetFilmstripPolicyChecks.swift')
const gallery = read('ios/XDriveIOS/NativeServerMediaGallery.swift')

test('cloud PhotoAsset filmstrip enforces an exact current Owner range and revision', () => {
  assert.match(policy, /static let maximumLoaded = 48/)
  assert.match(policy, /Set\(loaded\.map\(\\\.nodeID\)\)\.count == loaded\.count/)
  assert.match(policy, /loaded\.firstIndex\(of: current\)/)
  assert.match(policy, /loaded\.contains\(requested\)/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudFilmstripPolicy\.selectedIndex/)
  assert.match(filmstrip, /XDriveIOSNativeCloudFilmstripPolicy\.target/)
  assert.match(filmstrip, /visible\.contains\(where: \{ \$0\.sameVisibleRevision\(as: current\) \}\)/)
  assert.match(filmstrip, /visible\.contains\(where: \{\s*\$0\.sameVisibleRevision\(as: item\)/)
  for (const phrase of [
    'Owner revoked', 'unloaded Owner range', 'old Node revision',
    'current Node revised', 'media kind changed', 'filename identity changed',
    'unbounded Owner page', 'duplicate Node identity',
    'zero revision rejected', 'unsupported kind rejected'
  ]) assert.ok(assertions.includes(phrase), 'missing Swift regression: ' + phrase)
})

test('visible-only cloud filmstrip thumbnails are authenticated and retired on scope change', () => {
  assert.match(filmstrip, /LazyHStack/)
  assert.match(filmstrip, /login\.verifiedAuthorization\(\)/)
  assert.match(filmstrip, /XDriveIOSNativeMediaGalleryReader\(/)
  assert.match(filmstrip, /try await reader\.thumbnail\(item\)/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, openedOwner\)/)
  assert.match(filmstrip, /\.task\(id: identity\)/)
  assert.match(filmstrip, /\.onChange\(of: login\.owner\) \{ _ in image = nil \}/)
  assert.match(filmstrip, /\.onDisappear \{ image = nil \}/)
  assert.doesNotMatch(filmstrip + policy, /UserDefaults|UploadSession|WKWebView|PHAssetCreationRequest|requestImage\(/)
})

test('actual PhotoAsset L3 Viewer mounts strip with the existing navigation admission', () => {
  const detail = gallery.slice(gallery.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    gallery.indexOf('/// Root and album-specific media wall'))
  assert.match(detail, /private func selectFilmstrip\(_ next: XDriveIOSNativeMediaItem\)/)
  assert.match(detail, /guard ownerAuthorized, !rangeCrossing, !photosRestoreBusy/)
  assert.match(detail, /XDriveIOSNativeCloudFilmstripPolicy\.target\(/)
  assert.match(detail, /visibleItems\.first\(where: \{\s*\$0\.sameVisibleRevision\(as: next\)/)
  assert.match(detail, /onNavigate\?\(target\) == true/)
  assert.match(detail, /cancelPhotosRestore\(\)[\s\S]*?retirePreview\(\)[\s\S]*?activeItem = target/)
  assert.match(detail, /XDriveIOSNativeCloudPhotoAssetFilmstrip\(/)
  assert.match(detail, /current: viewed, loaded: visibleItems/)
  assert.match(detail, /onSelect: \{ next in selectFilmstrip\(next\) \}/)
  assert.match(detail, /\.safeAreaInset\(edge: \.bottom\)/)
})
