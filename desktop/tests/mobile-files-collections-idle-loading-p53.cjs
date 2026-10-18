const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const mobile = read('web/src/MobileFiles.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const hook = read('ui/shared/src/mui/useDeferredLoading.ts')
const existing = read('desktop/tests/mobile-files-collection-quiet-read.cjs')

test('unverified collection read receipts never pretend an idle operation is pending',()=>{
  assert.ok(mobile.includes("const collectionFirstRead = section !== 'browse' && sectionItems.length === 0"))
  assert.ok(mobile.includes("collectionReadState === 'unverified'"))
  assert.ok(mobile.includes("collectionReadState === 'error' && collectionLoading"))
  for(const area of ['recent','favorites']){
    const old="useXDriveDeferredPendingLoading(section === '"+area+"' && collectionFirstRead && collectionLoading)"
    assert.equal(mobile.includes(old), false, 'a real index read must not add a visual timer ring')
  }
  assert.ok(mobile.includes('<Box data-mobile-files-collection-first-read aria-hidden="true" />'))
  assert.ok(existing.includes('data-mobile-files-collection-first-read'),
    'original source-contract test agrees that the honest pending slot remains mounted')
  assert.ok(mobile.includes("aria-busy={collectionFirstRead && collectionLoading || undefined}"))
  assert.ok(mobile.includes('data-mobile-files-collection-first-read'))
  assert.ok(mobile.includes('data-mobile-files-collection-error'))
  assert.ok(mobile.includes('collectionReadState === \'ready\' ? ('))
  assert.ok(web.includes('recentLoading={recent.loading}'))
  assert.ok(web.includes('favoritesLoading={favorites.loading}'))
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
  assert.ok(hook.includes('return pending && visible'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'), 'thumbnail requests retain original progress UI')
})
