'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
const scenario = fs.readFileSync(path.join(root, 'desktop/scripts/mobile-web-app-browser.cjs'), 'utf8')
const branch = 'test/viewer-320px-real-chromium-reduced-motion-'

test('Viewer 320px Chromium PR opts into browser preparation, actual acceptance and artifact upload', () => {
  // A green generic Web build is NOT evidence for the real Browser scenario.
  assert.equal(workflow.split(`startsWith(github.head_ref, '${branch}')`).length - 1, 3,
    'prepare Chrome, run true Chromium geometry, and upload artifacts must all opt in')
  assert.match(workflow, /Native Chrome iOS27 Gallery Viewer responsive geometry and Reduced Motion/)
  assert.match(workflow, /--scenario=gallery-ios27-viewer/)
  assert.match(workflow, /gallery-ios27-routed-viewer-parity/)
  assert.match(workflow, /git rev-parse HEAD.*tested-checkout\.sha/)
})

test('native Viewer browser case asserts 320/367/368/375 and OS Reduced Motion', () => {
  const fn = scenario.slice(scenario.indexOf('async function galleryIos27ViewerAcceptance('))
  assert.ok(fn.length > 1000)
  for (const token of [
    'width: 320', 'width: 367', 'width: 368', 'width: 375',
    'page.emulateMedia({ reducedMotion:', "getComputedStyle(rail).overflowX",
    "getByRole('menuitem', { name: '上一张' })",
    "getByRole('menuitem', { name: '下一张' })",
  ]) {
    assert.ok(fn.includes(token), 'missing real browser coverage: ' + token)
  }
})

test('Chromium Viewer validates direct Info access and keyboard focus guard, not obsolete More-only UI', () => {
  const script = scenario.slice(scenario.indexOf('async function galleryIos27ViewerAcceptance('))
  assert.match(script, /data\.infoInRail && !data\.infoInHeader/)
  assert.doesNotMatch(script, /&& !data\.infoInRail && !data\.infoInHeader/)
  assert.match(script, /mobileMore\.getByRole\('menuitem', \{ name: '查看属性' \}\)\.count\(\) === 0/)
  assert.match(script, /keyboard-focused Viewer chrome stays visible after auto-hide dwell/)
  assert.match(script, /await frame\.focus\(\)/)
})

test('Chromium Viewer return anchors stable Node identity without waiting for thumbnail decode', () => {
  const script = scenario.slice(scenario.indexOf('async function galleryIos27ViewerAcceptance('))
  assert.match(script, /clickedNodeID: Number\(el\.getAttribute\('data-xdrive-media-node-id'\)\)/)
  assert.match(script, /clickedNodeName: el\.querySelector\('\.media-name'\)\?\.textContent\?\.trim\(\)/)
  assert.match(script, /originalLogicalIndex: s\.clickedNodeIndex/)
  assert.match(script, /originalNodeID: s\.clickedNodeID/)
  assert.match(script, /initialID === String\(opened\.nodeID\)/)
  assert.doesNotMatch(script, /tile\?\.querySelector\('img'\)\?\.alt === s\.clickedNodeName/)
})
