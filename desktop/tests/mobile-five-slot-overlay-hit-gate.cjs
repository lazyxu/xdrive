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
  assert.ok(harness.includes('if (hit === button || button.contains(hit)) {') &&
    harness.includes('validatedPoints.push({x:Math.round(x),y:Math.round(y),baselineEdgeHit:false})') &&
    harness.includes('return validatedPoints[0]'),
    'a real destination must be pointer-targeted only after an exact unobscured DOM hit test')
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


const vm = require('node:vm')

async function probeActualFiveSlot({ baseline = false, blocker = 'snackbar', openBottom = true } = {}) {
  const harness = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const start = harness.indexOf('async function visibleButtonCenter(win, label) {')
  const end = harness.indexOf('\nfunction sendActualPointer', start)
  assert.ok(start >= 0 && end > start, 'use the actual production test-harness function')
  const sourceFunction = harness.slice(start, end)
  const visibleButtonCenter = vm.runInNewContext('(' + sourceFunction + ')', {
    process: { env: { XD_VIEWER_FF_BASELINE_EDGE_TAP: baseline ? '1' : '' } }, JSON,
  })
  const button = {
    textContent: '文件',
    tagName: 'BUTTON',
    getAttribute: () => '',
    contains: node => node === button,
    getBoundingClientRect: () => ({
      left: 228, top: 761, width: 78, height: 56, right: 306, bottom: 817,
    }),
  }
  const over = {
    tagName: 'DIV', parentElement: null,
    getBoundingClientRect: () => ({width:370,height:100}),
    closest: selector => selector ===
      (blocker === 'snackbar' ? '.MuiSnackbar-root' : '.MuiModal-root') ? over : null,
  }
  const document = {
    querySelectorAll: selector => selector === '[data-xdrive-mobile-five-slot] button' ? [button] : [],
    elementFromPoint: (_x, y) => blocker === 'none' || (openBottom && y > 799) ? button : over,
  }
  const win = { webContents: {executeJavaScript: code => vm.runInNewContext(code, {
    document, innerWidth:390, innerHeight:817, JSON,
    getComputedStyle: node => ({visibility:'visible',pointerEvents:'auto',
      position:node === over ? 'fixed' : 'relative', zIndex:node === over ? '1400' : '1100'}),
  })} }
  return visibleButtonCenter(win, '文件')
}

test('actual five-slot center hit is mandatory for candidate even when Snackbar blocks it', async () => {
  const pos = await probeActualFiveSlot({baseline:false,blocker:'snackbar'})
  assert.match(pos.error, /got 0/)
  assert.equal(pos.counts.blockerKind, 'snackbar')
  assert.equal(pos.counts.unobscured, 0)
})
test('frozen baseline may use only a real unobscured lower point on the SAME Files button', async () => {
  const pos = await probeActualFiveSlot({baseline:true,blocker:'snackbar'})
  assert.equal(pos.error, undefined)
  assert.equal(pos.baselineEdgeHit, true)
  assert.equal(pos.x, 267)
  assert.ok(pos.y > 799 && pos.y < 817)
})
test('normal Files center tap remains unchanged in both candidate and frozen baseline', async () => {
  for (const baseline of [true,false]) {
    const pos = await probeActualFiveSlot({baseline,blocker:'none'})
    assert.equal(pos.error, undefined)
    assert.equal(pos.baselineEdgeHit, false)
    assert.equal(pos.x, 267)
    assert.equal(pos.y, 789)
  }
})
test('a modal or entirely blocked Files button cannot be bypassed on frozen baseline', async () => {
  for (const attempt of [
    {baseline:true,blocker:'modal',openBottom:true},
    {baseline:true,blocker:'snackbar',openBottom:false},
  ]) {
    const pos = await probeActualFiveSlot(attempt)
    assert.match(pos.error, /got 0/)
    assert.equal(pos.counts.unobscured, 0)
  }
})
test('benchmark only enables verified edge tapping in baseline and preserves real pointer gate', () => {
  const workflow = read('.github/workflows/viewer-first-frame-paired-h264.yml')
  assert.ok(workflow.includes('export XD_VIEWER_FF_BASELINE_EDGE_TAP=1'))
  assert.ok(workflow.includes('unset XD_VIEWER_FF_BASELINE_EDGE_TAP'))
  assert.ok(workflow.indexOf('export XD_VIEWER_FF_BASELINE_EDGE_TAP=1') >
    workflow.indexOf('mv desktop/pwa-p1-owner-100k-h264-viewer-results "$OUT/candidate"'))
  const harness = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  assert.ok(harness.includes("hit?.closest('.MuiSnackbar-root')"))
  assert.ok(harness.includes('const edgeHit = document.elementFromPoint(x, edgeY)'))
  assert.ok(harness.includes('if (edgeHit === button || button.contains(edgeHit))'))
  assert.ok(harness.includes("process.env.XD_VIEWER_FF_BASELINE_EDGE_TAP === '1'"))
  assert.ok(!harness.includes("window.location.hash = '#/app/files'"))
})
