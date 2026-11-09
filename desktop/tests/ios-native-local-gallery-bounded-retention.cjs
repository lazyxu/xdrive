'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(
  path.join(root, 'ios/XDriveIOS/NativeLocalContinuousGallery.swift'), 'utf8'
)
const child = source.slice(
  source.indexOf('private struct XDriveIOSNativeVirtualPhotoPage: View'),
  source.indexOf('private final class XDriveIOSNativeVirtualWallChangeMonitor')
)
const parent = source.slice(
  source.indexOf('struct XDriveIOSNativeLocalContinuousGalleryScreen: View')
)
const section = (text, start, end) => {
  const a = text.indexOf(start)
  const b = text.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'expected a complete live Swift scope: ' + start)
  return text.slice(a, b)
}

test('foreground tab can preserve its exact last visible PhotoKit page in parent state', () => {
  assert.match(parent, /@State private var navigationReturnPage: XDrivePhotoKitScanPage\?/)
  assert.match(parent, /@State private var navigationReturnGeneration: UUID\?/)
  const hidden = section(parent, 'onPageHidden: { hiddenOffset, pageEpoch, verifiedPage in', 'onFailure: {')
  assert.match(hidden, /pageEpoch == generation/)
  assert.match(hidden, /hiddenOffset == savedOffset/)
  assert.match(hidden, /phase == \.active && authorized/)
  assert.match(hidden, /verifiedPage\.totalAccessibleAssets == total/)
  assert.match(hidden, /navigationReturnPage = verifiedPage/)
  assert.match(hidden, /navigationReturnGeneration = generation/)
})

test('only one bounded page is retained: scrolling never accumulates old PhotoKit pages', () => {
  const declaration = section(parent, 'struct XDriveIOSNativeLocalContinuousGalleryScreen: View', 'var body: some View')
  assert.doesNotMatch(declaration, /@State private var navigationReturnPages: \[/)
  assert.doesNotMatch(declaration, /@State private var navigationReturnIDs: \[/)
  assert.match(parent, /navigationReturnPage: XDrivePhotoKitScanPage\?/)
  assert.match(parent, /hiddenOffset == savedOffset/)
  // Do not blindly set all lazy pages to retain on foreground tab navigation.
  assert.match(parent, /retainWhileCovered: selected != nil \|\| showingMap,/)
})

test('PhotoKit page is reusable only if its generation, offset, total and grant still agree', () => {
  assert.match(child, /let navigationRetainedPage: XDrivePhotoKitScanPage\?/)
  const task = section(child, '.task(id:', '.onChange(of: backupBadgeOwner)')
  assert.match(task, /if let navigationRetainedPage/)
  assert.match(task, /navigationRetainedPage\.startOffset == offset/)
  assert.match(task, /navigationRetainedPage\.totalAccessibleAssets == expectedTotal/)
  assert.match(task, /\[\.authorized, \.limited\]\.contains\(/)
  assert.match(task, /page = navigationRetainedPage/)
  assert.match(task, /retainedGeneration = generation/)
  assert.match(task, /onRead\(navigationRetainedPage\)/)
})

test('child onDisappear submits only verified page evidence to a bounded parent cache', () => {
  assert.match(child, /let onPageHidden: \(Int, UUID\?, XDrivePhotoKitScanPage\?\) -> Void/)
  const disappear = section(child, '.onDisappear {', '\n    }\n}')
  assert.match(disappear, /let verifiedEpoch = retainedGeneration[\s\S]*verifiedEpoch == generation/)
  assert.match(disappear, /page\?\.startOffset == offset/)
  assert.match(disappear, /page\?\.totalAccessibleAssets == expectedTotal/)
  assert.match(disappear, /onPageHidden\(offset, verifiedEpoch, verifiedPage\)/)
})

test('background, scene suspension and permission changes revoke any navigation cache', () => {
  const invalidate = section(parent, '    private func invalidate(with message: String?) {', '\n    }\n}')
  assert.match(invalidate, /navigationReturnPage = nil/)
  assert.match(invalidate, /navigationReturnGeneration = nil/)
  const scene = section(parent, '.onChange(of: phase) { value in', '.onDisappear {')
  assert.match(scene, /if value != \.active/)
  assert.match(scene, /invalidate\(with: nil\)/)
  const appear = section(parent, '.onAppear {\n            isVisible = true', '.onChange(of: exactDateTarget)')
  assert.match(appear, /freshGrant != permission \{ invalidate\(with: nil\) \}/)
})

test('PhotoKit monitor change invalidates retained IDs before authorized rescan', () => {
  const appear = section(parent, '.onAppear {\n            isVisible = true', '.onChange(of: exactDateTarget)')
  assert.match(appear, /XDriveIOSNativeVirtualWallChangeMonitor/)
  assert.match(appear, /else \{ invalidate\(with: nil\) \}/)
  assert.match(appear, /if selected == nil && authorized && phase == \.active/)
})

test('Viewer return preserves the selected exact-page anchor but still revalidates media', () => {
  const viewer = section(parent, '    private func openViewer(', '    private func restoreAfterViewer()')
  assert.match(viewer, /PHAsset\.fetchAssets/)
  assert.match(viewer, /returnPageOffset = page\.startOffset/)
  assert.match(viewer, /returnDate = candidate\.capturedAt/)
  assert.match(viewer, /returnModified = candidate\.modifiedAt/)
  const restored = section(parent, '    private func restoreAfterViewer()', '    private func clearReturn()')
  assert.match(restored, /guard phase == \.active && authorized else/)
  assert.match(restored, /reload\(\)/)
})

test('the page cache is transient, not UserDefaults or a global 100k-photo index', () => {
  const parentDeclaration = section(parent,
    'struct XDriveIOSNativeLocalContinuousGalleryScreen: View',
    '    var body: some View')
  assert.doesNotMatch(parentDeclaration, /@AppStorage\("xdrive\.ios\.local\.page/)
  assert.doesNotMatch(parentDeclaration, /navigationReturnPage.*UserDefaults/)
  assert.doesNotMatch(parentDeclaration, /\[String: PHAsset\]/)
})
