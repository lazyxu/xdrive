'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const page = read('ui/shared/src/mui/MediaGallery.tsx')
const card = read('ui/shared/src/mui/MobileGalleryCollections.tsx')
const runner = read('desktop/scripts/mobile-web-app-browser.cjs')

test('P114: an authenticated bounded memory preview is visible in Collections only', () => {
  for (const token of [
    'collectionsMemoryPreviewReceipt',
    'setCollectionsMemoryPreviewReceipt(null)',
    'setCollectionsMemoryPreviewReceipt({ owner: preferenceScope, dataSource: source })',
    'collectionsMemoryPreviewReceipt?.owner === preferenceScope',
    'collectionsMemoryPreviewReceipt.dataSource === source',
    'mobileGalleryViewport && mobileCollectionsOverview',
    "memoriesReadState === 'ready'",
    "const [memoryIndexReceipt, setMemoryIndexReceipt]",
  ]) assert.ok(page.includes(token),token)
  assert.equal(page.includes("memories={memoriesReadState === 'ready' ? memories : []}"),false)
  assert.ok(card.includes('memories.filter((m) => m.item_count > 0)'))
  assert.ok(card.includes("'memory-' + m.id"))
  assert.ok(page.includes('request === collectionsPreviewRef.current.request'))
  assert.ok(page.includes('source.listMemories(day, 8, timeZone)'))
  assert.ok(page.includes('source.listMemories('), 'full Memory index continues independently')
})
test('P114: original browser fixture has complete Memory DTO and unsigned JSAPI gate, never bypasses checks', () => {
  assert.ok(runner.includes("id: 'qa-memory-1', title: '验收回忆 B'"))
  assert.ok(runner.includes("kind: 'recent_day', item_count: 120"))
  assert.ok(runner.includes("case 'GET /api/v1/media/places/baidu-jsapi/status':"))
  assert.ok(runner.includes("enabled: false"))
  assert.ok(runner.includes("activation_state: 'not_authorized'"))
  assert.ok(runner.includes('queryOnly(url, [])'))
  assert.ok(runner.includes('galleryMemoryNavigationAcceptance()'))
  assert.ok(runner.includes('galleryPlaceIndexNavigationAcceptance()'))
  assert.ok(runner.includes("await memory.waitFor()"))
  assert.ok(runner.includes("'no unknown API or external requests'"))
})
