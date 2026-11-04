'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const view = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeZoomablePhotoView.swift'), 'utf8')

test('iOS local, cloud and map-photo still viewers drag decoded images before page release', () => {
  assert.match(view, /UIViewRepresentable/)
  assert.match(view, /UIGestureRecognizerDelegate/)
  assert.match(view, /func gestureRecognizerShouldBegin/)
  assert.match(view, /scroll\.zoomScale <= scroll\.minimumZoomScale \+ 0\.01/)
  assert.match(view, /pan\.numberOfTouches == 1/)
  assert.match(view, /case \.changed:[\s\S]*photo\.transform = CGAffineTransform\(/)
  assert.match(view, /case \.ended:[\s\S]*XDriveIOSNativeViewerSwipePolicy\.direction/)
  assert.match(view, /snap\(photo, to: direction > 0 \? -width : width, turn: direction\)/)
  assert.match(view, /case \.cancelled, \.failed:[\s\S]*snap\(photo, to: 0\)/)
  assert.match(view, /scroll\.panGestureRecognizer\.require\(toFail: pagingPan\)/)
  // Enhanced same-source pixels now compute the image identity/zoom policy
  // before retiring the pager animation. All image changes still retire it.
  assert.match(view, /if photo\.image !== image \{[\s\S]*?context\.coordinator\.retirePageAnimation\(\)/)
  assert.match(view, /let isSameImageUpgrade = sameSource &&[\s\S]*?updatedPixels > previousPixels/)
  assert.match(view, /if !isSameImageUpgrade \{\s*scroll\.setZoomScale\(scroll\.minimumZoomScale, animated: false\)/)
  assert.match(view, /UIAccessibility\.isReduceMotionEnabled/)
  assert.doesNotMatch(view, /onSwipe\?\(direction\)\s*\n\s*}/,
    'switch only after the visual page transition, not immediately on finger-up')
})

test('slow deliberate horizontal still drags begin native paging without stealing zoom or vertical scroll', () => {
  const policy = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativePhotoViewerReturnAnchorPolicy.swift'), 'utf8')
  const checks = fs.readFileSync(path.resolve(__dirname,
    '../../ios/tests/NativePhotoViewerReturnAnchorPolicyChecks.swift'), 'utf8')
  const start = view.indexOf('func gestureRecognizerShouldBegin(')
  const end = view.indexOf('private func snap(', start)
  const admission = view.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(admission, /onSwipe != nil/)
  assert.match(admission, /scroll\.zoomScale <= scroll\.minimumZoomScale \+ 0\.01/)
  assert.match(admission, /pan\.numberOfTouches == 1/)
  assert.match(admission, /let movement = pan\.translation\(in: scroll\)/)
  assert.match(admission, /XDriveIOSNativeViewerSwipePolicy\.shouldBeginPaging\(/)
  assert.match(admission, /translationX: movement\.x, translationY: movement\.y/)
  assert.match(admission, /velocityX: velocity\.x, velocityY: velocity\.y/)
  assert.match(policy, /static func shouldBeginPaging\(/)
  assert.match(policy, /dx\.isFinite, dy\.isFinite, vx\.isFinite, vy\.isFinite/)
  assert.match(policy, /zoom >= minimum - 0\.01, zoom <= minimum \+ 0\.01/)
  assert.match(policy, /abs\(dx\) >= 8[\s\S]*?abs\(dx\) > abs\(dy\) \* 1\.5/)
  assert.match(policy, /abs\(vx\) >= 120[\s\S]*?abs\(vx\) > abs\(vy\) \* 1\.5/)
  assert.match(policy, /return draggedHorizontally \|\| flickedHorizontally/)
  for (const reason of [
    'slow horizontal drag begins', 'slow reverse drag begins',
    'fast horizontal flick begins', 'tiny movement does not begin',
    'stationary touch does not begin', 'vertical drag preserves scrolling',
    'diagonal drag does not steal scroll', 'diagonal flick does not begin',
    'zoomed image keeps pan', 'base zoom tolerance admits slow drag',
    'invalid zoom never pages', 'invalid minimum never pages',
    'NaN translation never pages', 'infinite velocity never pages'
  ]) assert.ok(checks.includes(reason), 'missing native executable case: ' + reason)
  assert.match(view, /scroll\.panGestureRecognizer\.require\(toFail: pagingPan\)/)
  assert.match(view, /case \.ended:[\s\S]*?XDriveIOSNativeViewerSwipePolicy\.direction\(/)
  assert.doesNotMatch(policy + admission, /URLSession|UploadSession|Bearer|PHAssetCreationRequest|UserDefaults/)
})


test('existing iOS gesture and data-scope contracts are preserved', () => {
  const local = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeLocalPhotoGallery.swift'), 'utf8')
  const cloud = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeServerMediaGallery.swift'), 'utf8')
  assert.match(local, /\.onNavigateSwipe \{ showNeighbor\(\$0\) \}/)
  assert.match(cloud, /\.onNavigateSwipe \{ navigateLoaded\(\$0\) \}/)
  assert.match(view, /onSwipe != nil/, 'unrelated Files previews must not acquire paging gestures')
  assert.match(view, /func viewForZooming\(in scrollView: UIScrollView\)/)
  assert.match(view, /scroll\.maximumZoomScale = 5/)
})
