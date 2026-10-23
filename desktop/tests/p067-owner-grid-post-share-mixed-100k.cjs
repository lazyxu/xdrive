'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const p067 = 'perf/p067-post-share-grid-owner-mixed-100k-20261020'

test('P067 opts into all three real original 100k/115k mixed physical production clients without weakening budgets', () => {
  const targets = [
    ['file-explorer-wide-mixed-p050.yml', 'perf/file-explorer-wide-mixed-100k-p050-20261015', 'XD_FILEEXPLORER_WIDE_MIXED_100K_PERF'],
    ['file-explorer-mobile-mixed-p049.yml', 'perf/file-explorer-mobile-mixed-100k-p049-20261015', 'XD_FILEEXPLORER_MOBILE_MIXED_100K_PERF'],
    ['file-explorer-desktop-mixed-100k-performance.yml', 'perf/file-explorer-desktop-mixed-100k-p038-20261012', 'XD_FILEEXPLORER_DESKTOP_MIXED_100K_PERF'],
  ]
  for (const [name, prior, env] of targets) {
    const wf = read('.github/workflows/' + name)
    for (const token of [
      "github.head_ref == '" + prior + "'",
      "github.head_ref == '" + p067 + "'",
      "postgres:17-alpine", env,
      'github.event.pull_request.head.sha',
      'retention-days: 14',
      'sample-*-*.json',
      'summary.json',
    ]) assert.ok(wf.includes(token), name + ' must keep genuine exact-head physical 100k contract: ' + token)
    assert.ok(wf.includes('pull_request:'), name + ' must be opt-in pull request')
    assert.ok(!wf.includes('go test -race'), 'P067 is a performance test, not a Race workstream')
  }
})

test('P067 validates the actual Owner grid and media, not public-share-only original JPEG download', () => {
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const share = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const shareBridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const web = read('web/src/FileExplorerRealScrollPerformanceHarness.tsx')
  const wide = read('desktop/scripts/file-explorer-wide-mixed-100k-main.cjs')
  const mobile = read('desktop/scripts/file-explorer-real-physical-100k-main.cjs')
  const desktop = read('desktop/scripts/file-explorer-desktop-mixed-100k-runner.cjs')
  assert.match(leaf, /export function XDriveFileExplorerGridTileContent\(/)
  assert.match(owner, /<XDriveFileExplorerGridTileContent/)
  assert.match(share, /return <XDrivePublicShareUnifiedDirectoryExplorer/)
  assert.match(shareBridge, /<XDriveFileExplorer/)
  assert.doesNotMatch(share, /<XDriveFileExplorerGridTileContent/)
  assert.match(owner, /visual=\{thumbnailForItem\(item\)\}/)
  for (const token of [
    'XDriveFileExplorer', 'virtualCollection={virtualCollection}',
    "video.addEventListener('loadeddata'", 'ctx.drawImage(video',
    'rangeAbortRef.current?.abort()',
  ]) assert.ok(web.includes(token), 'real Owner mounted media preview missing: ' + token)
  for (const script of [wide, mobile]) {
    for(const token of ['115000', "['grid','details']", '0,0.25,0.50,0.75,0.95'])
      assert.ok(script.includes(token), 'real five positions and both Owner view modes must remain: ' + token)
  }
  assert.ok(desktop.includes('100000'), 'native desktop source must retain actual 100k workload')
  // Production /me/quota reads active local Push holds even when all holds are
  // empty. Three real 100k client scripts must not die on an unmigrated test DB
  // before the first physical media is even seeded.
  const fixture = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  const start = fixture.indexOf('if desktopFileExplorerMixed || p0c2SPAMode {')
  const end = fixture.indexOf('local, err := storage.NewLocal(', start)
  assert.ok(start > 0 && end > start, 'real mixed fixture migration scope missing')
  // The Desktop quota-migration branch still executes; PWA SPA adds an
  // independently enabled test mode without weakening physical benchmarks.
  assert.ok(fixture.includes('desktopFileExplorerMixed := os.Getenv('))
  assert.ok(fixture.includes('p0c2SPAMode := os.Getenv('))
  assert.ok(fixture.slice(start, end).includes(
    'db.AutoMigrate(&meta.LocalPushQuotaHold{}, &meta.FileVersion{}'),
    'opt-in mixed physical fixture needs the real quota-hold model for authenticated /me/quota')

  for(const path of ['docs/file-explorer-performance.md','docs/performance-test-registry.md','docs/performance-platform-coverage.md'])
    assert.ok(read(path).includes('P050 / M002-e'), 'do not erase original valid baseline: ' + path)
})
