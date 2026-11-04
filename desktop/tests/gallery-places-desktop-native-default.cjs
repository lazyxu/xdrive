'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Desktop Places opens the Agent-authenticated Owner GPS map instead of an unauthenticated Web login guest', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const gallery = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const adapter = read('desktop/src/renderer/mediaGalleryAdapter.ts')

  assert.match(desktop, /galleryPage:\s*\{\s*source:\s*mediaGallerySource,/)
  // The embedded Electron Web session is deliberately separate from Agent
  // credentials. Supplying its URL here would display a second login panel
  // inside the map until the user separately authenticates to that session.
  assert.doesNotMatch(desktop, /desktopEmbeddedPlacesURL:|onPrepareDesktopPlaces:/)
  assert.doesNotMatch(desktop, /xDriveDesktopEmbeddedPlacesURL|preparePlacesEmbed\(/)

  assert.match(adapter, /listPlacesMapOverview:\s*\(bounds,\s*detail\s*=\s*false,\s*signal\)/)
  assert.match(gallery, /const desktopOnly = Boolean\(onOpenSecureDesktopMap\)/)
  assert.match(gallery, /desktopOnly\s*\?\s*\([\s\S]*?<XDriveMediaGalleryOwnerGPSOverview/)
  assert.match(gallery, /scope=\{diagnosticScope \?\? ''\} listPage=\{listPlacesMapOverview\}/)
  assert.match(gallery, /onOpenPlace=\{onOpenPlace\} compact=\{compact\}/)
})

test('Baidu dynamic map remains an explicit separate HTTPS window, never an implicit Desktop webview', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const gallery = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(desktop, /onOpenSecureDesktopMap:\s*\(scope\)\s*=>\s*\{/)
  assert.match(desktop, /window\.xdriveDesktop\.openBaiduMapSecure\(scope\)/)
  assert.match(gallery, /onClick=\{\(\) => onOpenSecureDesktopMap\?\.\(mapPhotoScope\)\}/)
  assert.match(gallery, /在独立 HTTPS 安全窗口打开百度动态地图/)
  assert.doesNotMatch(desktop, /\.accessToken|\.refreshToken|\.password\s*\)/)
})
