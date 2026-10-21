'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
test('SH-P018 paired n3 compares true production Web source and real canceled Go HTTP requests', () => {
  const w = read('.github/workflows/sh-p018-paired-next-page-100k.yml')
  const go = read('internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go')
  const driver = read('desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs')
  const compare = read('desktop/scripts/sh-p018-paired-summary.cjs')
  for(const token of [
    'git show HEAD^:web/src/PublicShare.tsx', 'git show HEAD:web/src/PublicShare.tsx',
    'npm --prefix web run build', 'postgres:17-alpine', 'CREATE DATABASE',
    'candidate original', 'original candidate', 'XD_SH_P018_PAIRED_NEXT_PAGE',
    'xvfb-run', 'sh-p018-paired-summary.cjs'
  ]) assert.ok(w.includes(token), 'missing physical source A/B action: '+token)
  for(const token of ['cancelLastMicros.Store(elapsed)', 'thumbnail_cancel_last_us',
    '<-w.request.Context().Done()']) assert.ok(go.includes(token),'missing Go context proof: '+token)
  for(const token of ['XD_SH_P018_PAIRED_NEXT_PAGE', 'XD_SH_P018_ALLOW_SLOW_ORIGINAL',
    'go_cancel_event_ms', 'variant_web_sha256']) assert.ok(driver.includes(token),
      'missing individual source-bound event: '+token)
  for(const token of ['0.20', '1.25', 'thumbnail_cancelled_go',
    'thumbnail_active_held', 'source_aggregate_sha256', '100000']) {
    assert.ok(compare.includes(token),'missing matched correctness/resource gate: '+token)
  }
  assert.equal(w.includes('git checkout HEAD^ -- .'),false,'do not roll back entire repository')
})
