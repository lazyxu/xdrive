'use strict'
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const sourceName = 'ui/shared/src/mui/MediaGallery.tsx'
const sampleCount = 3
const concurrentRequests = 6
const serverDelayMs = 500
const observationMs = 160
const bytesPerResponse = 8192

function compileGalleryRangeLoader(send) {
  // Extract the production Gallery hook callback instead of testing a
  // hand-written approximation of how the AbortSignal flows into loading.
  const source = fs.readFileSync(path.join(root, sourceName), 'utf8')
  const first = source.indexOf('const loadVirtualRange = useCallback(async (')
  const close = '}, [loadTargetRange])'
  const end = source.indexOf(close, first)
  if (first < 0 || end < first) {
    throw new Error('production Gallery virtual-range loader not found')
  }
  const extracted = source.slice(first, end + close.length)
  const code = [
    'const useCallback = (callback) => callback',
    "const collectionTargetRef = { current: { requestID: 1, kind: 'all', query: {} } }",
    'const setTimelineGroupSets = () => {}',
    'const mediaTimelineGroupSetsFromRange = () => ({})',
    'const loadTargetRange = async (_target, offset, limit, signal) => {',
    '  await exports.send(signal)',
    '  return { items: [], offset, limit, total_count: 100000 }',
    '}',
    extracted,
    'exports.fetchPage = loadVirtualRange',
  ].join('\n')
  const js = ts.transpileModule(code, {
    fileName: sourceName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: { send } }
  new Function('module', 'exports', 'require', js)(module, module.exports, require)
  if (typeof module.exports.fetchPage !== 'function') {
    throw new Error('Gallery virtual-range transpilation failed')
  }
  return module.exports.fetchPage
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(predicate, timeout, reason) {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('timed out: ' + reason)
    await delay(5)
  }
}

async function measure(sample) {
  const event = sample === 3 ? 'view-unmount' : 'viewport-scroll'
  const active = new Set()
  let opened = 0
  let serverCancelled = 0
  let deliveredBytes = 0
  let signalsReceived = 0
  let settled = 0
  let cancelledAt = 0
  const abortLatencies = []

  const server = http.createServer((_request, response) => {
    opened++
    active.add(response)
    const timeout = setTimeout(() => {
      if (response.destroyed) return
      deliveredBytes += bytesPerResponse
      response.writeHead(200, {
        'Content-Length': String(bytesPerResponse),
        'Content-Type': 'application/octet-stream',
      })
      response.end(Buffer.alloc(bytesPerResponse))
    }, serverDelayMs)
    response.on('close', () => {
      clearTimeout(timeout)
      active.delete(response)
      if (!response.writableEnded) {
        serverCancelled++
        if (cancelledAt) abortLatencies.push(performance.now() - cancelledAt)
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const send = (signal) => {
      if (signal) signalsReceived++
      return fetch('http://127.0.0.1:' + server.address().port + '/media/items?range=true', signal ? { signal } : {})
        .then((response) => response.arrayBuffer())
    }
    const loader = compileGalleryRangeLoader(send)
    const controllers = Array.from({ length: concurrentRequests }, () => new AbortController())
    const pending = controllers.map((controller, i) =>
      loader({ offset: 5000 + i * 200, limit: 200 }, controller.signal))
    for (const promise of pending) {
      void promise.then(() => { settled++ }, () => { settled++ })
    }
    await until(() => opened === concurrentRequests, 5000, 'all six HTTP requests started')
    cancelledAt = performance.now()
    for (const controller of controllers) controller.abort()
    await delay(observationMs)
    const observed = {
      httpStillActiveAt160ms: active.size,
      httpAbortedAt160ms: serverCancelled,
      bytesDeliveredAt160ms: deliveredBytes,
      signalsReceived,
      logicalSettledAt160ms: settled,
    }
    await Promise.race([
      Promise.allSettled(pending),
      delay(3000).then(() => { throw new Error('range promises did not drain') }),
    ])
    await until(() => active.size === 0, 3000, 'HTTP connections did not close')
    return {
      sample,
      event,
      logicalNamespaceItems: 100000,
      opened,
      ...observed,
      finalHttpActive: active.size,
      finalHttpCancelled: serverCancelled,
      finalDeliveredBytes: deliveredBytes,
      lastServerAbortMs: abortLatencies.length ? Math.max(...abortLatencies) : null,
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  const samples = []
  for (let i = 1; i <= sampleCount; i++) {
    const sample = await measure(i)
    samples.push(sample)
    console.log('GALLERY_RANGE_CANCEL_100K_SAMPLE ' + JSON.stringify(sample))
  }
  const errors = []
  for (const sample of samples) {
    if (sample.opened !== concurrentRequests ||
        sample.httpStillActiveAt160ms !== concurrentRequests ||
        sample.httpAbortedAt160ms !== 0 ||
        sample.signalsReceived !== 0 ||
        sample.finalHttpCancelled !== 0 ||
        sample.finalDeliveredBytes !== concurrentRequests * bytesPerResponse) {
      errors.push('expected original unpropagated AbortSignal breach: ' + JSON.stringify(sample))
    }
  }
  const report = {
    status: errors.length === 0 ? 'reproduced-red-baseline' : 'unexpected-result',
    workload: 'production-MediaGallery.loadVirtualRange-100k-logical',
    source: sourceName,
    samples,
    sample_count: sampleCount,
    max_in_flight_requests: concurrentRequests,
    server_delay_ms: serverDelayMs,
    observed_after_ms: observationMs,
    bytes_per_response: bytesPerResponse,
    errors,
    scope: 'production Gallery hook loader extracted/transpiled + real localhost Node HTTP; NOT authenticated Web fetch, Electron Agent IPC, actual Go ctx.Done, full 100k network fanout or browser rendering',
  }
  const file = path.resolve(__dirname, '..', 'perf-results', 'gallery-range-cancel-100k-baseline.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  console.log('GALLERY_RANGE_CANCEL_100K_REPORT ' + JSON.stringify(report))
  if (errors.length) process.exitCode = 1
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
