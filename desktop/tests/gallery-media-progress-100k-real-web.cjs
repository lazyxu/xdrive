'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('actual 100k Web Gallery runs source-exact optional-progress reader, not an unrelated response.blob shortcut', () => {
  const gallery = read('web/src/GalleryRealColdPerformanceHarness.tsx')
  const helper = read('web/src/mediaBinaryProgress.ts')
  for (const token of [
    "import { xDriveMediaResponseBlob } from './mediaBinaryProgress'",
    "const progressMode = new URLSearchParams",
    "loadThumbnail: async (nodeID, signal, _revision, onProgress)",
    "const blob = await xDriveMediaResponseBlob(response, signal, observe",
    "const observe = progressMode === 'on' && onProgress",
    "onProgress(loadedBytes, totalBytes)",
    "thumbnailProgressCompleted",
    "thumbnailProgressReportedBytes",
    "thumbnailProgressErrors",
    "progressMode === 'off'",
    "metrics.logicalItems !== 100000",
    "metrics.mountedTiles >= 1000",
  ]) assert.ok(gallery.includes(token), 'real 100k Gallery media-progress harness missing: ' + token)
  assert.ok(!gallery.includes('const blob = await response.blob()'),
    '100k media adapter must execute actual source-exact collector')
  assert.ok(helper.includes('if (!onProgress)'),
    'OFF mode must still use native response Blob without a progress subscriber')
  assert.ok(helper.includes('const blob = await response.blob()'),
    'native Blob fast path must remain available')
})

test('same-runner three matched 100k ON/OFF pairs retain cold fixture isolation and frozen acceptance', () => {
  const source = read('desktop/scripts/gallery-web-real-cold-firstpaint-main.cjs')
  for (const token of [
    "const samples = 3",
    "const mode of sample % 2 === 0 ? ['on', 'off'] : ['off', 'on']",
    "serveSample(sample + '-' + mode",
    "partition: 'gallery-real-cold-sample-' + sample + '-' + mode",
    "xdriveMediaProgress=",
    "result.thumbnailProgressCompleted",
    "result.thumbnailProgressReportedBytes",
    "result.thumbnailProgressErrors",
    "results.length !== samples * 2",
    "nPerMode: samples",
    "medianFirstPaintDeltaMs",
    "firstPaint2sBudgetMet",
    "noRepeatableFirstPaintRegression",
    "noRepeatableRssRegression",
  ]) assert.ok(source.includes(token), 'paired real 100k runner missing: ' + token)
  assert.ok(source.includes("result.mountedTiles >= 1000"),
    'real fixture cannot pass with unbounded tile DOM')
  assert.ok(source.includes("result.imagesDecodedAtCompletion < 12"),
    'real fixture cannot pass without twelve decoded thumbnails')
  assert.ok(source.includes("summary.json"),
    'measurement must be archived even when an acceptance budget fails')
})

test('existing real PostgreSQL/Gin/CAS 100k benchmark stays scoped on GitHub and GitLab', () => {
  const github = read('.github/workflows/ci.yml')
  const gitlab = read('.gitlab-ci.yml')
  assert.match(github, /gallery-web-real-cold-100k-performance:/)
  assert.match(github, /startsWith\(github\.head_ref, 'perf\/gallery-web-real-cold-100k-'\)/)
  assert.match(github, /gallery-web-real-cold-firstpaint-main\.cjs/)
  assert.match(gitlab, /gallery-web-real-cold-100k-performance:/)
  assert.match(gitlab, /CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ \/\^perf\\\/gallery-web-real-cold-100k-/)
  assert.match(gitlab, /gallery-web-real-cold-firstpaint-main\.cjs/)
})
