'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const web = read('web/src/mediaGalleryAdapter.ts')
const photo = read('ui/shared/src/media-gallery-baidu-photo-focus-camera.ts')

test('the only Gallery Web Host port uses the existing signed Owner photo API',()=>{
  assert.match(web,/getBaiduNativePhotoFocus:\s*\(nodeID, revision, signal\)/)
  assert.match(web,/api\.mediaBaiduNativePhotoFocus\(nodeID, revision, signal\)/)
  assert.doesNotMatch(web,/getBaiduNativePhotoFocus:[^\n]*fetch\(/)
  assert.match(gallery,/getBaiduNativePhotoFocus\?:/)
})

test('Gallery Photo Info checks accepted Owner membership before requesting BD09',()=>{
  const start=gallery.indexOf('  const showPhotoMapFromCurrentGallery = async')
  const end=gallery.indexOf('  const appliedScopeLabel',start)
  assert.ok(start>0 && end>start)
  const body=gallery.slice(start,end)
  assert.match(body,/if \(loading \|\| collectionError \|\| !accepted \|\|/)
  assert.match(body,/accepted\.kind !== 'album' \|\| accepted\.id !== currentAlbum\.id/)
  assert.match(body,/accepted\.kind !== 'all'/)
  assert.match(body,/xDriveGalleryMapEntryScope\(/)
  assert.match(body,/xDriveResolveBaiduOwnerPhotoFocusCamera\(/)
  assert.match(body,/const focus = await/)
  assert.match(body,/if \(!live\(\)\) return false/)
  assert.match(body,/if \(!showMapFromCurrentGallery\(\)\) return false/)
  assert.match(body,/rememberBaiduNativeCamera\(focus\.camera\)/)
  assert.ok(body.indexOf('if (!showMapFromCurrentGallery())') <
    body.indexOf('rememberBaiduNativeCamera(focus.camera)'))
  for (const term of ['collectionTargetRef.current !== captured.target',
    'now.owner !== captured.owner','now.dataSource !== captured.dataSource',
    'now.querySignature !== captured.querySignature',
    'now.albumID !== captured.albumID','!currentSelection()']) {
    assert.ok(body.includes(term), 'missing current Owner/Viewer fence: '+term)
  }
  assert.doesNotMatch(body,/localStorage|sessionStorage|window\.location|new BMap|xDriveEmptyBaiduMapPhotoScope/)
})

test('the original no-photo Show Map entry and signed Cell return remain intact',()=>{
  assert.match(gallery,/  const showMapFromCurrentGallery = \(\) => \{/)
  assert.match(gallery,/if \(!onOpenSecureDesktopMap &&\s*\(accepted\?\.kind === 'baidu-cell'/)
  assert.match(gallery,/if \(!onShowMap\(\)\) return/)
  assert.match(gallery,/onShowMap=\{showMapFromCurrentGallery\}/)
  assert.match(gallery,/onShowPhotoMap=\{source\.getBaiduNativePhotoFocus/)
  assert.match(gallery,/onShowPhotoMap && showGalleryMapEntry/)
  assert.match(gallery,/const stillSelected = \(\) => \{/)
  assert.match(gallery,/now\.nodeID === selection\.nodeID/)
  assert.match(gallery,/now\.revision === selection\.revision/)
  assert.match(gallery,/galleryPhotoFocusAbort\.current\?\.abort\(\)/)
})

test('focus resolver yields only four-field BD09 hint, never extra media access',()=>{
  assert.match(photo,/xDriveValidBaiduOwnerPhotoFocus\(/)
  assert.match(photo,/xDriveValidBaiduNativeCameraSnapshot\(camera\)/)
  assert.match(photo,/samePhotoIdentity\(active\.focusIntent, captured\.focusIntent\)/)
  assert.doesNotMatch(photo,/window\.location|sessionStorage|localStorage/)
})
