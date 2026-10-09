const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const gallery = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx'), 'utf8')

test('Gallery touch and desktop pointer use identical immediate Viewer opening', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'const openPreview = () => onPreview(item)',
    'if (event.detail > 1) return',
    'openPreview()',
    'onDoubleClick={(event) => event.preventDefault()}',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery unified click contract missing: ' + token)
  }
  const clickStart = gallery.indexOf('onClick={(event) => {', gallery.indexOf('function MediaTile('))
  const doubleClick = gallery.indexOf('onDoubleClick={(event) =>', clickStart)
  const clickHandler = gallery.slice(clickStart, doubleClick)
  assert.match(clickHandler, /openPreview\(\)/, 'single-click must directly open Viewer')
  assert.doesNotMatch(clickHandler, /openDetails\(\)|pointerType|clickTimerRef/)
})

test('Gallery touch exposes Context Menu Properties without tile Info/Favorite operation buttons', () => {
  for (const token of [
    'onPointerDownCapture={handleGalleryPointerDown}',
    'onPointerMoveCapture={handleGalleryPointerMove}',
    'setMediaContextMenu({ item: press.item, index: press.index, top: press.start.y, left: press.start.x })',
    'openMediaItem(mediaContextMenu.item)',
    'toggleMediaFavorite(mediaContextMenu.item)',
    'width: compactTouch ? 44 : undefined',
    'height: compactTouch ? 44 : undefined',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery hold/menu or accessible selection action missing: ' + token)
  }
  assert.doesNotMatch(gallery, /data-xdrive-gallery-touch-info/)
  assert.match(gallery, /!compactTouch && onSetFavorite/, 'desktop retains favorite while touch tile stays clean')
})

test('Gallery selection mode and keyboard Space win over direct-open', () => {
  const clickStart = gallery.indexOf('onClick={(event) => {', gallery.indexOf('function MediaTile('))
  const clickEnd = gallery.indexOf('onDoubleClick={(event) =>', clickStart)
  const clickHandler = gallery.slice(clickStart, clickEnd)
  assert.ok(clickHandler.indexOf('if (selectionMode ||') < clickHandler.indexOf('openPreview()'))
  assert.ok(clickHandler.includes('onSelect(item, logicalIndex'))
  assert.ok(gallery.includes("event.key === ' ' || (selectionMode && event.key === 'Enter')"))
  assert.match(gallery, /if \(event.pointerType !== 'touch' \|\| selectionMode \|\| typeof window/, 'selection mode must prevent long-press menu')
  assert.match(gallery, /if \(event.pointerType === 'touch' && !event.isPrimary\)/, 'secondary touch must cancel long-press menu')
})

test('Gallery stationary hold creates no overlay until release and never submits a timeline reorder', () => {
  const touch = gallery.slice(gallery.indexOf('const galleryTouchPressRef'), gallery.indexOf('const openMediaPreview ='))
  const timer = touch.slice(touch.indexOf('const timer = window.setTimeout'), touch.indexOf('const handleGalleryPointerMove'))
  const release = touch.slice(touch.indexOf('const handleGalleryPointerUp'), touch.indexOf('const handleGalleryPointerCancel'))
  assert.match(timer, /press.held = true/, 'stationary hold must arm context intent')
  assert.doesNotMatch(timer, /setMediaContextMenu\(/, 'the held finger must not hit a new MUI Portal')
  assert.match(release, /if \(!press\?\.held/, 'short tap must open the Viewer instead')
  assert.match(release, /setMediaContextMenu\(\{ item: press.item/, 'menu opens on stationary release')
  assert.match(release, /blockHeldClick/, 'release compatibility click cannot trigger the menu')
  assert.match(gallery, /onContextMenu=\{handleMediaContextMenu\}/, 'ordinary pointer context menu still available')
  assert.match(touch, /if \(galleryTouchPressRef.current \|\| galleryHoldClickRef.current !== null\)/,
    'native touch context menu must not preempt a held pointer')
  assert.doesNotMatch(touch, /onDrop|onReorder|dropOnTimeline/,
    'Gallery chronological timeline is not a drag-to-reorder surface')
})
