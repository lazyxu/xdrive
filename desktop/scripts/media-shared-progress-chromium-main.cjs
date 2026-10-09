'use strict'
// Branch-scoped actual Chromium transport A/B: production response reader vs
// native Response.blob() on the same HTTP workload. No UI or backend mocks
// are substituted for the two collector implementations.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')
const { app, BrowserWindow } = require('electron')

const SIZE = 16 * 1024 * 1024
const CHUNK = 64 * 1024
const WARMUPS = 2
const SAMPLES = 5
const MODES = ['native', 'observed', 'bridge', 'direct']
const out = path.join(__dirname, '..', 'media-progress-results')
const sourcePath = path.resolve(__dirname, '../../web/src/mediaBinaryProgress.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
if (!source.includes('export async function xDriveMediaResponseBlob') ||
    !source.includes('new TransformStream') ||
    !source.includes('response.body.pipeThrough') ||
    !source.includes('await response.blob()')) {
  throw new Error('Must exercise the actual checked-in Web media response reader, including its unobserved native fast path.')
}
const alternativeCollectorsJS = "async function collectViaReadableBridge(response, onProgress) {\n  const reader = response.body.getReader()\n  const total = Number(response.headers.get('Content-Length'))\n  let loaded = 0, emittedAt = 0\n  const stream = new ReadableStream({\n    async pull(controller) {\n      const { done, value } = await reader.read()\n      if (done) { controller.close(); return }\n      loaded += value.byteLength\n      const now = performance.now()\n      if (now - emittedAt >= 100) { emittedAt = now; onProgress(loaded, total) }\n      controller.enqueue(value)\n    },\n    cancel(reason) { return reader.cancel(reason) },\n  }, { highWaterMark: 1 })\n  const blob = await new Response(stream, {\n    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' },\n  }).blob()\n  onProgress(loaded, total)\n  return blob\n}\nasync function collectViaDirectChunks(response, onProgress) {\n  const total = Number(response.headers.get('Content-Length'))\n  const reader = response.body.getReader()\n  const chunks = []\n  let loaded = 0, emittedAt = 0\n  for (;;) {\n    const { done, value } = await reader.read()\n    if (done) break\n    chunks.push(value)\n    loaded += value.byteLength\n    const now = performance.now()\n    if (now - emittedAt >= 100) { emittedAt = now; onProgress(loaded, total) }\n  }\n  const blob = new Blob(chunks, {\n    type: response.headers.get('Content-Type') || 'application/octet-stream',\n  })\n  onProgress(loaded, total)\n  reader.releaseLock()\n  return blob\n}"
const helperJS = ts.transpileModule(source.replace(/^export /gm, ''), {
  fileName: sourcePath,
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText
const chunk = Buffer.alloc(CHUNK)
for (let i = 0; i < CHUNK; i++) chunk[i] = i % 251
const serverLog = { requests: 0, completed: 0, bytes: 0, prematurelyClosed: 0 }
const server = http.createServer((request, response) => {
  const target = new URL(request.url, 'http://localhost')
  if (target.pathname === '/page') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('<!DOCTYPE html><html><body><p>Media progress transport benchmark</p></body></html>')
    return
  }
  if (target.pathname !== '/media') {
    response.writeHead(404); response.end('Not found'); return
  }
  serverLog.requests++
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(SIZE),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  let remaining = SIZE
  let closed = false
  response.on('close', () => {
    if (!response.writableEnded && !closed) {
      serverLog.prematurelyClosed++
      closed = true
    }
  })
  function pump() {
    while (remaining > 0 && !response.destroyed) {
      const size = Math.min(remaining, CHUNK)
      remaining -= size
      serverLog.bytes += size
      if (!response.write(size === CHUNK ? chunk : chunk.subarray(0, size))) {
        response.once('drain', pump)
        return
      }
    }
    if (!response.destroyed && remaining === 0) {
      serverLog.completed++
      response.end()
    }
  }
  pump()
})
function kernelMetrics(pid) {
  if (process.platform !== 'linux' || !(pid > 0)) return null
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8')
    const rss = Number(status.match(/^VmRSS:\s*(\d+) kB/m)?.[1] || 0)
    const body = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
    const fields = body.slice(body.lastIndexOf(') ') + 2).split(' ')
    return { rssKiB: rss, cpuTicks: Number(fields[11]) + Number(fields[12]) }
  } catch { return null }
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('enable-precise-memory-info')

async function run() {
  fs.mkdirSync(out, { recursive: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const window = new BrowserWindow({
    width: 960, height: 600, show: true,
    webPreferences: {
      sandbox: false, nodeIntegration: false, contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  const rows = []
  try {
    await window.loadURL(base + '/page')
    const pid = window.webContents.getOSProcessId()
    for (let round = -WARMUPS; round < SAMPLES; round++) {
      const shift = (round + WARMUPS) % MODES.length
      const modes = [...MODES.slice(shift), ...MODES.slice(0, shift)]
      for (const mode of modes) {
        const fixtureID = rows.length + '-' + round + '-' + mode
        const program = [
          '(async () => {',
          helperJS,
          alternativeCollectorsJS,
          'const mode = ' + JSON.stringify(mode) + ';',
          'const beforeFetch = performance.now();',
          'const response = await fetch(' + JSON.stringify(base + '/media?id=' + fixtureID) + ', { cache: "no-store" });',
          'if (!response.ok) throw Error("HTTP " + response.status);',
          'const afterHeaders = performance.now();',
          'let reports = 0, lastReceived = -1, lastTotal;',
          'const onReport = (loaded, total) => { reports++; lastReceived = loaded; lastTotal = total };',
          'const resource = mode === "native" ? await response.blob()',
          '  : mode === "observed" ? await xDriveMediaResponseBlob(response, undefined, onReport)',
          '  : mode === "bridge" ? await collectViaReadableBridge(response, onReport)',
          '  : await collectViaDirectChunks(response, onReport);',
          'const afterBlob = performance.now();',
          'const firstByte = new Uint8Array(await resource.slice(0, 1).arrayBuffer())[0];',
          'return { mode, resourceBytes: resource.size, firstByte, reports, lastReceived, lastTotal,',
          ' fetchHeadersMs: afterHeaders - beforeFetch, collectorMs: afterBlob - afterHeaders,',
          ' totalHttpMs: afterBlob - beforeFetch, heapAtEnd: performance.memory?.usedJSHeapSize ?? null };',
          '})()',
        ].join('\n')
        const before = kernelMetrics(pid)
        let peakRss = before?.rssKiB ?? 0
        const timer = setInterval(() => {
          const cur = kernelMetrics(pid)
          peakRss = Math.max(peakRss, cur?.rssKiB ?? 0)
        }, 5)
        let row
        try { row = await window.webContents.executeJavaScript(program, true) }
        finally { clearInterval(timer) }
        const after = kernelMetrics(pid)
        if (row.resourceBytes !== SIZE || row.firstByte !== 0) {
          throw new Error('HTTP body integrity mismatch: ' + JSON.stringify(row))
        }
        if (mode !== 'native' && (row.reports < 1 || row.lastReceived !== SIZE || row.lastTotal !== SIZE)) {
          throw new Error('Observed progress dropped a byte or denominator: ' + JSON.stringify(row))
        }
        if (mode === 'native' && row.reports !== 0) {
          throw new Error('Native fast path must have no progress callback')
        }
        if (round >= 0) rows.push({
          round, ...row, pid,
          cpuTicksDelta: before && after ? after.cpuTicks - before.cpuTicks : null,
          rssBeforeKiB: before?.rssKiB ?? null,
          rssAfterKiB: after?.rssKiB ?? null,
          maxSampledRssKiB: peakRss || null,
        })
        await new Promise(resolve => setTimeout(resolve, 40))
      }
    }
    if (serverLog.requests !== (SAMPLES + WARMUPS) * MODES.length ||
        serverLog.completed !== serverLog.requests || serverLog.prematurelyClosed !== 0 ||
        serverLog.bytes !== serverLog.requests * SIZE) {
      throw new Error('HTTP workload was not identical and fully transferred: ' + JSON.stringify(serverLog))
    }
    const summary = Object.fromEntries(MODES.map(mode => {
      const subset = rows.filter(row => row.mode === mode)
      return [mode, {
        n: subset.length,
        medianCollectorMs: median(subset.map(row => row.collectorMs)),
        medianTotalHttpMs: median(subset.map(row => row.totalHttpMs)),
        medianCpuTicks: subset.every(row => row.cpuTicksDelta !== null)
          ? median(subset.map(row => row.cpuTicksDelta)) : null,
        medianSampledRssGrowthKiB: subset.every(row => row.maxSampledRssKiB !== null)
          ? median(subset.map(row => row.maxSampledRssKiB - row.rssBeforeKiB)) : null,
      }]
    }))
    const result = {
      status: 'diagnostic only; no release gate based on a small n',
      source: 'actual web/src/mediaBinaryProgress.ts transpiled into Chromium Electron renderer',
      environment: {
        engine: process.versions.chrome, electron: process.versions.electron,
        platform: process.platform, fixtureSize: SIZE, chunkSize: CHUNK,
        samplesPerMode: SAMPLES, warmupsPerMode: WARMUPS, modes: MODES,
        memoryMethod: '5ms sampled renderer /proc/PID VmRSS, NOT exact peak; CPU in scheduler ticks',
      },
      serverLog, summary, rows,
      limitations: [
        'Loopback HTTP, not authenticated Gin/PostgreSQL/CAS or Desktop Agent IPC',
        'Binary transport only, not a decoded image/paint benchmark',
        'Bridge and TransformStream modes are prototype alternatives, not shipped source code',
        'Renderer process resident memory is a high-noise shared allocation snapshot',
        'Does not establish 100k Gallery scrolling, Live Photo/video codecs or physical iOS',
      ],
    }
    const file = path.join(out, 'chromium-http-media-progress.json')
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n')
    console.log('MEDIA_PROGRESS_CHROMIUM ' + JSON.stringify(result.summary))
    console.log('Artifact: ' + file)
    // This branch-scoped stress gate protects the documented sampled-memory
    // budget; CPU and wall time stay diagnostic until first-decode A/B exists.
    const additionalKiB = summary.observed.medianSampledRssGrowthKiB -
      summary.native.medianSampledRssGrowthKiB
    if (Number.isFinite(additionalKiB) && additionalKiB > 32 * 1024) {
      throw new Error('Observed media collector exceeded the frozen additional sampled RSS budget: ' + additionalKiB + ' KiB')
    }
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
app.whenReady().then(run).then(() => app.quit(), error => {
  console.error(error)
  server.closeAllConnections()
  server.close()
  app.exit(1)
})
