'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.resolve(
  __dirname, '../scripts/gallery-hover-short-preview-4k-main.cjs'), 'utf8')
test('P4 short-preview trial parses and freezes original-versus-preview resources', () => {
  assert.doesNotThrow(() => new vm.Script(source))
  for (const token of [
    'logicalVideoNamespace: 100_000', 'width: 3840', 'height: 2160',
    "['h264', 'hevc']", "'-stream_loop', '9'",
    'previewSeconds: 3', "id: '480p-450k'", "id: '720p-850k'",
    'previewStartSeconds: 0.75', 'samples: 3',
    'previewByteBudget: 1024 * 1024', 'offlineGenerationMedianBudgetMs: 3000',
    'medianGenerationMs', 'ffmpegMaxRssKB', 'sourceGOPFrames: 48',
    "modes = profile === 'original'", "['quick', 'play', 'abandon']",
    'abandonedCancelTransport', 'previewH264Decoded',
    'nativeWarmFirstFrameWithinTwoSeconds',
    'NO production activation', 'nativeRows.length !== 84',
  ]) {
    assert.ok(source.includes(token),
      'benchmark resource and scope contract missing: ' + token)
  }
})
