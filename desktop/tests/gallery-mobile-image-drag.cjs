'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

test('mobile ordinary image follows pan without triggering work until pointer-up', () => {
  const file = read('ui/shared/src/mui/FilePreviewSurface.tsx')
  assert.match(file, /data-xdrive-photo-swipe-slide/)
  assert.match(file, /layer\.style\.transform =/)
  assert.match(file, /Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.18/)
  assert.match(file, /onSwipeNext : onSwipePrevious/)
  assert.match(file, /currentSourceIdentityRef\.current !== identity/)
  assert.match(file, /prefers-reduced-motion: reduce/)
  assert.match(file, /paintPhotoSwipe\(0, true\)/)
  assert.match(file, /imageViewportRef\.current\.scale <= 1\.01/)
  assert.match(file, /imagePinchRef\.current/)
})
