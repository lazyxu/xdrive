'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = rel => fs.readFileSync(path.join(root,rel),'utf8')
test('100k real physical Web Gallery is explicit opt-in, keeping the prior first-visible fixture',()=>{
  const fixture=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  for(const tag of [
    'XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF',
    'gallerySeedRealPhysicalMixed100K',
    'galleryPhysicalMixedViewportIDs',
    'galleryFirstVisibleSeedObjects(',
    'physicalProbe.serve(w, r, router)',
    'physical-thumbnail-stats',
    '"physical_sources"','"physical_bytes"','"physical_verified"'
  ])assert.ok(fixture.includes(tag),'test-only physical source path absent: '+tag)
  assert.ok(fixture.includes('physicalViewportMode && os.Getenv("XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF")'),
    'normal decode baseline cannot use the artificially slowed HTTP cancellation fixture')
})
test('real Web Gallery 5 windows include six genuinely new decoded Blob still images each',()=>{
  const script=read('desktop/scripts/gallery-web-physical-mixed-100k-viewports.cjs')
  for(const tag of [
    '[0, 0.25, 0.5, 0.75, 0.95]',
    'data-xdrive-media-gallery-virtual-grid',
    'data-xdrive-media-tile',
    'data-xdrive-media-index',
    "startsWith('blob:')",
    'fresh.length>=6',
    'native mounted Gallery Grid and scroll host (inside first-view stopwatch)',
    'x.decode()',
    'requestAnimationFrame',
    'maxFirstSixMs = 20000',
    'max_active<=6',
    'rendererWorkingSet',
    'nativeStats'
  ])assert.ok(script.includes(tag),'missing genuine Web DOM decoding or Go resource proof: '+tag)
  const workflow=read('.github/workflows/gallery-web-physical-mixed-100k-viewports.yml')
  assert.ok(workflow.includes('ref: $' + '{{ github.event.pull_request.head.sha }}'))
  assert.ok(workflow.includes('VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1'))
  assert.ok(workflow.includes('go test -c -o desktop/gallery-physical-web-go/api.test'))
})
