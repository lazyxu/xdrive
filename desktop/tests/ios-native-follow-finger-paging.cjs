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
  assert.match(view, /if photo\.image !== image \{\s*context\.coordinator\.retirePageAnimation\(\)/)
  assert.match(view, /UIAccessibility\.isReduceMotionEnabled/)
  assert.doesNotMatch(view, /onSwipe\?\(direction\)\s*\n\s*}/,
    'switch only after the visual page transition, not immediately on finger-up')
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
