'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const map = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativeLocalPhotoMap.swift'), 'utf8')
const screen = map.slice(map.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
const reader = screen.slice(screen.indexOf('private func scanFullLibrary('),
  screen.indexOf('private func refresh(', screen.indexOf('private func scanFullLibrary(')))
const surface = map.slice(map.indexOf('private struct XDriveIOSMapKitPhotoPage:'),
  map.indexOf('private final class XDriveIOSMapPhotoChanges:'))
const cover = map.slice(map.indexOf('private final class XDriveIOSMapPhotoCover:'),
  map.indexOf('private struct XDriveIOSMapKitPhotoPage:'))

test('first GPS page shows bounded preview markers before the full scan finishes', () => {
  assert.match(reader, /let next = try await worker\.nextLocatedPage\(\)/)
  assert.match(reader, /if !keepOldMap && provisionalCells\.isEmpty && !index\.cells\.isEmpty \{/)
  assert.match(reader, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized[\s\S]*?provisionalCells = index\.cells[\s\S]*?mapRevision = UUID\(\)/)
  assert.ok(reader.indexOf('provisionalCells = index.cells') < reader.indexOf('if next.page.finished { break }'))
  assert.match(reader, /scanned == total[\s\S]*?globalCells = index\.cells[\s\S]*?provisionalCells = \[\][\s\S]*?globalComplete = true/)
  assert.match(map, /index\.add\(latitude: located\.latitude,[\s\S]*?longitude: located\.longitude/)
})

test('preview markers are read-only; badge and completeness are never fabricated', () => {
  assert.match(screen, /globalCells: globalComplete \? globalCells : provisionalCells/)
  assert.match(screen, /provisional: !globalComplete && !provisionalCells\.isEmpty/)
  assert.match(screen, /private var refinedViewportIsCurrent: Bool \{[\s\S]*?guard globalComplete, !busy else \{ return false \}/)
  assert.match(surface, /view\?\.configure\([\s\S]*?provisional: showingProvisional/)
  assert.match(cover, /badge\.isHidden = provisional \|\| count <= 1/)
  assert.match(cover, /badge\.text = provisional \? nil/)
  assert.match(surface, /guard canSelectCells else \{ return \}/)
  assert.match(screen, /位置封面正在核对，完整数量确认前暂不可打开。/)
})

test('early auto-fit does not masquerade as user pan or steal the final camera', () => {
  assert.match(surface, /if provisional \{[\s\S]*?map\.delegate = nil[\s\S]*?map\.showAnnotations\(pins, animated: false\)[\s\S]*?map\.delegate = context\.coordinator/)
  assert.match(surface, /provisionalCameraMoved = true/)
  assert.match(surface, /else if !context\.coordinator\.provisionalCameraMoved/)
  assert.match(screen, /if !globalComplete \{[\s\S]*?globalCamera = current[\s\S]*?onLibraryCameraChange\?\(current\)/)
})

test('cancellation, authorization and scanner errors clear partial GPS covers', () => {
  assert.match(screen, /private func invalidate\(\) \{[\s\S]*?provisionalCells = \[\]/)
  assert.match(reader, /\} catch \{[\s\S]*?provisionalCells = \[\][\s\S]*?mapRevision = UUID\(\)/)
  assert.match(screen, /if authorization == \.limited/)
  assert.doesNotMatch(map, /UserDefaults|localStorage|UploadSession|requestWhenInUseAuthorization\(/)
})
