'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const componentPath = 'ui/shared/src/mui/FileExplorerThumbnail.tsx'
// Full CI uses a shallow checkout. It verifies the actual candidate HTTP
// abort without requiring a historical commit. The dedicated paired benchmark
// explicitly supplies an immutable original SHA and checks out full history.
const frozenBaseSHA = '95ac411a9cf10fdfa6650be669ab381e5d7b5d18'
const baseSHA = process.env.XD_P070_BASE_SHA
if (baseSHA !== undefined) {
  assert.equal(baseSHA, frozenBaseSHA, 'paired original Git SHA must remain frozen')
}
const originalSource = baseSHA
  ? execFileSync('git', ['show', baseSHA + ':' + componentPath],
    { cwd: root, encoding: 'utf8' })
  : null
const candidateSource = fs.readFileSync(path.join(root, componentPath), 'utf8')
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label, timeoutMs = 1500) {
  const start = performance.now()
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw Error('P070 timeout: ' + label)
    await sleep(5)
  }
}

function mountComponent(source) {
  const compiled = ts.transpileModule(source, {
    fileName: componentPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const Box = React.forwardRef(function MockBox({ children }, ref) {
    return React.createElement('div', { ref }, children)
  })
  const Placeholder = () => React.createElement('span', null, 'pending')
  const stub = (name) => {
    if (name === 'react') return React
    if (name === '@mui/material') return { Box }
    if (name === '@mui/icons-material/ErrorOutlineRounded') {
      return { __esModule: true, default: Placeholder }
    }
    if (name === './MediaLoadProgress') return { XDriveMediaLoadingProgress: Placeholder }
    if (name === './LivePhotoSurface') return { XDriveLivePhotoGlyph: Placeholder }
    if (name === './FileExplorerThumbnailVisualState') {
      return { xDriveFileExplorerThumbnailVisualState: () => 'loading' }
    }
    return require(name)
  }
  const module = { exports: {} }
  new Function('exports', 'module', 'require', compiled)(module.exports, module, stub)
  return module.exports
}

async function trial(phase, repetition, source) {
  const requests = []
  let hideAt = null
  const bodySize = 32768
  const delayMs = 650
  const server = http.createServer((_request, response) => {
    const record = {
      startedAt: performance.now(),
      closedAt: null,
      bytes: 0,
      earlyClosed: false,
    }
    requests.push(record)
    const delayed = setTimeout(() => {
      if (response.destroyed) return
      response.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(bodySize),
      })
      response.end(Buffer.alloc(bodySize, repetition))
      record.bytes += bodySize
    }, delayMs)
    response.on('close', () => {
      clearTimeout(delayed)
      record.closedAt = performance.now()
      record.earlyClosed = !response.writableEnded
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const previousDocument = global.document
  const previousWindow = global.window
  const previousObserver = global.IntersectionObserver
  const mockDocument = Object.assign(new EventTarget(), { hidden: false })
  const mockWindow = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  global.document = mockDocument
  global.window = mockWindow
  global.IntersectionObserver = undefined
  let renderer
  const memoryStart = process.memoryUsage().rss
  const cpuStart = process.cpuUsage()
  try {
    const components = mountComponent(source)
    const loadThumbnail = async (item, signal) => {
      const response = await fetch(
        'http://127.0.0.1:' + server.address().port + '/' + item.id,
        { signal },
      )
      if (!response.ok) throw Error('Unexpected benchmark HTTP status')
      await response.arrayBuffer()
      return 'https://p070.invalid/' + item.id + '.jpeg'
    }
    const item = { id: 100000 + repetition, revision: 1, kind: 'file', name: 'test.jpeg' }
    const frame = React.createElement(
      components.XDriveFileExplorerThumbnailProvider,
      { lifecycleKey: 'p070-' + phase + '-' + repetition, loadThumbnail },
      React.createElement(
        components.XDriveFileExplorerThumbnail,
        { item, eligible: true, fallback: React.createElement('span', null, 'JPEG') },
      ),
    )
    await act(async () => {
      renderer = create(frame, { createNodeMock: () => ({}) })
    })
    await until(() => requests.length === 1, phase + ' first genuine HTTP thumbnail')
    hideAt = performance.now()
    await act(async () => {
      mockDocument.hidden = true
      mockDocument.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(delayMs + 180)
    assert.equal(requests.length, 1, 'hidden window must never prefetch more thumbnails')
    const first = { ...requests[0] }
    assert.notEqual(first.closedAt, null, 'slow actual HTTP request must eventually close')
    const durationMs = first.closedAt - hideAt
    let foregroundRetryCount = 0
    if (phase === 'AFTER') {
      await act(async () => {
        mockDocument.hidden = false
        mockDocument.dispatchEvent(new Event('visibilitychange'))
      })
      await until(() => requests.length >= 2, 'foreground thumbnail retry')
      foregroundRetryCount = requests.length - 1
    }
    const result = {
      phase, repetition, durationMs,
      started: 1,
      earlyClosed: first.earlyClosed,
      abandonedBytes: first.bytes,
      foregroundRetryCount,
      cpuMicros: process.cpuUsage(cpuStart),
      rssDeltaBytes: process.memoryUsage().rss - memoryStart,
      sourceSHA256: sha256(source),
    }
    console.log('P070_THUMBNAIL_REAL_HTTP_SAMPLE ' + JSON.stringify(result))
    return result
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (previousDocument === undefined) delete global.document
    else global.document = previousDocument
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
    if (previousObserver === undefined) delete global.IntersectionObserver
    else global.IntersectionObserver = previousObserver
  }
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
// The default all-tests job also runs a real network regression instead of
// requiring a benchmark-only fixture or silently skipping this component.
if (!baseSHA) {
  test('P070 default CI: mounted hidden-window thumbnail closes real HTTP transport', async () => {
    const result = await trial('AFTER', 1, candidateSource)
    assert.equal(result.started, 1)
    assert.equal(result.earlyClosed, true)
    assert.equal(result.abandonedBytes, 0)
    assert.equal(result.foregroundRetryCount, 1)
    assert.ok(result.durationMs >= 0 && result.durationMs <= 160,
      'visibility cancellation must meet the unchanged 160ms budget')
  })
} else {
test('P070 matched n3 actual HTTP transport abort on hidden mounted FileExplorer thumbnails', async () => {
  const original = []
  const candidate = []
  const order = [
    ['BEFORE', 'AFTER'],
    ['AFTER', 'BEFORE'],
    ['BEFORE', 'AFTER'],
  ]
  for (let i = 0; i < order.length; i++) {
    for (const phase of order[i]) {
      const result = await trial(phase, i + 1,
        phase === 'BEFORE' ? originalSource : candidateSource)
      ;(phase === 'BEFORE' ? original : candidate).push(result)
    }
  }
  assert.equal(original.length, 3)
  assert.equal(candidate.length, 3)
  const beforeP50 = median(original.map(row => row.durationMs))
  const afterP50 = median(candidate.map(row => row.durationMs))
  const summary = {
    frozenBase: baseSHA,
    candidateGitHead: execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: root, encoding: 'utf8' }).trim(),
    testKind: 'same-runner matched real HTTP thumbnail hidden-window transport',
    representsTruePhysical100kGoFixture: false,
    samplesPerArm: 3,
    original,
    candidate,
    beforeP50Ms: beforeP50,
    afterP50Ms: afterP50,
    relativeCancellationReduction: 1 - afterP50 / beforeP50,
    originalAbandonedBytes: original.reduce((a, row) => a + row.abandonedBytes, 0),
    candidateAbandonedBytes: candidate.reduce((a, row) => a + row.abandonedBytes, 0),
    passed: original.every(row => !row.earlyClosed && row.abandonedBytes === 32768) &&
      candidate.every(row =>
        row.earlyClosed && row.abandonedBytes === 0 &&
        row.durationMs >= 0 && row.durationMs <= 160 &&
        row.foregroundRetryCount === 1) &&
      beforeP50 >= 450 && afterP50 < beforeP50 * 0.5,
  }
  const dir = process.env.XD_P070_RESULT_DIR ||
    path.join(root, 'desktop/p070-background-thumbnail-results')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log('P070_THUMBNAIL_MATCHED_SUMMARY ' + JSON.stringify(summary))
  assert.equal(summary.passed, true,
    'retain candidate only if all 3 original vs candidate samples show prompt transport close, zero abandoned bytes and foreground retry')
})
}
