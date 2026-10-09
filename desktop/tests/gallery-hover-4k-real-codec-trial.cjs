'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const file = path.resolve(__dirname, '../scripts/gallery-hover-4k-real-codec-trial-main.cjs')
const src = fs.readFileSync(file, 'utf8')
test('4K/HEVC original-video feasibility source parses with frozen real media budgets', () => {
  assert.doesNotThrow(() => new vm.Script(src))
  for (const token of [
    'logicalVideoNamespace: 100_000',
    'width: 3840',
    'height: 2160',
    'keyframeIntervalFrames: 48',
    'longVideoSeconds: 60',
    "codec === 'h264' ? 'libx264' : 'libx265'",
    "'libx265'",
    "run('ffprobe'",
    "'-stream_loop', '9'",
    'hoverDelayMs: 400',
    'quickPassMs: 150',
    'samplesPerMode: 3',
    'activePlayMs: 350',
    'abortObservationMs: 160',
    'res.on(',
    'responseBytes',
    'firstFrameMs',
    'video.getVideoPlaybackQuality',
    'maxOneMediaElement',
    'h264EarlyDisconnect',
    'withinPromotionByteBudget',
    'hevcSupportedSamples',
    'Do not enable original-video hover',
  ]) assert.ok(src.includes(token), 'missing strict 4K benchmark contract: '+token)
})
