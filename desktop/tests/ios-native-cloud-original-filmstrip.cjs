'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const policy = read('ios/XDriveIOS/NativeCloudOriginalFilmstripPolicy.swift')
const filmstrip = read('ios/XDriveIOS/NativeCloudOriginalViewerFilmstrip.swift')
const gallery = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const checks = read('ios/tests/NativeCloudOriginalFilmstripPolicyChecks.swift')

test('cloud originals filmstrip stays in immutable, exact Owner 48-item selection', () => {
  assert.match(policy, /static let maximumLoaded = 48/)
  assert.match(policy, /Set\(loaded\.map\(\\\.nodeID\)\)\.count == loaded\.count/)
  assert.match(policy, /loaded\.firstIndex\(of: current\)/)
  assert.match(policy, /loaded\.contains\(requested\)/)
  assert.match(filmstrip, /phase == \.active && authorized/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudOriginalFilmstripPolicy\.target\(/)
  assert.match(filmstrip, /onSelect\(node\)/)
  for (const phrase of [
    'Owner revoked', 'outside current 48', 'changed Node revision',
    'reused Node with different name', 'changed original size',
    'changed media type', 'current Node revised', 'oversized window',
    'duplicate Node ID', 'negative original size', 'folder rejected',
    'Live ZIP placeholder admitted without thumbnail'
  ]) assert.ok(checks.includes(phrase), 'missing Swift executable test: ' + phrase)
})

test('lazy current-Owner thumbnail uses existing authenticated derivative, never Live ZIP original', () => {
  assert.match(filmstrip, /LazyHStack/)
  assert.match(filmstrip, /\.task\(id: identity\)/)
  assert.match(filmstrip, /guard authorized, !node\.isLiveArchive,/)
  assert.match(filmstrip, /login\.verifiedAuthorization\(\)/)
  assert.match(filmstrip, /XDriveIOSNativeCloudOriginalReader\(/)
  assert.match(filmstrip, /try await reader\.thumbnail\(node\)/)
  assert.match(filmstrip, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, owner\)/)
  assert.match(filmstrip, /\.onChange\(of: login\.owner\) \{ _ in image = nil \}/)
  assert.match(filmstrip, /\.onDisappear \{ image = nil \}/)
  assert.match(filmstrip, /scroll\.scrollTo\(current\.id, anchor: \.center\)/)
  assert.doesNotMatch(filmstrip, /livePreview\(|downloadOriginal|URLSession|UploadSession|WKWebView|UserDefaults/)
})

test('original Viewer selects only same revision and retires old player, Live resources and export', () => {
  const v = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    gallery.indexOf('/// SwiftUI\'s ForEach identity'))
  assert.match(v, /private func selectFilmstrip\(_ next: XDriveIOSNativeCloudOriginal\)/)
  assert.match(v, /guard currentOwnerAuthorized, !exporter\.busy, !restoringToPhotos/)
  assert.match(v, /loadedNodes\.first\(where: \{/)
  assert.match(v, /XDriveIOSNativeCloudOriginalFilmstripPolicy\.target\(/)
  assert.match(v, /onViewed\?\(target\) == true/)
  assert.match(v, /cancelPhotoRestore\(\)[\s\S]*?exporter\.invalidate\(\)[\s\S]*?player\?\.pause\(\)[\s\S]*?liveResources\?\.discard\(\)[\s\S]*?activeNode = target/)
  assert.match(v, /XDriveIOSNativeCloudOriginalViewerFilmstrip\(/)
  assert.match(v, /loaded: loadedNodes/)
  assert.match(v, /onSelect: \{ next in selectFilmstrip\(next\) \}/)
  assert.match(v, /if showChrome && \(loadedNodes\.count > 1/)
  assert.match(v, /\.onChange\(of: login\.owner\) \{ _ in/)
})
