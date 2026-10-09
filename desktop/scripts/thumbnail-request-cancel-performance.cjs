'use strict'
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '..', '..')
const resultsDir = path.resolve(__dirname, '..', 'perf-results')
const MODE = process.argv[2] || 'current'
const workload = Object.freeze({
  requests: 6,
  samples: 3,
  serverDelayMs: 500,
  observationMs: 160,
})

function loadSource(name, mode) {
  if (mode === 'parent') {
    return execFileSync('git', ['show', 'HEAD^:' + name], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
  }
  return fs.readFileSync(path.join(repoRoot, name), 'utf8')
}

function transpile(source, filename) {
  const js = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
  return mod.exports
}

function galleryScheduler(mode) {
  const name = 'ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts'
  return transpile(loadSource(name, mode), name).XDriveMediaThumbnailScheduler
}

function fileExplorerScheduler(mode) {
  const name = 'ui/shared/src/mui/FileExplorerThumbnail.tsx'
  const full = loadSource(name, mode)
  const begin = full.indexOf('function pumpFileThumbnailQueue()')
  const end = full.indexOf('function fileThumbnailNow()', begin)
  if (begin < 0 || end < 0) throw new Error('FileExplorer scheduled worker functions not located')
  const limit = /const fileThumbnailConcurrency = \d+/.exec(full)
  if (!limit) throw new Error('production thumbnail concurrency missing')
  const code = [
    limit[0],
    'let fileThumbnailActive = 0',
    'const fileThumbnailQueue = []',
    'function revokeFileThumbnailSource(_) {}',
    full.slice(begin, end),
    'exports.schedule = scheduleFileThumbnail',
    'exports.active = () => fileThumbnailActive',
    'exports.queued = () => fileThumbnailQueue.length',
  ].join('\n')
  return transpile(code, name)
}


function cloudVirtualRange(mode, load) {
  const name = 'ui/shared/src/mui/CloudFilesController.ts'
  const full = loadSource(name, mode)
  const begin = full.indexOf('const loadVirtualRange = useCallback(async (')
  const tail = '}, [port, virtualTarget])'
  const end = full.indexOf(tail, begin)
  if (begin < 0 || end < 0) throw new Error('real CloudFilesController range loader not found')
  const inner = full.slice(begin, end + tail.length)
  const code = [
    'const useCallback = (value) => value',
    "const virtualTarget = { parentID: 1, sort: { key: 'name', direction: 'asc' }, grouping: {}, requestID: 1 }",
    'const port = { getRange: async (...args) => { await exports.load(args[6]); return {items:[],offset:args[1],limit:args[2],total_count:100000,total_count_included:true}} }',
    inner,
    'exports.fetchPage = loadVirtualRange',
  ].join('\n')
  const mod = transpile(code, name)
  mod.load = load
  return mod.fetchPage
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(check, maxMs, reason) {
  const began = performance.now()
  while (!check()) {
    if (performance.now() - began > maxMs) throw new Error('Timed out: ' + reason)
    await delay(5)
  }
}

async function runSample(mode, surface, sample) {
  const event = sample === 3 ? 'view-unmount' : 'viewport-scroll'
  const requests = new Set()
  let openCount = 0
  let closedCount = 0
  let cancelledOnServer = 0
  let responseBytes = 0
  let cancelStartedAt = 0
  const closeLatenciesMs = []

  const server = http.createServer((_req, res) => {
    openCount++
    requests.add(res)
    const timer = setTimeout(() => {
      if (res.destroyed) return
      const bytes = Buffer.alloc(8192, 0x77)
      responseBytes += bytes.length
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) })
      res.end(bytes)
    }, workload.serverDelayMs)
    res.on('close', () => {
      clearTimeout(timer)
      requests.delete(res)
      closedCount++
      if (!res.writableEnded) {
        cancelledOnServer++
        if (cancelStartedAt > 0) closeLatenciesMs.push(performance.now() - cancelStartedAt)
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  let scheduler = null
  let startedSignals = 0
  let logicalSettled = 0
  const port = server.address().port
  const load = (nodeID, signal) => {
    if (signal) startedSignals++
    const options = signal ? { signal } : {}
    return fetch('http://127.0.0.1:' + port + '/' + nodeID, options)
      .then((response) => response.arrayBuffer())
      .then(() => null)
  }

  try {
    let promises
    let cancel
    if (surface === 'virtual-range') {
      const range = cloudVirtualRange(mode, (signal) => load(1, signal))
      const controllers = Array.from({length:workload.requests}, () => new AbortController())
      promises = controllers.map((controller, i) => range({offset:i*200,limit:200},controller.signal))
      cancel = () => controllers.forEach((controller) => controller.abort())
    } else if (surface === 'gallery') {
      const Scheduler = galleryScheduler(mode)
      scheduler = new Scheduler(load, { concurrency: workload.requests, revokeURL: () => {} })
      promises = Array.from({ length: workload.requests }, (_, i) => scheduler.load(i + 1, 0))
      cancel = () => event === 'view-unmount' ? scheduler.dispose() : scheduler.setRetention([])
    } else {
      const file = fileExplorerScheduler(mode)
      scheduler = file
      const tasks = Array.from({ length: workload.requests }, (_, i) =>
        file.schedule((signal) => load(i + 1, signal))
      )
      promises = tasks.map((task) => task.promise)
      cancel = () => tasks.forEach((task) => task.cancel())
    }
    promises.forEach((promise) => {
      void promise.then(() => { logicalSettled++ }, () => { logicalSettled++ })
    })
    await waitUntil(() => openCount === workload.requests, 5_000, 'all requests must reach HTTP server')
    cancelStartedAt = performance.now()
    cancel()
    await delay(workload.observationMs)
    const atWindow = {
      logicalSettled,
      httpStillActive: requests.size,
      httpCancelled: cancelledOnServer,
      httpCompletedBytes: responseBytes,
      signalsReceived: startedSignals,
      ...(surface === 'file-explorer'
        ? { schedulerStillActive: scheduler.active(), schedulerQueued: scheduler.queued() }
        : {}),
    }
    await Promise.race([
      Promise.all(promises.map((p) => p.catch(() => null))),
      delay(3_000).then(() => { throw new Error('thumbnail promise drain timeout') }),
    ])
    await waitUntil(() => requests.size === 0, 3_000, 'HTTP response or disconnect did not finish')
    if (surface === 'gallery') scheduler.dispose()
    if (surface === 'file-explorer' && scheduler.active() !== 0) {
      await waitUntil(() => scheduler.active() === 0, 1000, 'FileExplorer scheduler slot did not drain')
    }
    return {
      mode, surface, sample, event, openedRequests: openCount,
      cancellationDeliveredAtMs: closeLatenciesMs.length
        ? Math.max(...closeLatenciesMs) : null,
      ...atWindow,
      totalCancelledRequests: cancelledOnServer,
      totalFinishedResponses: openCount - cancelledOnServer,
      finalHTTPActive: requests.size,
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  if (!['current', 'parent', 'paired'].includes(MODE)) {
    throw new Error('Usage: node thumbnail-request-cancel-performance.cjs [current|parent|paired]')
  }
  const results = []
  for (let sample = 1; sample <= workload.samples; sample++) {
    const modes = MODE === 'paired' ? (sample % 2 ? ['parent', 'current'] : ['current', 'parent']) : [MODE]
    for (const mode of modes) {
      for (const surface of ['gallery', 'file-explorer', 'virtual-range']) {
        const item = await runSample(mode, surface, sample)
        results.push(item)
        console.log('THUMBNAIL_CANCEL_REQUEST_SAMPLE ' + JSON.stringify(item))
      }
    }
  }
  const paired = MODE === 'paired'
  const expected = workload.samples * 3 // three separately instrumented request paths
  const current = results.filter((x) => x.mode === 'current')
  const parent = results.filter((x) => x.mode === 'parent')
  const errors = []
  const currentPass = (x) => (
    x.openedRequests === workload.requests &&
    x.httpStillActive === 0 &&
    x.httpCancelled === workload.requests &&
    x.httpCompletedBytes === 0 &&
    x.signalsReceived === workload.requests &&
    x.totalCancelledRequests === workload.requests &&
    x.totalFinishedResponses === 0 &&
    x.finalHTTPActive === 0 &&
    typeof x.cancellationDeliveredAtMs === 'number' &&
    x.cancellationDeliveredAtMs <= workload.observationMs &&
    (x.surface !== 'file-explorer' || x.schedulerStillActive === 0)
  )
  const parentRed = (x) => (
    x.openedRequests === workload.requests &&
    x.httpStillActive === workload.requests &&
    x.httpCancelled === 0 &&
    x.signalsReceived === 0 &&
    x.totalFinishedResponses === workload.requests
  )
  if (paired) {
    if (current.length !== expected || parent.length !== expected) {
      errors.push('unexpected paired sample cardinality')
    }
    for (const x of current) {
      if (!currentPass(x)) errors.push('failed cancellation: ' + JSON.stringify(x))
    }
    for (const x of parent) {
      if (!parentRed(x)) errors.push('before sample no longer matches frozen workload: ' + JSON.stringify(x))
    }
  }
  const provenance = paired ? {
    before: execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    after: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  } : null
  const report = {
    workload, mode: MODE,
    provenance,
    acceptance: paired ? {
      passed: errors.length === 0,
      currentPassed: current.filter(currentPass).length,
      parentFailedAsBaseline: parent.filter(parentRed).length,
      requiredPerSide: expected,
      errors,
    } : null,
    result: results,
    note: 'Production scheduler/controller source; real Node loopback HTTP transport abort. Native Electron/Agent/Go context are separately tested and not implied by this report.',
  }
  fs.mkdirSync(resultsDir, { recursive: true })
  const out = path.join(resultsDir, 'thumbnail-request-cancel-' + MODE + '.json')
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
  console.log('THUMBNAIL_CANCEL_REQUEST_REPORT ' + out)
  if (errors.length) {
    for (const error of errors) console.error('THUMBNAIL_CANCEL_REGRESSION ' + error)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
