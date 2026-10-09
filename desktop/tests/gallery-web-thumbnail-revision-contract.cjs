'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const script = fs.readFileSync(path.join(
  root, 'desktop/scripts/gallery-web-thumbnail-revision-main.cjs'), 'utf8')
test('actual Chromium HTTP revision probe has a fixed 3+3 workload and real Web method', () => {
  assert.doesNotThrow(() => new vm.Script(script))
  for (const token of [
    "web/src/api.ts", "web/src/mediaBinaryProgress.ts",
    "actualMethod", "xDriveMediaResponseBlob(response, signal, onProgress)",
    "private, max-age=3600", "known-revision", "unknown-revision",
    "for (let sample = 1; sample <= 3; sample++)",
    "httpRequests === 2", "updatedRevisionNeverStale",
  ]) assert.ok(script.includes(token), 'missing native Web cache benchmark contract: ' + token)
})
