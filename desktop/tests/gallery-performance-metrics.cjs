const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function attribute(entries, activationStart, presentationEnd) {
  const filename = path.join(__dirname, '../../ui/shared/src/mui/GalleryPerformanceMetrics.ts')
  assert.ok(fs.existsSync(filename), 'Gallery benchmark must attribute buffered tasks to the activation window')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', output)(mod.exports, mod)
  return mod.exports.xDriveGalleryPerformanceLongTaskAttribution(entries, activationStart, presentationEnd)
}

test('Gallery fixture task remains in legacy totals and does not become an activation red signal', () => {
  const metrics = attribute([{ startTime: 10, duration: 140 }], 200, 400)
  assert.deepEqual(metrics, {
    longTaskCount: 1, longTaskDurationMs: 140, longestLongTaskMs: 140,
    activationLongTaskCount: 0, activationLongTaskDurationMs: 0,
    activationLongestLongTaskMs: 0, activationLongTaskOverlapDurationMs: 0,
    activationLongestLongTaskOverlapMs: 0,
    preActivationLongTaskCount: 1, preActivationLongTaskDurationMs: 140,
    preActivationLongestLongTaskMs: 140,
  })
})

test('Gallery activation attribution preserves full overlapping tasks and clips elapsed overlap at both boundaries', () => {
  const metrics = attribute([
    { startTime: 80, duration: 50 },
    { startTime: 140, duration: 40 },
    { startTime: 190, duration: 40 },
    { startTime: 240, duration: 10 },
  ], 100, 200)
  assert.deepEqual(metrics, {
    longTaskCount: 4, longTaskDurationMs: 140, longestLongTaskMs: 50,
    activationLongTaskCount: 3, activationLongTaskDurationMs: 130,
    activationLongestLongTaskMs: 50, activationLongTaskOverlapDurationMs: 80,
    activationLongestLongTaskOverlapMs: 40,
    preActivationLongTaskCount: 1, preActivationLongTaskDurationMs: 20,
    preActivationLongestLongTaskMs: 20,
  })
  const boundary = attribute([
    { startTime: 50, duration: 50 },
    { startTime: 200, duration: 50 },
  ], 100, 200)
  assert.equal(boundary.activationLongTaskCount, 0)
  assert.equal(boundary.longTaskCount, 2)
})
