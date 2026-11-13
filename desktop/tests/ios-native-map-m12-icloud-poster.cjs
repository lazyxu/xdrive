'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const src=fs.readFileSync(path.resolve(__dirname,'../../ios/XDriveIOS/NativeLocalPhotoMap.swift'),'utf8')
const part=src.slice(src.indexOf('private final class XDriveIOSMapPhotoCover'),
                     src.indexOf('private struct XDriveIOSMapKitPhotoPage'))

test('M12 PhotoKit MapKit HEIC Live and video poster handles degraded, terminal and cloud-only requests',()=>{
  assert.match(part,/PHImageRequestOptions\(\)/)
  assert.match(part,/isNetworkAccessAllowed = true/)
  assert.match(part,/deliveryMode = \.opportunistic/)
  assert.match(part,/PHImageResultIsDegradedKey/)
  assert.match(part,/PHImageCancelledKey/)
  assert.match(part,/PHImageErrorKey/)
  assert.match(part,/PHImageResultIsInCloudKey/)
  assert.match(part,/if !degraded \|\| failed/)
  assert.match(part,/if self\.photo\.image == nil/)
  assert.match(part,/systemName: inCloud \|\| failed \? "icloud\.slash" : "photo"/)
})

test('M12 reusing or leaving map cancels PhotoKit and rejects late image with strict Full access',()=>{
  assert.match(part,/epoch = UUID\(\)/)
  assert.match(part,/self\.epoch == snapshot/)
  assert.match(part,/PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(part,/PHImageManager\.default\(\)\.cancelImageRequest\(request\)/)
  assert.match(part,/override func prepareForReuse\(\)/)
  assert.match(part,/if superview == nil \{ cancel\(\) \}/)
  assert.match(src,/重新加载位置封面/)
  assert.doesNotMatch(part,/requestAVAsset|requestImageDataAndOrientation|exportSession|PHAssetResourceManager/)
})
