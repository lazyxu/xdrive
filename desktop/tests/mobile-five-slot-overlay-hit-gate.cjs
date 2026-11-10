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

test('real signed H264 fixture only clicks an unobscured actual button and diagnoses hidden cases', () => {
  const harness = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  assert.ok(harness.includes("const selector = '[data-xdrive-mobile-five-slot] button'"))
  assert.ok(harness.includes('const hit = document.elementFromPoint(x, y)'))
  assert.ok(harness.includes('return hit === button || button.contains(hit)'))
  assert.ok(harness.includes('matching:matching.length'))
  assert.ok(harness.includes('withinViewport,unobscured:candidates.length'))
  assert.ok(harness.includes("'unobscured genuine five-slot destination '+name"))
  assert.ok(harness.includes("win.webContents.sendInputEvent({type:'mouseDown'"))
  assert.ok(harness.includes("win.webContents.sendInputEvent({type:'mouseUp'"))
  assert.ok(!harness.includes("window.location.hash = '#/app/files'"))
})
