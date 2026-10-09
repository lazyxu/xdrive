const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..', '..')
const src = fs.readFileSync(path.join(root, 'desktop/scripts/gallery-hover-original-video-trial-main.cjs'), 'utf8')
test('native hover probe parses and keeps explicit pre-declared resource budgets', () => {
  assert.doesNotThrow(() => new vm.Script(src))
  for (const token of [
    'logicalVideoNamespace: 100_000',
    'hoverDelayMs: 400',
    'quickPassMs: 150',
    'samples: 3',
    'closedBeforeBody',
    'oneMediaElement',
    'abortsDelayedHTTP',
    "mode === 'quick-pass'",
    "mode === 'abandon'",
    'mediaElementsPeak',
    "video.removeAttribute('src')",
    'getVideoPlaybackQuality',
    'feasibility',
  ]) assert.ok(src.includes(token), token)
})
