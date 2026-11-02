'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const image = read('ui/shared/src/mui/FilePreviewSurface.tsx')
const live = read('ui/shared/src/mui/LivePhotoSurface.tsx')
const physics = read('ui/shared/src/media-gallery-photo-swipe.ts')
const swipeModule = { exports: {} }
const swipeJS = ts.transpileModule(physics, {
  fileName: 'media-gallery-photo-swipe.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('exports', 'module', swipeJS)(swipeModule.exports, swipeModule)

test('Web mobile ordinary images follow finger at 1x and settle before a verified neighbor switch', () => {
  assert.match(image, /xDrivePhotoFingerTranslation\(/)
  assert.match(image, /setImageSwipeX\(x\)/)
  assert.match(image, /viewportTransform=\{\x60translate\(\$\{imageOffset\.x \+ \(imageScale <= 1\.01 \? imageSwipeX : 0\)\}/)
  assert.match(image, /xDrivePhotoPageTurn\(/)
  assert.match(image, /setImageSwipeX\(direction === 'next' \? -width : width\)/)
  assert.match(image, /imageSwipeTimerRef\.current = setTimeout/)
  assert.match(image, /currentSourceIdentityRef\.current !== identity/)
  assert.match(image, /imageSwipeTimerRef\.current !== null\) clearTimeout/)
  assert.match(image, /setImageSwipeTracking\(false\)/)
})
test('Web Live Photo gestures follow the same paging physics without starting motion', () => {
  assert.match(live, /gesture\.mode === 'swiping' && !gesture\.held/)
  assert.match(live, /xDrivePhotoFingerTranslation\(/)
  assert.match(live, /photoPageTimerRef\.current = setTimeout/)
  assert.match(live, /gestureSessionRef\.current !== session/)
  assert.match(live, /photoPageDragging/)
  assert.match(live, /onPointerLeave=\{handlePointerLeave\}/)
  assert.match(live, /photoPageTimerRef\.current !== null && !touchGestureRef\.current/)
  assert.match(live, /clearHoldTimer\(\)/)
  assert.match(live, /endHold\(\)/)
  assert.match(live, /pinching \|\| \(interactiveImage && pan\?\.pointerId/)
})
test('Invalid swipes rebound and edge drags are resisted without a new Owner read', () => {
  assert.match(physics, /Math\.abs\(dx\) < 10/)
  assert.match(physics, /dx \* 0\.18/)
  assert.match(physics, /Math\.abs\(dx\) < 56/)
  assert.match(physics, /elapsedMS > 700/)
  assert.match(physics, /return dx > 0 \? canPrevious/)
  assert.doesNotMatch(physics, /fetch\(|axios|loadThumbnail|loadPreviewURL|token/)
})

test('Deliberate slow drags turn only authorized neighbors, while small or diagonal slow drags rebound', () => {
  const turn = swipeModule.exports.xDrivePhotoPageTurn
  assert.equal(turn(-150, 0, 1200, false, true, 400), 'next')
  assert.equal(turn(150, 0, 1200, true, false, 400), 'previous')
  assert.equal(turn(-56, 0, 300, false, true, 400), 'next', 'short brisk swipe still works')
  assert.equal(turn(-100, 0, 1200, false, true, 400), null, 'short slow drag does not page')
  assert.equal(turn(-200, 170, 1200, false, true, 400), null, 'diagonal drag does not page')
  assert.equal(turn(-150, 0, 1200, false, false, 400), null, 'no unauthorized next item')
  assert.equal(turn(-150, 0, 1200, false, true, 0), null, 'unknown viewport never grants a slow turn')
  assert.equal(turn(-150, 0, -1, false, true, 400), null, 'invalid elapsed time is rejected')
})
