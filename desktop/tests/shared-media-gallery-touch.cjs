const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const gallery = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx'), 'utf8')

test('Gallery compact touch opens Viewer on touch while mouse keeps desktop click semantics', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'lastPointerTypeRef',
    'lastPointerTypeRef.current = event.pointerType',
    "if (compactTouch && pointerType === 'touch')",
    'openPreview()',
    'openDetails()',
    'onDoubleClick={(event) =>',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery touch activation contract missing: ' + token)
  }
  const clickStart = gallery.indexOf('onClick={(event) => {')
  const doubleClick = gallery.indexOf('onDoubleClick={(event) =>', clickStart)
  const clickHandler = gallery.slice(clickStart, doubleClick)
  assert.ok(clickHandler.includes("pointerType === 'touch'"), 'touch click must direct-open the Viewer')
  assert.ok(clickHandler.includes('openDetails()'), 'non-touch click must retain desktop single-click details')
})

test('Gallery compact touch exposes a dedicated Info action and 44px touch targets', () => {
  for (const token of [
    'data-xdrive-gallery-touch-info',
    'aria-label="媒体信息"',
    'onOpen(item)',
    'width: 44',
    'height: 44',
    'width: compactTouch ? 44 : undefined',
    'height: compactTouch ? 44 : undefined',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery touch affordance missing: ' + token)
  }
})

test('Gallery selection mode still wins over touch direct-open', () => {
  const clickStart = gallery.indexOf('onClick={(event) => {')
  const clickEnd = gallery.indexOf('onDoubleClick={(event) =>', clickStart)
  const clickHandler = gallery.slice(clickStart, clickEnd)
  assert.ok(clickHandler.indexOf('if (selectionMode ||') < clickHandler.indexOf("if (compactTouch && pointerType === 'touch')"))
  assert.ok(clickHandler.includes('onSelect(item, logicalIndex'))
  assert.ok(gallery.includes('{compactTouch && !selectionMode ? ('), 'Info action must not compete with selection mode')
})
