'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {createHash,createCipheriv} = require('node:crypto')
const { app, BrowserWindow } = require('electron')

// This launcher calls the EXACT shared Web XDriveApi upload/download/OPFS
// harness, but serves it from a genuine PostgreSQL17/Gin/physical Local CAS
// fixture. It never creates a fake upload/download HTTP service.
const scenarios = new Set(['upload', 'download'])
const scenario = process.argv.find(value => scenarios.has(value))
const sample = process.argv.find(value => /^sample-\d+$/.test(value))
if (!scenario || !sample) throw Error('upload|download sample-N required')
const sizeGiB = Number(process.env.XD_REAL_CAS_SIZE_GIB || '1')
if (![1,4].includes(sizeGiB)) throw Error('real Web CAS benchmark size must be 1 or 4 GiB')
const sizeBytes = sizeGiB * 2 ** 30
const highEntropy = process.env.XD_REAL_CAS_INCOMPRESSIBLE_PERF === '1'
const mobileWebViewport = process.env.XD_REAL_WEB_CAS_MOBILE_VIEWPORT === '1'
if (mobileWebViewport && (!highEntropy || sizeGiB !== 4 || process.env.XD_PWA_FULL_OPFS_READBACK === '1')) {
  throw Error('P051 mobile Web requires actual 4GiB high-entropy CAS with complete OPFS verification')
}
const highEntropyQuery = highEntropy ? '&xdriveCasIncompressible=1' : ''
let physicalSeedSHA256 = null
let sourceAllocatedBytes = null
const pwaReadbackParam = process.env.XD_PWA_FULL_OPFS_READBACK === '1' ? '&xdrivePwaFullReadback=1' : ''
const chunkSize = 8 * 1024 * 1024
const desktopRoot = path.resolve(__dirname, '..')
const resultsDir = path.resolve(process.env.XD_REAL_WEB_CAS_RESULTS || path.join(desktopRoot, 'real-web-cas-results'))
const metricsPath = path.join(resultsDir, 'web-' + scenario + '-' + sample + '.json')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-web-real-cas-'))
const uploadFixture = path.join(userData, 'upload-' + sample + '.bin')
if (scenario === 'upload') {
  const fd = fs.openSync(uploadFixture, 'w')
  try {
    if (!highEntropy) {
      fs.ftruncateSync(fd, sizeBytes)
    } else {
      // 1–4 GiB truly allocated, non-sparse AES-CTR CSPRNG stream.
      // Streaming seed and hash are outside the user-upload stopwatch.
      const key = createHash('sha256').update('xdrive-p042-cas-aes256ctr:' + sample).digest()
      const cipher = createCipheriv('aes-256-ctr', key, Buffer.alloc(16))
      const sha = createHash('sha256')
      const zeros = Buffer.alloc(8 * 1024 * 1024)
      let remaining = sizeBytes
      while (remaining > 0) {
        const n = Math.min(zeros.length, remaining)
        const payload = cipher.update(zeros.subarray(0, n))
        let written = 0
        while (written < payload.length) {
          const count = fs.writeSync(fd, payload, written, payload.length - written)
          if (count <= 0) throw Error('Cannot persist incompressible physical CAS input')
          written += count
        }
        sha.update(payload)
        remaining -= n
      }
      if (cipher.final().length !== 0) throw Error('AES-CTR benchmark stream misaligned')
      fs.fsyncSync(fd)
      physicalSeedSHA256 = sha.digest('hex')
      sourceAllocatedBytes = fs.fstatSync(fd).blocks * 512
      if (sourceAllocatedBytes < sizeBytes * 0.98) {
        throw Error('Benchmark source is sparse or compressed: actual physical bytes ' + sourceAllocatedBytes)
      }
    }
  } finally { fs.closeSync(fd) }
}
app.setPath('userData', userData)
fs.mkdirSync(resultsDir, { recursive: true })
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('enable-precise-memory-info')
app.commandLine.appendSwitch('no-sandbox')

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
  const deadline = Date.now() + (highEntropy ? 9 : (sizeGiB === 4 ? 6 : 5)) * 60_000
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
    const base = process.env.XD_REAL_WEB_CAS_URL
    if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) {
      throw new Error('actual native Gin/CAS localhost URL required')
    }

    win = new BrowserWindow({
      width: mobileWebViewport ? 390 : 1280,
      height: mobileWebViewport ? 844 : 800,
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
      `${base}/?xdriveLargeTransferPerf=${scenario}&xdriveLargeTransferSample=${sample}&xdriveLargeTransferSizeGiB=${sizeGiB}&xdriveLargeTransferRealCAS=1${pwaReadbackParam}${highEntropyQuery}`,
    )
    // P051: observe actual Chromium document/client width, not just BrowserWindow outer dimensions.
    // 390px Linux Chromium is NOT a native phone or an OS-installed PWA.
    let mobileViewportEvidence = null
    if (mobileWebViewport) {
      mobileViewportEvidence = await win.webContents.executeJavaScript(
        `({innerWidth: window.innerWidth, documentWidth: document.documentElement.clientWidth,
          innerHeight: window.innerHeight, mobileBreakpoint: matchMedia('(max-width: 899.95px)').matches,
          userAgent: navigator.userAgent})`,
        true,
      )
      if (!mobileViewportEvidence.mobileBreakpoint ||
          !Number.isFinite(mobileViewportEvidence.innerWidth) ||
          !Number.isFinite(mobileViewportEvidence.documentWidth) ||
          mobileViewportEvidence.innerWidth < 360 || mobileViewportEvidence.innerWidth > 390 ||
          mobileViewportEvidence.documentWidth < 360 || mobileViewportEvidence.documentWidth > 390) {
        throw Error('P051 no actual 360..390 CSS px narrow renderer: ' + JSON.stringify(mobileViewportEvidence))
      }
    }
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
      surface: mobileWebViewport ? 'mobile-web-chromium-390px' : 'web',
      mobileViewportEvidence,
      runtimeVersions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
      rendererWorkingSetStartKB: measured.workingSetStartKB,
      rendererWorkingSetPeakKB: measured.workingSetPeakKB,
      rendererWorkingSetDeltaKB:
        measured.workingSetStartKB === null || measured.workingSetPeakKB === null
          ? null
          : measured.workingSetPeakKB - measured.workingSetStartKB,
      backend: 'genuine PostgreSQL17/Gin/Local CAS; production Web XDriveApi + OPFS',
      highEntropyIncompressible: highEntropy,
    }

    const statsResp = await fetch(base + '/__perf/web-transfer-stats', { cache: 'no-store' })
    if (!statsResp.ok) throw new Error('real production Server/CAS stats unavailable')
    const stats = await statsResp.json()
    combined.server = stats
    if (stats.size_bytes !== sizeBytes || stats.cas_valid !== true || stats.cas_bytes !== sizeBytes) {
      throw new Error('real PostgreSQL/CAS not fully persisted after browser transfer: ' + JSON.stringify(stats))
    }
    if (scenario === 'upload') {
      if (stats.put_count !== sizeBytes / chunkSize || stats.declared_upload_bytes !== sizeBytes ||
          stats.uploaded_node_id !== combined.uploadedNodeID ||
          stats.file_sha256 !== combined.uploadedSHA256 ||
          (highEntropy && (physicalSeedSHA256 !== combined.uploadedSHA256 ||
            sourceAllocatedBytes < sizeBytes * 0.98))) {
        throw new Error('real signed high-entropy chunk upload and SHA-256 integrity failed: ' + JSON.stringify(stats))
      }
      if (highEntropy) {
        combined.uploadSourcePhysicallyAllocatedBytes = sourceAllocatedBytes
        combined.uploadSeedSHA256 = physicalSeedSHA256
      }
    } else if (stats.download_get_count !== 1 ||
        combined.downloadSpotCheckedBytes !== 3 * 1024 * 1024 ||
        (highEntropy && combined.downloadDeterministicVerifiedBytes !== sizeBytes) ||
        (process.env.XD_PWA_FULL_OPFS_READBACK === '1' && combined.downloadFullVerifiedBytes !== sizeBytes)) {
      throw new Error('real authenticated Gin GET / full deterministic OPFS readback failed: ' + JSON.stringify(stats))
    }

    fs.writeFileSync(metricsPath, JSON.stringify(combined, null, 2) + '\n')
    console.log('__XDRIVE_LARGE_TRANSFER_PERF_RESULT__' + JSON.stringify(combined))
  } catch (error) {
    exitCode = 1
    console.error(error)
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    fs.rmSync(userData, { recursive: true, force: true })
    app.exit(exitCode)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
