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
    'setImageZoom(imageScale > 1 ? 1 : 2)',
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
    "'& .MuiIconButton-root': { width: 44, height: 44 }",
  ]) {
    assert.ok(openPreview.includes(token), 'shared mobile preview chrome missing: ' + token)
  }
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
    "height: compactImmersive ? '100dvh' : undefined",
    "pt: compactImmersive ? 'env(safe-area-inset-top)' : 0",
    'data-xdrive-web-viewer-mobile-actions',
    "pb: 'env(safe-area-inset-bottom)'",
    "'& .MuiIconButton-root': { width: 44, height: 44, color: 'inherit' }",
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
    galleryViewer.includes('onSwipePrevious={canPrevious ? onPrevious : undefined}') &&
      galleryViewer.includes('onSwipeNext={canNext ? onNext : undefined}'),
    'shared Gallery Viewer swipe navigation is missing',
  )
  assert.ok(
    quickLook.includes('onSwipePrevious={canPrevious ? onPrevious : undefined}') &&
      quickLook.includes('onSwipeNext={canNext ? onNext : undefined}'),
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
  assert.equal(
    mediaViewerContent.slice(semanticLiveStart, ordinaryMediaStart).includes('onSwipePrevious'),
    false,
    'Live Photo hold/release path must not be replaced by image swipe gestures',
  )
  assert.ok(runtimeDocs.includes('移动 Viewer'), 'Web App Runtime must document mobile Viewer behavior')
  assert.ok(previewDocs.includes('pinch'), 'Preview Engine must document touch image gestures')
})
