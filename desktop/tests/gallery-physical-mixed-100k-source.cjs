'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
test('physical mixed 100k fixture is opt-in and separate from the original synthetic viewport', () => {
 const existing=read('internal/api/media_gallery_first_visible_performance_integration_test.go')
 const physical=read('internal/api/gallery_physical_mixed_first_visible_100k_performance_test.go')
 const ci=read('.github/workflows/gallery-physical-mixed-100k-first-visible-performance.yml')
 const required=['XD_GALLERY_REAL_PHYSICAL_MIXED_100K_PERF','gallerySeedRealPhysicalMixed100K','galleryPhysicalMixedViewportIDs','galleryFirstVisibleSeedObjects(t, db, countingStore, viewport)']
 for(const item of required)assert.ok(existing.includes(item),item)
 for(const item of ['mediaGalleryFirstOpenPhysical','fileExplorerPhysicalJPEG','fileExplorerH264PhysicalContainer','storage.ContentAddressedKey','store.Put(t.Context(), key, bytes.NewReader(source))','report.VerifiedCASReads++','counts.MotionPairs != mediaGalleryFirstOpenLivePhotos','xd_photo_resources','xd_media_metadata'])assert.ok(physical.includes(item),item)
 assert.ok(ci.includes('go test -c -o desktop/gallery-physical-mixed-100k-bin/api.test'))
 assert.ok(ci.includes("for sample in 1 2 3; do"))
 assert.ok(ci.includes('GALLERY_PHYSICAL_MIXED_100K_N3'))
})
