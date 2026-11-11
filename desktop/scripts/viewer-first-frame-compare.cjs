'use strict'
// This report compares two actually executed production Web Viewer bundles
// on the SAME Electron runner and SAME authenticated Go/PG17/CAS fixture.
// It does not use benchmark thresholds to declare an unmeasured speedup.
const fs = require('node:fs')

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
function validatedRows(summary, label) {
  if (!summary || summary.passed !== true || summary.firstFrameBenchMode !== true ||
      summary.sampleCount !== 3 || !Array.isArray(summary.samples) ||
      summary.samples.length !== 3) throw Error(label + ': real H264 n3 gate missing')
  const rows = summary.samples.map((row, index) => {
    const frame = row?.p1H264Frames?.firstFrame
    if (row?.p1H264Frames?.passed !== true || frame?.ready !== true ||
        frame.actualSignedVideo !== true || !(frame.videoWidth > 0) ||
        !(frame.videoHeight > 0) || !(frame.presentedFrames > 0) ||
        !Number.isFinite(frame.firstFrameMs) || frame.firstFrameMs <= 0 ||
        frame.firstFrameMs > 60000 ||
        !Number.isFinite(frame.urlMs) || frame.urlMs < 0 ||
        frame.firstFrameMs < frame.urlMs) {
      throw Error(label + ': real signed H264 compositor first-frame sample ' + index + ' invalid')
    }
    return {
      firstFrameMs: frame.firstFrameMs,
      urlMs: frame.urlMs,
      metadataMs: frame.metadataMs,
      loadedDataMs: frame.loadedDataMs,
      rangeTTFBMs: frame.rangeTTFBMs,
      navigationVisible: frame.navigationVisible,
      videoWidth: frame.videoWidth,
      videoHeight: frame.videoHeight,
    }
  })
  return rows
}
function compareRealVideoFirstFrames(before, after, metadata = {}) {
  const baseline = validatedRows(before, 'baseline')
  const candidate = validatedRows(after, 'candidate')
  const metrics = ['urlMs', 'metadataMs', 'loadedDataMs', 'rangeTTFBMs', 'firstFrameMs']
  const observed = Object.fromEntries(metrics.map(name => {
    const base = baseline.map(row => row[name])
    const head = candidate.map(row => row[name])
    if (!base.every(v => Number.isFinite(v) && v >= 0) ||
        !head.every(v => Number.isFinite(v) && v >= 0)) {
      return [name, { baselineP50Ms: null, candidateP50Ms: null,
        deltaP50Ms: null, measured: false, reason: 'browser omitted event/timing' }]
    }
    const b = median(base), c = median(head)
    return [name, {
      baselineP50Ms: b,
      candidateP50Ms: c,
      deltaP50Ms: Math.round((c - b) * 1000) / 1000,
      relativeChangePercent: b > 0 ? Math.round((c - b) / b * 10000) / 100 : null,
      measured: true,
    }]
  }))
  const firstFrame = observed.firstFrameMs
  return {
    validated: true,
    comparison: 'same-runner, same Go/PG17/CAS fixture, two independently compiled actual xDrive Web Viewer builds',
    ...metadata,
    sampleCountEach: 3,
    metrics: observed,
    baselineSamples: baseline,
    candidateSamples: candidate,
    observedFirstFrameDirection: firstFrame.deltaP50Ms < 0 ? 'candidate-faster-observed' :
      firstFrame.deltaP50Ms > 0 ? 'candidate-slower-observed' : 'no-p50-change-observed',
    statisticallyEstablishedSpeedup: false,
    caveats: [
      'Sequential n3/n3 cannot establish a statistically significant causal gain or eliminate thermal/network variance',
      'Authentic signed H264 in shared Web Viewer under Electron Chromium, not installed Windows Desktop Agent IPC, remote WAN, HEVC or real production dataset',
      'Optional Range TTFB and metadata metrics are null when the browser does not expose them; never fabricate measurements',
    ],
  }
}
if (require.main === module) {
  const [beforeFile, afterFile, outputFile, baseSHA, headSHA] = process.argv.slice(2)
  if (!beforeFile || !afterFile || !outputFile ||
      !/^[a-f0-9]{40}$/.test(baseSHA || '') || !/^[a-f0-9]{40}$/.test(headSHA || '')) {
    throw Error('usage: node viewer-first-frame-compare.cjs baseline.json candidate.json output.json <base-sha> <head-sha>')
  }
  const report = compareRealVideoFirstFrames(
    JSON.parse(fs.readFileSync(beforeFile, 'utf8')),
    JSON.parse(fs.readFileSync(afterFile, 'utf8')),
    { baselineCommit: baseSHA, candidateCommit: headSHA },
  )
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n')
  console.log('XDRIVE_ACTUAL_H264_FIRST_FRAME_COMPARISON '+JSON.stringify({
    sampleCountEach:report.sampleCountEach,baselineCommit:baseSHA,candidateCommit:headSHA,
    metrics:report.metrics,observedDirection:report.observedFirstFrameDirection,
    statisticallyEstablishedSpeedup:report.statisticallyEstablishedSpeedup,
  }))
}
module.exports = { compareRealVideoFirstFrames }
