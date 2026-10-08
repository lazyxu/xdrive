const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, contentTracing } = require('electron')

const surfaces = new Set(['desktop', 'web'])
const scenarios = new Set(['image-cold', 'image-warm'])
const surface = process.argv.find((value) => surfaces.has(value))
const scenario = process.argv.find((value) => scenarios.has(value))
const sampleArg = process.argv.find((value) => /^sample-\d+$/.test(value))
const sample = sampleArg ? Number(sampleArg.slice('sample-'.length)) : 1

if (!surface || !scenario || !Number.isInteger(sample) || sample < 1) {
  console.error('Usage: electron scripts/gallery-renderer-first-paint-trace-main.cjs <desktop|web> <image-cold|image-warm> [sample-N]')
  process.exit(2)
}

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const resultsDir = path.join(desktopRoot, 'gallery-perf-results')
const sampleSuffix = `sample${sample}`
const tracePath = path.join(resultsDir, `${surface}-${scenario}-${sampleSuffix}-trace.json`)
const metricsPath = path.join(resultsDir, `${surface}-${scenario}-${sampleSuffix}.json`)
const rendererPath = surface === 'desktop'
  ? path.join(desktopRoot, 'dist', 'renderer', 'index.html')
  : path.join(repoRoot, 'web', 'dist', 'index.html')

fs.mkdirSync(resultsDir, { recursive: true })

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('no-sandbox')

async function waitForResult(win) {
  const deadline = Date.now() + 60_000
  let lastState = null
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript(
      `({
        result: window.__xdriveGalleryPerfResult || null,
        error: window.__xdriveGalleryPerfError || null,
        boot: window.__xdriveGalleryPerfBoot ?? null,
        bootError: window.__xdriveGalleryPerfBootError || null,
        readyState: document.readyState,
        href: window.location.href,
        hasGrid: Boolean(document.querySelector('[data-xdrive-media-gallery-virtual-grid]')),
        imageCount: document.querySelectorAll('[data-xdrive-media-gallery-virtual-grid] img').length,
        placeholderCount: document.querySelectorAll('[data-xdrive-media-gallery-placeholder]').length,
      })`,
      true,
    )
    lastState = state
    if (state.bootError) throw new Error(`${surface}/${scenario} boot error: ${state.bootError}`)
    if (state.error) throw new Error(`${surface}/${scenario} renderer error: ${state.error}`)
    if (state.result) return state.result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(
    `Timed out waiting for ${surface}/${scenario} Gallery renderer trace: ${JSON.stringify(lastState)}`,
  )
}

app.whenReady().then(async () => {
  let exitCode = 0
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: true,
    backgroundColor: '#f5f7fb',
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
    if (message.startsWith('__XDRIVE_GALLERY_PERF_')) console.log(message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error('__XDRIVE_GALLERY_PERF_LOAD_ERROR__' + JSON.stringify({ code, description, validatedURL }))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('__XDRIVE_GALLERY_PERF_RENDER_GONE__' + JSON.stringify(details))
  })

  try {
    await contentTracing.startRecording({
      recording_mode: 'record-until-full',
      included_categories: [
        'blink',
        'blink.user_timing',
        'devtools.timeline',
        'renderer.scheduler',
        'v8.execute',
      ],
    })
    await win.loadFile(rendererPath, {
      query: { xdriveGalleryPerf: scenario },
    })
    const result = await waitForResult(win)
    const appMetrics = app.getAppMetrics()
    const rendererMetric = appMetrics.find((metric) => metric.type === 'Tab')
      || appMetrics.find((metric) => metric.type === 'Renderer')
    const combined = {
      ...result,
      surface,
      sample,
      rendererWorkingSetKB: rendererMetric?.memory?.workingSetSize ?? null,
    }

    if (
      combined.viewportWidth !== 1440 ||
      combined.viewportHeight !== 900
    ) {
      throw new Error(
        `Gallery renderer viewport ${combined.viewportWidth}x${combined.viewportHeight} does not match 1440x900 workload.`,
      )
    }
    if (!Number.isFinite(combined.routeToFirstPaintMs) || combined.routeToFirstPaintMs <= 0) {
      throw new Error('Gallery renderer trace did not produce a valid first-paint timing.')
    }
    if (combined.mountedImages < 1) {
      throw new Error('Gallery renderer trace did not mount a decoded image.')
    }

    fs.writeFileSync(metricsPath, JSON.stringify(combined, null, 2) + '\n')
    console.log('__XDRIVE_GALLERY_PERF_METRICS__' + JSON.stringify(combined))
  } catch (error) {
    exitCode = 1
    console.error(error)
  } finally {
    try {
      await contentTracing.stopRecording(tracePath)
    } catch (error) {
      console.error('Failed to stop Chromium tracing:', error)
      exitCode = 1
    }
    if (!win.isDestroyed()) win.destroy()
    app.exit(exitCode)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
