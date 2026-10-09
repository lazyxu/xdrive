const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { app, BrowserWindow } = require('electron')

const scenarios = new Set(['upload', 'download', 'download-discard'])
const scenario = process.argv.find((value) => scenarios.has(value))
const sample = process.argv.find((value) => /^sample-\d+$/.test(value)) || 'sample-unknown'
if (!scenario) {
  console.error('Usage: electron scripts/large-transfer-performance-main.cjs <upload|download|download-discard> sample-N [--size-gib=1|4]')
  process.exit(2)
}

const sizeArgument = process.argv.find((value) => value.startsWith('--size-gib'))
const sizeGiB = sizeArgument === undefined ? 1 : Number(sizeArgument.slice('--size-gib='.length))
if (sizeArgument !== undefined && !/^--size-gib=(1|4)$/.test(sizeArgument)) {
  console.error('large-transfer size must be --size-gib=1 or --size-gib=4')
  process.exit(2)
}
const sizeBytes = sizeGiB * 2 ** 30
const chunkSize = 8 * 1024 * 1024
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const webRoot = path.join(repoRoot, 'web', 'dist')
const resultsDir = path.join(desktopRoot, 'large-transfer-perf-results')
const metricsPath = path.join(resultsDir, `web-${scenario}-${sample}${sizeGiB === 1 ? '' : '-4gib'}.json`)
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-large-transfer-'))
const uploadFixture = path.join(userData, `upload-${sample}.bin`)
if (scenario === 'upload') {
  const fd = fs.openSync(uploadFixture, 'w')
  try {
    fs.ftruncateSync(fd, sizeBytes)
  } finally {
    fs.closeSync(fd)
  }
}
app.setPath('userData', userData)

fs.mkdirSync(resultsDir, { recursive: true })
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('enable-precise-memory-info')
app.commandLine.appendSwitch('no-sandbox')

const serverStats = {
  uploadBytes: 0,
  uploadChunks: 0,
  uploadInitSize: 0,
  downloadBytes: 0,
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
  })
  res.end(body)
}

async function readJSON(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function streamZeros(res, total) {
  const block = Buffer.alloc(1024 * 1024)
  let remaining = total
  while (remaining > 0) {
    const length = Math.min(block.length, remaining)
    if (!res.write(length === block.length ? block : block.subarray(0, length))) {
      await once(res, 'drain')
    }
    serverStats.downloadBytes += length
    remaining -= length
  }
  res.end()
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname

  if (req.method === 'POST' && pathname === '/api/v1/uploads') {
    const init = await readJSON(req)
    serverStats.uploadInitSize = Number(init.size || 0)
    json(res, 201, {
      id: 'perf-upload',
      parent_id: init.parent_id,
      name: init.name,
      size: init.size,
      chunk_size: init.chunk_size,
      chunk_count: Math.ceil(Number(init.size || 0) / Number(init.chunk_size || chunkSize)),
      status: 'active',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      received_chunks: [],
    })
    return
  }

  if (req.method === 'PUT' && /^\/api\/v1\/uploads\/perf-upload\/chunks\/\d+$/.test(pathname)) {
    let bytes = 0
    for await (const chunk of req) bytes += chunk.length
    serverStats.uploadBytes += bytes
    serverStats.uploadChunks += 1
    json(res, 201, { ok: true })
    return
  }

  if (req.method === 'POST' && pathname === '/api/v1/uploads/perf-upload/finalize') {
    json(res, 200, {
      id: 'perf-upload',
      status: 'finalized',
      size: sizeBytes,
      chunk_size: chunkSize,
      chunk_count: sizeBytes / chunkSize,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      received_chunks: [],
      result: {
        id: 99,
        parent_id: 1,
        name: 'large-upload.bin',
        type: 'file',
        size: sizeBytes,
        revision: 1,
      },
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/v1/files/99/content') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
    })
    await streamZeros(res, sizeBytes)
    return
  }

  let relative = decodeURIComponent(pathname)
  if (relative === '/' || relative === '') relative = '/index.html'
  const candidate = path.resolve(webRoot, '.' + relative)
  if (candidate !== webRoot && !candidate.startsWith(webRoot + path.sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let stat
  try {
    stat = fs.statSync(candidate)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': mime[path.extname(candidate)] || 'application/octet-stream',
    'Content-Length': String(stat.size),
  })
  fs.createReadStream(candidate).pipe(res)
}

const server = http.createServer((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch((error) => {
    console.error(error)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

async function rendererWorkingSetKB() {
  const metrics = app.getAppMetrics()
  const renderer = metrics.find((metric) => metric.type === 'Tab')
    || metrics.find((metric) => metric.type === 'Renderer')
  return renderer?.memory?.workingSetSize ?? null
}

async function waitForSelector(win, selector, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await win.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      true,
    )
    if (found) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for renderer selector: ' + selector)
}

async function waitForResult(win) {
  const deadline = Date.now() + 5 * 60_000
  let workingSetStartKB = null
  let workingSetPeakKB = null
  let started = false
  let lastState = null
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript(
      `({
        result: window.__xdriveLargeTransferPerfResult || null,
        error: window.__xdriveLargeTransferPerfError || null,
        boot: window.__xdriveLargeTransferPerfBoot ?? null,
        bootError: window.__xdriveLargeTransferPerfBootError || null,
        running: Boolean(window.__xdriveLargeTransferPerfRunning),
        ready: Boolean(window.__xdriveLargeTransferPerfReady),
        href: location.href,
      })`,
      true,
    )
    lastState = state
    if (state.bootError) throw new Error(state.bootError)
    if (state.error) throw new Error(state.error)
    if (state.ready && !started) {
      const workingSet = await rendererWorkingSetKB()
      if (workingSet === null || workingSet <= 0) {
        throw new Error('renderer working-set memory metrics are unavailable')
      }
      workingSetStartKB = workingSet
      workingSetPeakKB = workingSet
      await win.webContents.executeJavaScript('window.__xdriveLargeTransferPerfStart = true', true)
      started = true
    }
    if (state.running) {
      const workingSet = await rendererWorkingSetKB()
      if (!started) throw new Error('renderer started before the launcher sampled its memory baseline')
      if (workingSet === null || workingSet <= 0) throw new Error('renderer working-set memory metrics are unavailable')
      workingSetPeakKB = Math.max(workingSetPeakKB, workingSet)
    }
    if (state.result) {
      const workingSet = await rendererWorkingSetKB()
      if (!started) throw new Error('renderer finished before the launcher sampled its memory baseline')
      if (workingSet === null || workingSet <= 0) throw new Error('renderer working-set memory metrics are unavailable')
      workingSetPeakKB = Math.max(workingSetPeakKB, workingSet)
      return { result: state.result, workingSetStartKB, workingSetPeakKB }
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for large transfer result: ' + JSON.stringify(lastState))
}

app.whenReady().then(async () => {
  let exitCode = 0
  let win
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    if (!port) throw new Error('performance HTTP server did not bind')

    win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    win.webContents.on('console-message', (_event, detailsOrLevel, legacyMessage) => {
      const message = typeof detailsOrLevel === 'object' && detailsOrLevel?.message
        ? detailsOrLevel.message
        : typeof legacyMessage === 'string'
          ? legacyMessage
          : ''
      if (message.startsWith('__XDRIVE_LARGE_TRANSFER_PERF_')) console.log(message)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('__XDRIVE_LARGE_TRANSFER_PERF_RENDER_GONE__' + JSON.stringify(details))
    })

    await win.loadURL(
      `http://127.0.0.1:${port}/?xdriveLargeTransferPerf=${scenario}&xdriveLargeTransferSample=${sample}&xdriveLargeTransferSizeGiB=${sizeGiB}`,
    )
    if (scenario === 'upload') {
      await waitForSelector(win, '[data-xdrive-large-transfer-upload-file]')
      win.webContents.debugger.attach('1.3')
      try {
        const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: 1 })
        const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: '[data-xdrive-large-transfer-upload-file]',
        })
        if (!nodeId) throw new Error('large-transfer upload input was not found')
        await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
          nodeId,
          files: [uploadFixture],
        })
      } finally {
        win.webContents.debugger.detach()
      }
    }
    const measured = await waitForResult(win)
    const combined = {
      ...measured.result,
      surface: 'web',
      runtimeVersions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
      rendererWorkingSetStartKB: measured.workingSetStartKB,
      rendererWorkingSetPeakKB: measured.workingSetPeakKB,
      rendererWorkingSetDeltaKB:
        measured.workingSetStartKB === null || measured.workingSetPeakKB === null
          ? null
          : measured.workingSetPeakKB - measured.workingSetStartKB,
      server: serverStats,
    }

    if (scenario === 'upload') {
      if (serverStats.uploadInitSize !== sizeBytes) {
        throw new Error(`upload init size=${serverStats.uploadInitSize} want=${sizeBytes}`)
      }
      if (serverStats.uploadBytes !== sizeBytes) {
        throw new Error(`upload bytes=${serverStats.uploadBytes} want=${sizeBytes}`)
      }
      if (serverStats.uploadChunks !== sizeBytes / chunkSize) {
        throw new Error(`upload chunks=${serverStats.uploadChunks} want=${sizeBytes / chunkSize}`)
      }
    } else if (serverStats.downloadBytes !== sizeBytes) {
      throw new Error(`download bytes=${serverStats.downloadBytes} want=${sizeBytes}`)
    }

    fs.writeFileSync(metricsPath, JSON.stringify(combined, null, 2) + '\n')
    console.log('__XDRIVE_LARGE_TRANSFER_PERF_RESULT__' + JSON.stringify(combined))
  } catch (error) {
    exitCode = 1
    console.error(error)
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(userData, { recursive: true, force: true })
    app.exit(exitCode)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
