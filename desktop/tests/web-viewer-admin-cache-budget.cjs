'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8')

test('Viewer administrator cache UI requires a second explicit eviction confirmation', () => {
  const ui = read('web/src/ViewerQualitySettingsSection.tsx')
  const api = read('web/src/api.ts')
  assert.match(ui, /isAdmin \? \(/)
  assert.match(ui, /data-xdrive-viewer-quality-admin/)
  assert.match(ui, /confirmEviction/)
  assert.match(ui, /if \(!isAdmin \|\| saving \|\| !confirmEviction\) return/)
  assert.match(ui, /cache_budget_bytes/)
  assert.match(api, /async adminViewerCacheStatus\(/)
  assert.match(api, /async adminViewerCacheEvict\(/)
  assert.match(api, /JSON.stringify\(\{ dry_run: dryRun \}\)/)
})
