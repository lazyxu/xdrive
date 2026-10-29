'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const app = read('web/src/App.tsx')
const viewer = read('web/src/WebFileViewerApps.tsx')
const scheduler = read('web/src/iosForegroundAutoScheduler.ts')
const owner = app.indexOf('<WebFileViewerApps')
assert.ok(owner > 0, 'real routed Viewer slot must remain mounted')
const end = app.indexOf('/>', owner)
assert.ok(end > owner)
const element = app.slice(owner, end)

test('routed Viewer receives exact current Web Server Owner scope, never an unscoped map link', () => {
  assert.match(element, /ownerScope=\{profile\?\.id \? `web:\$\{profile\.id\}` : undefined\}/)
  assert.match(element, /api=\{api\}/)
  assert.match(element, /gallerySource=\{gallerySource\}/)
  assert.doesNotMatch(element, /ownerScope=\{'?web'?\}|ownerScope=\{username\}/)
})

test('selected Photo Info → Map still verifies Owner and original Gallery scope', () => {
  assert.match(viewer, /const mapEntryScope = route\.params\.context && ownerScope/)
  assert.match(viewer, /if \(!mapEntryScope \|\| !ownerScope \|\| !route\.params\.context/)
  assert.match(viewer, /xDriveRoutedViewerMapEntry\(/)
  assert.match(viewer, /api\.mediaBaiduNativePhotoFocus\(/)
  assert.match(viewer, /xDriveBaiduMapPhotoScopeKey\(current\) === originalKey/)
  assert.match(viewer, /\{ ownerScope, photoScope: current, focusIntent: selected \}/)
})

test('foreground iOS PhotoKit polling retains separate current Owner verification', () => {
  assert.match(app, /xDriveStartIOSForegroundAutoScheduler\(iosPhotoHost/)
  assert.match(app, /const current = await captured\.api\.me\(\)/)
  assert.match(app, /current\.id !== profile\.id/)
  assert.match(scheduler, /document\.visibilityState !== 'visible'/)
  assert.doesNotMatch(element, /accessToken|refreshToken|Cookie|localRoot|albumSearchToken/)
})
