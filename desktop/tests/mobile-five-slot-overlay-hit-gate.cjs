'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '../..')
const read = file => readFileSync(path.join(repo, file), 'utf8')

test('mobile five-slot Files nav stays above Gallery tiles but below real modal portals', () => {
  const ui = read('web/src/MobileFiveSlotNavigation.tsx')
  const nav = ui.slice(ui.indexOf('<Box component="nav" aria-label="移动端五个功能入口"'),
    ui.indexOf('<BottomNavigation showLabels'))
  assert.ok(nav.includes("position: 'relative', zIndex: (theme) => theme.zIndex.appBar"))
  assert.ok(ui.includes('<BottomNavigationAction value="files" label="文件"'))
  assert.ok(ui.includes("onClick={() => onSelect('files')}"))
  assert.ok(ui.includes('data-xdrive-mobile-five-slot'))
})

test('mobile feedback stays above the genuine Files dock and cannot create an invisible 1400-z-index hit blocker', () => {
  const toast = read('ui/shared/src/mui/FeedbackSnackbar.tsx')
  assert.ok(toast.includes("bottom: { xs: 'calc(64px + env(safe-area-inset-bottom))', sm: '24px' }"))
  assert.ok(toast.includes("bottom: 'calc(52px + env(safe-area-inset-bottom))'"),
    'landscape compact docks must also keep feedback above real navigation')
  assert.ok(toast.includes("pointerEvents: 'none'"),
    'fixed snackbar root may not steal hit-testing outside visible feedback')
  assert.ok(toast.includes("'& > div': { pointerEvents: 'none' }"),
    'passive Snackbar content must not occlude a genuine five-slot destination')
  assert.ok(toast.includes("'& a[href], & button, & [role=\"button\"]': { pointerEvents: 'auto' }"),
    'only explicit toast actions and close controls remain clickable')
  assert.ok(!toast.includes("'& > div': { pointerEvents: 'auto' }"),
    'a large alert surface must not become an invisible navigation blocker')
  assert.ok(toast.includes('autoHideDuration={autoHideDuration}'),
    'keep original toast lifecycle rather than disabling user feedback')
  const harness = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  assert.ok(harness.includes("hit.closest('.MuiSnackbar-root') ? 'snackbar'"),
    'real signed H264 gate must classify a remaining Snackbar obstruction')
})

test('real signed H264 fixture only clicks an unobscured actual button and diagnoses hidden cases', () => {
  const harness = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  assert.ok(harness.includes("const selector = '[data-xdrive-mobile-five-slot] button'"))
  assert.ok(harness.includes('const hit = document.elementFromPoint(x, y)'))
  assert.ok(harness.includes('if (hit === button || button.contains(hit)) return true'),
    'a real navigation destination is clickable only after the strict DOM hit test')
  assert.ok(harness.includes('matching:matching.length'))
  assert.ok(harness.includes('withinViewport,unobscured:candidates.length'))
  assert.ok(harness.includes('blockerKind ='), 'must distinguish real blocking UI families')
  assert.ok(harness.includes('blockerTag'), 'must emit bounded element type only')
  assert.ok(harness.includes('blockerStack'), 'must emit bounded z-index only')
  assert.ok(harness.includes('blockerAncestorLayers'), 'must expose only bounded fixed-enum ancestor stacking context')
  assert.ok(harness.includes('hitCounts:last?.counts||null'),
    'a failed genuine click must report anonymous viewport and obstruction counts')
  assert.ok(harness.includes("'unobscured genuine five-slot destination '+name"))
  assert.ok(harness.includes("win.webContents.sendInputEvent({type:'mouseDown'"))
  assert.ok(harness.includes("win.webContents.sendInputEvent({type:'mouseUp'"))
  assert.ok(!harness.includes("window.location.hash = '#/app/files'"))
})
