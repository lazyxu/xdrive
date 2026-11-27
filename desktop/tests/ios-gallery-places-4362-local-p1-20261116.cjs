'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const swift = n => fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS', n + '.swift'), 'utf8')
test('4362 P1 legacy local 64-item page reuses shared SectionList with current PhotoKit page', () => {
  const s = swift('NativeLocalPhotoGallery')
  assert.match(s, /XDriveIOSNativePhotoWallSectionList\(/)
  assert.match(s, /page\.items\.filter\s*\{\s*\$0\.kind != "unsupported"/)
  assert.match(s, /XDriveIOSNativeSquarePhotoTile\(candidate: candidate, framing: framing\)/)
  assert.doesNotMatch(s, /LazyVGrid\(columns: \[GridItem\(\.adaptive\(minimum: 95/)
  assert.match(s, /page\.startOffset - 64/)
})
test('4362 P1 all native local photo walls share appearance preference and feedback', () => {
  for (const n of ['NativeLocalPhotoGallery', 'NativeLocalContinuousGallery']) {
    const s = swift(n)
    assert.match(s, /@AppStorage\("xdrive\.ios\.gallery\.photo-wall-density\.v1"\)/)
    assert.match(s, /@AppStorage\("xdrive\.ios\.gallery\.photo-wall-framing\.v1"\)/)
    assert.match(s, /XDriveIOSNativePhotoWallFeedback\(/)
  }
  assert.match(swift('NativeLocalPhotoGallery'), /PHPhotoLibrary\.authorizationStatus/)
  assert.match(swift('NativeLocalContinuousGallery'), /XDriveIOSNativeVirtualPhotoPage\(/)
})
