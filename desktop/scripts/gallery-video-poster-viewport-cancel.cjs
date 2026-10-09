'use strict'

const testPath = 'ui/shared/src/mui/MediaGalleryPreviewMedia.tsx'
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '..', '..')
const resultDir = path.resolve(__dirname, '..', 'perf-results')
const mode = process.argv[2] || 'baseline'
const workload = Object.freeze({
  logicalVideoCount: 100_000,
  viewportCandidates: 6,
  posterConcurrency: 3,
  samplesPerMode: 3,
  serverDelayMs: 500,
  observeAfterCancelMs: 160,
  responseBytes: 8192,
})

function source(modeName, sourcePath = testPath) {
  return modeName === 'parent'
    ? execFileSync('git', ['show', 'HEAD^:' + sourcePath], {
        cwd: repoRoot, encoding: 'utf8',
      })
    : fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8')
}

// Extract the real queue implementation, not a copy or synthetic reimplementation.
// The DOM video capture and preview URL loader are intentionally isolated here.
function productionPosterQueue(modeName) {
  const src = source(modeName)
  const start = src.indexOf('const mediaPosterConcurrency = 3')
  const end = src.indexOf('async function captureVideoPoster(', start)
  if (start < 0 || end <= start) {
    throw new Error('Production MediaGallery video poster scheduler was not found')
  }
  const segment = [
    "function revokeIfBlob(url) { if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url) }",
    src.slice(start, end),
    'exports.schedule = scheduleMediaPoster',
    'exports.active = () => mediaPosterActive',
    'exports.queued = () => mediaPosterQueue.length',
  ].join('\n')
  const output = ts.transpileModule(segment, {
    fileName: testPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', output)(module.exports, module, require)
  return module.exports
}

// Load the real persisted-first resolver, unchanged in both paired trees.
function productionVideoResolver(modeName) {
  const name = 'ui/shared/src/mui/MediaGalleryVideoPoster.ts'
  const compiled = ts.transpileModule(source(modeName, name), {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', compiled)(mod.exports, mod, require)
  if (typeof mod.exports.xDriveResolveMediaVideoPoster !== 'function') {
    throw new Error('Persisted-first poster resolver missing in paired source')
  }
  return mod.exports.xDriveResolveMediaVideoPoster
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, timeoutMs, name) {
  const started = performance.now()
  while (!check()) {
    if (performance.now() - started > timeoutMs) throw new Error('Timed out: ' + name)
    await sleep(5)
  }
}

async function sampleOnce(modeName, sample, cacheState) {
  const media = productionPosterQueue(modeName)
  const resolvePoster = productionVideoResolver(modeName)
  const connections = new Set()
  let opened = 0, earlyClosed = 0, completedResponses = 0
  let emittedResponseBytes = 0, signalAccepted = 0, cancelledAt = 0
  const lastCloseLatency = []
  let settledPromises = 0
  let backfillWrites = 0
  let sourcePreviewLoads = 0
  let cachedPosterReads = 0

  const server = http.createServer((_request, res) => {
    opened += 1
    connections.add(res)
    const timer = setTimeout(() => {
      if (res.destroyed) return
      const data = Buffer.alloc(workload.responseBytes, 0x7f)
      emittedResponseBytes += data.length
      completedResponses += 1
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(data.length),
      })
      res.end(data)
    }, workload.serverDelayMs)
    res.on('close', () => {
      clearTimeout(timer)
      connections.delete(res)
      if (!res.writableEnded) {
        earlyClosed++
        if (cancelledAt) lastCloseLatency.push(performance.now() - cancelledAt)
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const base = 'http://127.0.0.1:' + server.address().port
    const mediaNodeIDs = [1, 2, 3, 50_001, 50_002, 99_999]
    const entries = mediaNodeIDs.map((nodeID) => media.schedule((signal) => {
      if (signal) signalAccepted++
      return resolvePoster({
        nodeID,
        revision: 1,
        signal,
        loadCached: async (_id, transportSignal) => {
          cachedPosterReads++
          if (cacheState !== 'warm-cache-get') return null
          const response = await fetch(base + '/poster/' + nodeID,
            transportSignal ? { signal: transportSignal } : {})
          await response.arrayBuffer()
          return 'https://example.invalid/video-poster.jpg'
        },
        capture: async (transportSignal) => {
          sourcePreviewLoads++
          const response = await fetch(base + '/preview/' + nodeID,
            transportSignal ? { signal: transportSignal } : {})
          return new Blob([await response.arrayBuffer()], { type: 'image/jpeg' })
        },
        save: async () => { backfillWrites++ },
      })
    }))
    entries.forEach(({promise}) => {
      void promise.then(() => { settledPromises++ }, () => { settledPromises++ })
    })
    await until(() => opened === workload.posterConcurrency, 5000, 'active poster requests reach Server')
    const queuedBeforeCancel = media.queued()
    const activeBeforeCancel = media.active()
    if (queuedBeforeCancel !== 3 || activeBeforeCancel !== 3) {
      throw new Error('Expected exactly 3 active and 3 queued poster requests')
    }
    cancelledAt = performance.now()
    for(const entry of entries) entry.cancel()
    await sleep(workload.observeAfterCancelMs)
    const checkpoint = {
      activeOnServerAtObservation: connections.size,
      earlyClosedAtObservation: earlyClosed,
      completedAtObservation: completedResponses,
      responseBytesAtObservation: emittedResponseBytes,
      unresolvedSchedulerSlotsAtObservation: media.active(),
      queuedAtObservation: media.queued(),
      settledPromisesAtObservation: settledPromises,
    }

    await Promise.race([
      Promise.all(entries.map(x => x.promise.catch(() => null))),
      sleep(4000).then(() => { throw new Error('Poster promises did not settle') }),
    ])
    await until(() => connections.size === 0, 4000, 'HTTP workers finish or disconnect')
    await until(() => media.active() === 0, 4000, 'poster slots drain')
    return {
      mode: modeName,
      sample,
      cacheState,
      cachedPosterReads,
      sourcePreviewLoads,
      backfillWrites,
      event: sample === workload.samplesPerMode ? 'view-unmount' : 'viewport-scroll',
      logicalVideos: workload.logicalVideoCount,
      requestedTiles: entries.length,
      openedRequests: opened,
      activeBeforeCancel,
      queuedBeforeCancel,
      signalsReceived: signalAccepted,
      ...checkpoint,
      finalEarlyClosed: earlyClosed,
      finalFullResponses: completedResponses,
      finalResponseBytes: emittedResponseBytes,
      finalServerActive: connections.size,
      lastServerAbortMs: lastCloseLatency.length ? Math.max(...lastCloseLatency) : null,
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function run() {
  if (!['baseline','paired'].includes(mode)) {
    throw new Error('Usage: node scripts/gallery-video-poster-viewport-cancel.cjs baseline|paired')
  }
  const results = []
  for (const cacheState of ['warm-cache-get', 'cold-preview-capture']) {
    for(let sample=1;sample<=workload.samplesPerMode;sample++) {
      const order = mode === 'paired'
        ? sample % 2 === 0 ? ['current','parent'] : ['parent','current']
        : ['current']
      for(const candidate of order){
        const result = await sampleOnce(candidate, sample, cacheState)
        results.push(result)
        console.log('GALLERY_VIDEO_CANCEL_SAMPLE ' + JSON.stringify(result))
      }
    }
  }
  const baselineRed = (x) =>
    x.openedRequests === workload.posterConcurrency &&
    x.activeOnServerAtObservation === workload.posterConcurrency &&
    x.earlyClosedAtObservation === 0 &&
    x.finalFullResponses === workload.posterConcurrency &&
    x.queuedAtObservation === 0 &&
    x.settledPromisesAtObservation === workload.viewportCandidates &&
    x.cachedPosterReads === workload.posterConcurrency &&
    (x.cacheState === 'warm-cache-get'
      ? x.sourcePreviewLoads === 0 && x.backfillWrites === 0
      : x.sourcePreviewLoads === workload.posterConcurrency && x.backfillWrites === workload.posterConcurrency)
  const acceptedAfter = (x) =>
    x.openedRequests === workload.posterConcurrency &&
    x.activeOnServerAtObservation === 0 &&
    x.earlyClosedAtObservation === workload.posterConcurrency &&
    x.finalFullResponses === 0 &&
    x.finalResponseBytes === 0 &&
    x.signalsReceived === workload.posterConcurrency &&
    x.unresolvedSchedulerSlotsAtObservation === 0 &&
    x.queuedAtObservation === 0 &&
    x.settledPromisesAtObservation === workload.viewportCandidates &&
    typeof x.lastServerAbortMs === 'number' &&
    x.lastServerAbortMs <= workload.observeAfterCancelMs &&
    x.cachedPosterReads === workload.posterConcurrency &&
    (x.cacheState === 'warm-cache-get'
      ? x.sourcePreviewLoads === 0 && x.backfillWrites === 0
      : x.sourcePreviewLoads === workload.posterConcurrency && x.backfillWrites === 0)
  const old = results.filter(x=> x.mode === 'parent')
  const fresh = results.filter(x=> x.mode === 'current')
  const accepted = mode === 'baseline'
    ? (fresh.length === 6 && fresh.every(baselineRed))
    : (old.length === 6 && old.every(baselineRed) &&
      fresh.length === 6 && fresh.every(acceptedAfter))
  const report = {
    workload,
    mode,
    source: {
      head: execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),
      parent: execFileSync('git',['rev-parse','HEAD^'],{cwd:repoRoot,encoding:'utf8'}).trim(),
    },
    accepted,
    currentAcceptedCount: fresh.filter(acceptedAfter).length,
    originalRedCount: (mode === 'paired' ? old : fresh).filter(baselineRed).length,
    note: 'Production Gallery poster queue PLUS production persisted-first resolver; same Node HTTP fixture separately tests warm cached poster GET and cold capture preview with best-effort cache backfill. 100k logical videos/6 tiles. No real codec, Chromium, Agent IPC, Gin or media generation',
    rows:results,
  }
  fs.mkdirSync(resultDir,{recursive:true})
  const file = path.join(resultDir,'gallery-video-poster-cancel-' + mode + '.json')
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n')
  console.log('GALLERY_VIDEO_CANCEL_REPORT '+file+' accepted='+accepted)
  if(!accepted) process.exitCode=1
}
run().catch(err=>{ console.error(err);process.exitCode=1 })
