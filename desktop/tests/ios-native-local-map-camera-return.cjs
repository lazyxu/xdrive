'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dash = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')

test('local MapKit retains only a transient WGS84 camera across local/cloud source switches', () => {
  assert.match(dash, /@State private var localMapCamera: MKCoordinateRegion\?/)
  assert.match(dash, /cloudMapCamera: \$cloudMapCamera,\s*localMapCamera: \$localMapCamera,\s*onFocusChange:/)
  assert.match(owner, /@Binding var localMapCamera: MKCoordinateRegion\?/)
  assert.match(owner, /case \.local:\s*XDriveIOSNativeLocalPhotoMapScreen\([\s\S]*?cameraOnEntry: localMapCamera,[\s\S]*?onLibraryCameraChange: \{ next in/)
  const localCallback = owner.split('onLibraryCameraChange: { next in')[1]?.split('localMapCamera = next')[0]
  assert.ok(localCallback, 'local camera callback must exist')
  assert.match(localCallback, /guard source == \\.local else \\{ return \\}/)
  // A signed-in map validates the original Owner; a guest local PhotoKit map
  // admits only a STILL signed-out session, never a late callback after login.
  assert.match(localCallback, /if let expectedOwner \\{[\\s\\S]*?XDriveIOSNativePhotoOwnerScope\\.matches\\(\\s*login\\.owner, expectedOwner\\s*\\) else \\{ return \\}[\\s\\S]*?\\} else \\{\\s*guard login\\.owner == nil else \\{ return \\}\\s*\\}/)
  assert.match(owner, /localMapCamera = next\\s*\\},\\s*onFocusChange: onFocusChange/)
  assert.match(local, /var cameraOnEntry: MKCoordinateRegion\? = nil/)
  assert.match(local, /var onLibraryCameraChange: \(\(MKCoordinateRegion\?\) -> Void\)\? = nil/)
  assert.match(local, /onCamera: \{ current in[\s\S]*?globalCamera = current\s*onLibraryCameraChange\?\(current\)/)
  assert.match(local, /if let cameraOnEntry \{\s*scanFullLibrary\(returningCamera: cameraOnEntry\)\s*\} else \{\s*scanFullLibrary\(\)/)
  assert.match(local, /let restoreCamera = viewport == nil \? nil : globalCamera[\s\S]*?invalidate\(\)[\s\S]*?globalCamera = restoreCamera\s*if viewport == nil, let returningCamera \{\s*globalCamera = returningCamera/)
})

test('manual overview, PhotoKit lease changes, scene background and Owner changes revoke camera', () => {
  assert.match(local, /if viewport == nil && returningCamera == nil \{\s*onLibraryCameraChange\?\(nil\)/)
  assert.match(local, /onChange\(of: mapScope\) \{ next in\s*if next == \.page \{ onLibraryCameraChange\?\(nil\) \}/)
  assert.match(local, /onChange\(of: changes\.revision\) \{ _ in[\s\S]*?let returningCamera = globalCamera[\s\S]*?onLibraryCameraChange\?\(nil\)\s*clearReturnCamera\(\)\s*invalidate\(\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(local, /guard phase == \.active, authorization == \.authorized else \{ return \}/)
  assert.match(local, /onChange\(of: phase\) \{ state in[\s\S]*?changes\.stop\(\)\s*onLibraryCameraChange\?\(nil\)/)
  assert.match(dash, /localMapJump = nil\s*localMapCamera = nil\s*return/)
  assert.match(dash, /localMapJump = nil\s*galleryMapCaptureRange = nil\s*mapSource = \.local\s*cloudMapCamera = nil\s*localMapCamera = nil/)
  assert.match(dash, /localMapJump = jump\s*localMapCamera = jump\.camera\s*localMapScope = \.library/)
  assert.doesNotMatch(dash, /UserDefaults\.set\(localMapCamera|navigationRouteStore\.save\([^)]*localMapCamera/)
  assert.doesNotMatch(owner, /@State private var localMapCamera/)
  assert.doesNotMatch(local, /localMapCamera = try await|URLSession\(|UploadSession/)
})
