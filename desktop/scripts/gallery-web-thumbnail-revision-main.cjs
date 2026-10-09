'use strict'

// P1 test-first native Chromium cache/overwritten-source probe. It executes
// the actual (TypeScript-transpiled) Web ApiClient.mediaThumbnail method.
// The HTTP response deliberately remains fresh for 3600s while its source
// revision changes; no production code is patched by this script.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const outDir = path.resolve(__dirname, '../perf-results')
fs.mkdirSync(outDir, { recursive: true })
const records = new Map()
const stamp = (id) => {
  if (!records.has(id)) records.set(id, { revision: 3, requests: 0, requestedURLs: [] })
  return records.get(id)
}
const server = http.createServer((req, response) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/page') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    response.end('<!DOCTYPE html><html><body>native cache trial</body></html>')
    return
  }
  if (url.pathname === '/advance') {
    const id = Number(url.searchParams.get('node'))
    const revision = Number(url.searchParams.get('revision'))
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(revision)) {
      response.writeHead(400); response.end(); return
    }
    stamp(id).revision = revision
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  const match = /^\/api\/v1\/media\/items\/(\d+)\/thumbnail$/.exec(url.pathname)
  if (!match) { response.writeHead(404); response.end(); return }
  const id = Number(match[1])
  const row = stamp(id)
  row.requests++
  row.requestedURLs.push(url.pathname + url.search)
  const etag = '"test-thumbnail-' + id + '-' + row.revision + '"'
  const headers = {
    'Cache-Control': 'private, max-age=3600',
    'ETag': etag,
    'Content-Type': 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
  }
  if (req.headers['if-none-match'] === etag) {
    response.writeHead(304, headers)
    response.end()
  } else {
    response.writeHead(200, headers)
    response.end('thumbnail-' + id + '-revision-' + row.revision)
  }
})

function compiledRealWebMethod() {
  const name = path.resolve(__dirname, '../../web/src/api.ts')
  const full = fs.readFileSync(name, 'utf8')
  const start = full.indexOf('  async mediaThumbnail(')
  const end = full.indexOf('\n  /**', start)
  if (start < 0 || end < 0 || end - start > 4000) {
    throw new Error('Web API thumbnail method no longer has the expected source boundary')
  }
  const actualMethod = full.slice(start, end)
  if (!actualMethod.includes('fetch(') || !actualMethod.includes('return response.blob()')) {
    throw new Error('Native trial must exercise actual Web API fetch and Blob conversion')
  }
  return ts.transpileModule([
    'class ActualWebThumbnailClient {',
    "  session = { accessToken: '', refreshToken: '' }",
    '  async ensureFresh(_signal?: AbortSignal): Promise<void> {}',
    '  async refresh(_force?: boolean, _signal?: AbortSignal): Promise<void> {}',
    actualMethod,
    '}',
  ].join('\n'), {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function run() {
  const methodJS = compiledRealWebMethod()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const window = new BrowserWindow({
    width: 800, height: 600, show: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      sandbox: false, backgroundThrottling: false,
    },
  })
  const rows = []
  try {
    await window.loadURL(base + '/page')
    const setup = [
      'const API_BASE = ' + JSON.stringify(base) + ';',
      'class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }',
      methodJS,
      'const client = new ActualWebThumbnailClient();',
    ].join('\n')
    for (const mode of ['known-revision', 'unknown-revision']) {
      for (let sample = 1; sample <= 3; sample++) {
        const nodeID = (mode === 'known-revision' ? 417 : 517) + sample
        const start = performance.now()
        const program = [
          '(async () => {',
          setup,
          'const id = ' + nodeID + ';',
          'const known = ' + JSON.stringify(mode === 'known-revision') + ';',
          'const first = await (await client.mediaThumbnail(id, undefined, known ? 3 : undefined)).text();',
          'const warm = await (await client.mediaThumbnail(id, undefined, known ? 3 : undefined)).text();',
          'await fetch(' + JSON.stringify(base + '/advance?node=' + nodeID + '&revision=4') + ', { cache: "no-store" });',
          'const changed = await (await client.mediaThumbnail(id, undefined, known ? 4 : undefined)).text();',
          'return { first, warm, changed };',
          '})()',
        ].join('\n')
        const out = await window.webContents.executeJavaScript(program, true)
        const row = { mode, sample, nodeID, ...out,
          httpRequests: stamp(nodeID).requests,
          requestURLs: [...stamp(nodeID).requestedURLs],
          elapsedMsDiagnostic: performance.now() - start,
        }
        rows.push(row)
        console.log('GALLERY_WEB_THUMB_CACHE_SAMPLE ' + JSON.stringify(row))
      }
    }
    const verdict = {
      threeRunsEach: rows.length === 6,
      initialAndWarmIdentity: rows.every(row =>
        row.first === 'thumbnail-' + row.nodeID + '-revision-3' && row.warm === row.first),
      updatedRevisionNeverStale: rows.every(row =>
        row.changed === 'thumbnail-' + row.nodeID + '-revision-4'),
      upstreamRequestOccursAfterOverwrite: rows.every(row => row.httpRequests >= 2),
      knownRevisionStillWarm: rows.filter(row => row.mode === 'known-revision')
        .every(row => row.httpRequests === 2),
    }
    const report = {
      status: 'Test-first actual Web thumbnail API in Chromium HTTP cache',
      source: 'web/src/api.ts:ApiClient.mediaThumbnail, transpiled without rewriting the method',
      fixture: { sourceRevisionBefore: 3, sourceRevisionAfter: 4,
        cacheControl: 'private, max-age=3600', etag: 'revision dependent',
        sampledNodes: 6, samplesPerMode: 3 },
      rows, verdict,
      decision: Object.values(verdict).every(Boolean)
        ? 'All source freshness gates met'
        : 'WEB THUMBNAIL REVISION CACHE BREACH: old Server bytes survive overwrite',
      limitations: [
        'Actual Electron/Chromium HTTP cache and Web API source, not a deployed xDrive Go/Gin route',
        'No authenticated user/session or production upload was performed',
        'Elapsed times are diagnostic only; no wall-clock speedup is claimed',
      ],
    }
    fs.writeFileSync(path.join(outDir, 'gallery-web-thumbnail-revision.json'),
      JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_WEB_THUMB_CACHE_REPORT ' + JSON.stringify({
      verdict, decision: report.decision, count: rows.length,
    }))
    if (!Object.values(verdict).every(Boolean)) throw new Error(report.decision)
  } finally {
    window.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

app.whenReady().then(async () => {
  try { await run(); app.exit(0) }
  catch (err) { console.error(err); app.exit(1) }
})
