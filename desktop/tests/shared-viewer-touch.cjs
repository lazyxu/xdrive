const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const preview = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const openPreview = read('ui', 'shared', 'src', 'mui', 'FileOpenPreviewDialog.tsx')
const galleryViewer = read('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
const mediaViewerContent = read('ui', 'shared', 'src', 'mui', 'MediaViewerContent.tsx')
const quickLook = read('ui', 'shared', 'src', 'mui', 'FileQuickLookDialog.tsx')
const webViewers = read('web', 'src', 'WebFileViewerApps.tsx')
const runtimeDocs = read('docs', 'web-app-runtime.md')
const previewDocs = read('docs', 'preview-engine.md')

test('shared image preview supports pinch, double-tap and scale-aware swipe navigation', () => {
  for (const token of [
    'onSwipePrevious?: () => void',
    'onSwipeNext?: () => void',
    'imagePointersRef',
    'imagePinchRef',
    'imageSwipeRef',
    'lastTouchTapRef',
    'touchDoubleTapAtRef',
    'data-xdrive-preview-pinch',
    'data-xdrive-preview-swipe',
    'Math.hypot(second.x - first.x, second.y - first.y)',
    'pinch.scale * distance / pinch.distance',
    'absX >= 56 && absX > absY * 1.25',
    'onSwipeNext?.()',
    'onSwipePrevious?.()',
    'handleImagePointerCancel',
    'handleImagePointerLostCapture',
    'onPointerCancel={handleImagePointerCancel}',
    'now - previous.at <= 320',
    'setImageZoom(imageScale > 1 ? 1 : 2, imageAnchor(event.currentTarget, event.clientX, event.clientY))',
  ]) {
    assert.ok(preview.includes(token), 'touch image gesture contract missing: ' + token)
  }
  assert.ok(
    preview.includes("interactiveImage && !coarsePointer ? ("),
    'coarse touch preview should use gestures instead of desktop-sized zoom buttons',
  )
})

test('shared immersive preview becomes mobile full-screen with tap chrome and safe-area actions', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'const effectiveFullScreen = fullScreen || compactTouch',
    'touchTapTimerRef',
    'touchPointersRef',
    'onPointerDownCapture={handleTouchPointerDown}',
    'onPointerMoveCapture={handleTouchPointerMove}',
    'onPointerUpCapture={handleTouchPointerRelease}',
    'onPointerCancelCapture={handleTouchPointerCancel}',
    "height: effectiveFullScreen ? '100dvh'",
    "pt: compactTouch ? 'env(safe-area-inset-top)' : 0",
    'data-xdrive-preview-mobile-actions',
    "pb: 'env(safe-area-inset-bottom)'",
  ]) {
    assert.ok(openPreview.includes(token), 'shared mobile preview chrome missing: ' + token)
  }
  // The minimum touch target remains 44px; overlay-specific color and
  // contrast additions must not invalidate the existing hit-area contract.
  assert.match(
    openPreview,
    /'& \.MuiIconButton-root': \{\s*width: 44,\s*height: 44,\s*flexShrink: 0,/,
    'shared mobile preview controls must preserve 44px hit areas',
  )
  assert.ok(openPreview.includes('!compactTouch ? actions : null'), 'mobile preview actions must leave the narrow header')
  assert.ok(openPreview.includes('{compactTouch ? ('), 'all compact-touch previews must use the mobile bottom action rail')
})

test('Web immersive viewer uses tap chrome, safe areas and a mobile action rail', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'const compactImmersive = compactTouch && immersive',
    'touchTapTimerRef',
    'onPointerDownCapture={handleTouchPointerDown}',
    'onPointerMoveCapture={handleTouchPointerMove}',
    'onPointerUpCapture={handleTouchPointerRelease}',
    'onPointerCancelCapture={handleTouchPointerCancel}',
    "height: compactTouch ? '100dvh' : undefined",
    "pt: compactTouch ? 'env(safe-area-inset-top)' : 0",
    'data-xdrive-web-viewer-mobile-actions',
    "pb: 'env(safe-area-inset-bottom)'",
    "'& .MuiIconButton-root': { width: 44, height: 44, flexShrink: 0, color: 'inherit' }",
    'quickLook && !compactImmersive',
  ]) {
    assert.ok(webViewers.includes(token), 'Web mobile Viewer chrome missing: ' + token)
  }
})

test('Web and shared Gallery viewers wire range navigation into image swipes', () => {
  for (const token of [
    'onSwipePrevious={viewer.previous ? viewer.goPrevious : undefined}',
    'onSwipeNext={viewer.next ? viewer.goNext : undefined}',
  ]) {
    assert.ok(webViewers.includes(token), 'Web Viewer swipe navigation missing: ' + token)
  }
  assert.ok(
    galleryViewer.includes('onSwipePrevious={canPrevious ? previousIfCurrent : undefined}') &&
      galleryViewer.includes('onSwipeNext={canNext ? nextIfCurrent : undefined}'),
    'shared Gallery Viewer swipe navigation is missing',
  )
  assert.ok(
    quickLook.includes('onSwipePrevious={canPrevious ? previousIfCurrent : undefined}') &&
      quickLook.includes('onSwipeNext={canNext ? nextIfCurrent : undefined}'),
    'shared Quick Look swipe navigation is missing',
  )
})

test('Viewer mobile design keeps touch gestures separate from video and Live Photo controls', () => {
  assert.ok(
    preview.includes("if (previewKind === 'video')"),
    'video must keep its native controls outside image gesture handling',
  )
  const semanticLiveStart = mediaViewerContent.indexOf('if (livePhoto && loadLivePhotoMotion)')
  const ordinaryMediaStart = mediaViewerContent.indexOf('\n  return (', semanticLiveStart)
  assert.ok(semanticLiveStart >= 0 && ordinaryMediaStart > semanticLiveStart)
  assert.ok(
    mediaViewerContent.slice(semanticLiveStart, ordinaryMediaStart).includes('onSwipePrevious={interactiveImage ? onSwipePrevious : undefined}'),
    'Paired Live Photo must use the authorized Viewer range without eager motion',
  )
  assert.ok(
    preview.includes('onSwipePrevious={interactiveImage ? onSwipePrevious : undefined}') &&
    preview.includes('onSwipeNext={interactiveImage ? onSwipeNext : undefined}'),
    'LIVP container must use the same shared gesture discriminator',
  )
  assert.ok(runtimeDocs.includes('移动 Viewer'), 'Web App Runtime must document mobile Viewer behavior')
  assert.ok(previewDocs.includes('pinch'), 'Preview Engine must document touch image gestures')
})

test('Live Photo still pinch/pan uses the same two callers and does not create a second media renderer', () => {
  const liveSurface = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
  assert.ok(preview.includes('deferTouchHold={interactiveImage}') &&
    preview.includes('interactiveImage={interactiveImage}'),
    'single-file LIVP must opt into the same authorized still-only gesture surface')
  assert.ok(mediaViewerContent.includes('deferTouchHold={interactiveImage}') &&
    mediaViewerContent.includes('interactiveImage={interactiveImage}'),
    'paired Live Photo must share the gesture surface')
  for (const feature of ['data-xdrive-live-zoom', 'zoomPointersRef',
    'pinchRef', 'panRef', 'xDriveClampPreviewViewport', 'xDriveAnchorPreviewZoom']) {
    assert.ok(liveSurface.includes(feature), 'shared Live zoom is missing ' + feature)
  }
  assert.ok(liveSurface.includes("touchAction: interactiveImage ? 'none' : 'pan-y pinch-zoom'"))
  assert.ok(liveSurface.includes('viewportRef.current.scale > 1.01'),
    'zoomed still must not start motion and must not navigate during pan')
  assert.equal(liveSurface.includes("fetch("), false, 'zoom may never acquire media bytes')
})

test('shared Live still viewport guards slow swipe, decoded pan, mouse double-click and Owner changes', () => {
  const live = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
  for (const token of [
    'useLayoutEffect(() => {',
    'measureViewport(viewportElementRef.current)',
    'lastTouchZoomAtRef',
    'onDoubleClick={handleDoubleClick}',
    'Date.now() - gesture.startedAt > 700',
    'viewportRef.current.scale > 1.01',
    'xDriveAnchorPreviewZoom(',
    'xDriveClampPreviewViewport(',
    'gestureSessionRef.current !== gestureSession',
    'cancelPendingMotion()',
  ]) assert.ok(live.includes(token), 'Live still zoom/pan parity missing ' + token)
  assert.ok(!live.includes('fetch('), 'zoom must never have a second media transport')
})

test('P1 reduced motion and 320px modes are shared by routed and inline Viewer shells', () => {
  for (const source of [openPreview, webViewers]) {
    assert.ok(source.includes("useMediaQuery('(max-width:367.95px)')"),
      'both media Viewer shells must select the same ultra-narrow breakpoint')
    assert.ok(source.includes("'@media (prefers-reduced-motion: reduce)': { transition: 'none' }"),
      'all immersive chrome opacity transitions must respect OS Reduced Motion')
  }
  assert.ok(openPreview.includes("overflowX: mobileOverlay ? 'hidden' : 'auto'"))
  assert.ok(webViewers.includes("overflowX: photosViewer ? 'hidden' : 'auto'"))
})
