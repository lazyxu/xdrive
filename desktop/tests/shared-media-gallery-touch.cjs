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

test('Gallery compact touch exposes accessible Properties and 44px targets', () => {
  for (const token of [
    'data-xdrive-gallery-touch-info',
    'aria-label="查看属性"',
    'onOpen(item)',
    'width: 44',
    'height: 44',
    'width: compactTouch ? 44 : undefined',
    'height: compactTouch ? 44 : undefined',
    'left: selectionMode || selectedForAction ? (compactTouch ? 52 : 42) : 8',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery touch property action missing: ' + token)
  }
})

test('Gallery selection mode and keyboard Space win over direct-open', () => {
  const clickStart = gallery.indexOf('onClick={(event) => {', gallery.indexOf('function MediaTile('))
  const clickEnd = gallery.indexOf('onDoubleClick={(event) =>', clickStart)
  const clickHandler = gallery.slice(clickStart, clickEnd)
  assert.ok(clickHandler.indexOf('if (selectionMode ||') < clickHandler.indexOf('openPreview()'))
  assert.ok(clickHandler.includes('onSelect(item, logicalIndex'))
  assert.ok(gallery.includes("event.key === ' ' || (selectionMode && event.key === 'Enter')"))
  assert.ok(gallery.includes('{compactTouch && !selectionMode ? ('), 'Properties must not compete with selection mode')
})
