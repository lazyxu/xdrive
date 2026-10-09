'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('P0-C real Desktop probe uses production Electron preload → Main → Agent IPC without mocks', () => {
  const electron = read('desktop/scripts/gallery-desktop-real-cold-electron-main.cjs')
  const runner = read('desktop/scripts/gallery-desktop-real-cold-runner.cjs')
  const renderer = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  for (const token of [
    'async function measureRealDesktopMediaProgress(sample)',
    "await agent.getMediaItemRange('', 100, 0, {})",
    'agent.getMediaThumbnail(',
    'item.node.id, requestID, item.node.revision,',
    "mode === 'on' ? (loaded, total) => {",
    "mode === 'on'",
    'event.loaded < last',
    'last !== bodyBytes',
    'row.callbackCount',
    'realObserverEvents',
    'sourceExactMediaProgress',
    'sourceProgressResources',
    'nativeProcessMetrics',
    'rendererWorkingSetKiBSnapshot: galleryRendererMetrics',
  ]) assert.ok(electron.includes(token), 'actual Desktop probe missing: ' + token)
  assert.ok(runner.includes("XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE === '1'"),
    'benchmark-only opt-in flag must gate actual IPC work')
  assert.ok(runner.includes("env.XD_GALLERY_DESKTOP_REAL_AGENT_PID"),
    'actual Agent process must be sampled instead of an unrelated process')
  assert.ok(runner.includes("result.sourceExactMediaProgress"),
    'real runner must hard-fail absent progress events')
  assert.ok(renderer.includes('agent.getMediaThumbnail(nodeID, requestID, revision, onProgress)'),
    'real Gallery must forward the source revision and UI progress subscriber')
  assert.ok(main.includes("event.sender.send('agent:media-binary-progress'"),
    'Main must publish actual request-scoped Agent bytes')
  assert.ok(preload.includes('invokeMediaBinaryWithProgress('),
    'preload must own the callback subscription')
  assert.ok(preload.includes('removeListener(progressChannel, listener)'),
    'preload must stop delivering stale progress when invoke settles')
})

test('100k Desktop progress is measured after first visible decoded paint without changing Gallery first paint', () => {
  const s = read('desktop/scripts/gallery-desktop-real-cold-electron-main.cjs')
  const first = s.indexOf('const result = await until(')
  const afterCAS = s.indexOf('const afterCAS = await afterResp.json()')
  const probe = s.indexOf('let sourceExactMediaProgress = null')
  const data = s.indexOf("console.log('GALLERY_REAL_DESKTOP_ELECTRON_SAMPLE '")
  assert.ok(first > 0 && afterCAS > first && probe > afterCAS && data > probe,
    'progress probe must not pollute first-image timing or existing CAS before/after')
  const runner = read('desktop/scripts/gallery-desktop-real-cold-runner.cjs')
  assert.ok(runner.includes("assert(report.n === 3"), 'require three fresh real sessions')
  assert.ok(runner.includes('progressPairCount:'), 'report count paired ON/OFF')
  assert.ok(runner.includes('probe.observedTransfers === 3'), 'three genuine progress callbacks per session')
  assert.ok(runner.includes('probe.noObserverTransfers === 3'), 'three original fast-path controls per session')
  assert.ok(runner.includes("row.lastReportedBytes === row.bodyBytes"),
    'real received Agent response must equal fully reported bytes')
  assert.ok(runner.includes('result.renderer.decodedImages >= 12'), 'do not bypass decoded-image validation')
  assert.ok(runner.includes('result.renderer.mountedTiles < 1000'), 'do not expand the 100k DOM')
})

test('existing Desktop 100k benchmark remains provider-scoped on both GitHub and GitLab', () => {
  const gh = read('.github/workflows/ci.yml')
  const gl = read('.gitlab-ci.yml')
  assert.match(gh, /gallery-desktop-real-first-paint-100k-performance:/)
  assert.ok(gh.includes("github.head_ref == 'perf/gallery-desktop-media-progress-100k'"))
  assert.ok(gh.includes("XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE:"))
  assert.ok(gh.includes('gallery-desktop-real-cold-runner.cjs'))
  assert.match(gl, /gallery-desktop-real-first-paint-100k-performance:/)
  assert.ok(gl.includes('CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "perf/gallery-desktop-media-progress-100k"'))
  assert.ok(gl.includes('XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE: "1"'))
  assert.ok(gl.includes('gallery-desktop-real-cold-runner.cjs'))
})
