const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, contentTracing } = require('electron')

const surfaces = new Set(['desktop', 'web'])
const scenarios = new Set(['image-cold', 'image-warm', 'video-poster-cold', 'video-poster-warm'])
const surface = process.argv.find((value) => surfaces.has(value))
const scenario = process.argv.find((value) => scenarios.has(value))

if (!surface || !scenario) {
  console.error('Usage: electron scripts/file-explorer-media-trace-main.cjs <desktop|web> <image-cold|image-warm|video-poster-cold|video-poster-warm>')
  process.exit(2)
}

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const resultsDir = path.join(desktopRoot, 'perf-results')
const tracePath = path.join(resultsDir, `${surface}-${scenario}-trace.json`)
const metricsPath = path.join(resultsDir, `${surface}-${scenario}.json`)
const rendererPath = surface === 'desktop'
  ? path.join(desktopRoot, 'dist', 'renderer', 'index.html')
  : path.join(repoRoot, 'web', 'dist', 'index.html')

fs.mkdirSync(resultsDir, { recursive: true })

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('no-sandbox')

async function driveMarqueeSelection(win, request) {
  const startX = Math.round(request.startX)
  const startY = Math.round(request.startY)
  const endX = Math.round(request.endX)
  const endY = Math.round(request.endY)
  const steps = Math.max(1, Math.min(60, Math.round(request.steps || 1)))

  win.webContents.sendInputEvent({
    type: 'mouseMove',
    x: startX,
    y: startY,
    movementX: 0,
    movementY: 0,
  })
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: startX,
    y: startY,
    button: 'left',
    clickCount: 1,
  })

  let previousX = startX
  let previousY = startY
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps
    const x = Math.round(startX + (endX - startX) * ratio)
    const y = Math.round(startY + (endY - startY) * ratio)
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x,
      y,
      button: 'left',
      movementX: x - previousX,
      movementY: y - previousY,
    })
    previousX = x
    previousY = y
    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: endX,
    y: endY,
    button: 'left',
    clickCount: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await win.webContents.executeJavaScript(
    'window.__xdriveFileExplorerPerfMarqueeDone = true',
    true,
  )
}

async function waitForResult(win) {
  const deadline = Date.now() + 60_000
  let lastState = null
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript(
      `({
        result: window.__xdriveFileExplorerPerfResult || null,
        error: window.__xdriveFileExplorerPerfError || null,
        boot: window.__xdriveFileExplorerPerfBoot ?? null,
        bootError: window.__xdriveFileExplorerPerfBootError || null,
        href: window.location.href,
        search: window.location.search,
        readyState: document.readyState,
        hasExplorer: Boolean(document.querySelector('[data-xdrive-file-explorer]')),
        rootChildren: document.getElementById('root')?.childElementCount ?? -1,
        marqueeRequest: window.__xdriveFileExplorerPerfMarqueeRequest || null,
        marqueeDone: window.__xdriveFileExplorerPerfMarqueeDone || false,
      })`,
      true,
    )
    lastState = state
    if (state.bootError) {
      throw new Error(`${surface}/${scenario} boot error: ${state.bootError}`)
    }
    if (state.error) {
      throw new Error(`${surface}/${scenario} renderer error: ${state.error}`)
    }
    if (state.marqueeRequest && !state.marqueeDone) {
      await driveMarqueeSelection(win, state.marqueeRequest)
      continue
    }
    if (state.result) return state.result
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Timed out waiting for ${surface}/${scenario} FileExplorer performance result: ${JSON.stringify(lastState)}`,
  )
}

app.whenReady().then(async () => {
  let exitCode = 0
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The trace must be visible to Chromium's rendering pipeline. Xvfb keeps
    // it off the physical display while preserving requestAnimationFrame/layout.
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
    if (message.startsWith('__XDRIVE_FILE_EXPLORER_PERF_')) console.log(message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error('__XDRIVE_FILE_EXPLORER_PERF_LOAD_ERROR__' + JSON.stringify({ code, description, validatedURL }))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('__XDRIVE_FILE_EXPLORER_PERF_RENDER_GONE__' + JSON.stringify(details))
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
      query: { xdriveFileExplorerPerf: scenario },
    })
    const result = await waitForResult(win)
    const appMetrics = app.getAppMetrics()
    const rendererMetric = appMetrics.find((metric) => metric.type === 'Tab')
      || appMetrics.find((metric) => metric.type === 'Renderer')
    const combined = {
      ...result,
      surface,
      rendererWorkingSetKB: rendererMetric?.memory?.workingSetSize ?? null,
    }

    if (combined.maxMountedItems >= 1000) {
      throw new Error(`Mounted item budget exceeded: ${combined.maxMountedItems}`)
    }
    if (combined.peakRetainedItems > 1200) {
      throw new Error(`Retained metadata budget exceeded: ${combined.peakRetainedItems}`)
    }
    if (combined.peakThumbnailInFlight > 6) {
      throw new Error(`Thumbnail concurrency exceeded: ${combined.peakThumbnailInFlight}`)
    }
    if (combined.marqueeSelectionChangeCount < 1 || combined.marqueePeakSelectedItems < 1) {
      throw new Error(
        `Marquee trace did not select items: changes=${combined.marqueeSelectionChangeCount} peak=${combined.marqueePeakSelectedItems}`,
      )
    }
    if (combined.thumbnailRequests === 0) {
      throw new Error(`Media scenario ${scenario} did not request any thumbnails.`)
    }
    if (
      (scenario === 'image-warm' || scenario === 'video-poster-warm') &&
      combined.thumbnailRequests > 600
    ) {
      throw new Error(`Warm thumbnail admission budget exceeded: ${combined.thumbnailRequests} requests.`)
    }

    fs.writeFileSync(metricsPath, JSON.stringify(combined, null, 2) + '\n')
    console.log('__XDRIVE_FILE_EXPLORER_PERF_METRICS__' + JSON.stringify(combined))
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
