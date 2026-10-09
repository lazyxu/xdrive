'use strict'
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const expectedAppRoot = path.resolve(__dirname, '..')
const actualAppRoot = path.resolve(app.getAppPath())
if (actualAppRoot !== expectedAppRoot) {
  throw new Error('Invalid Desktop benchmark application root: ' + actualAppRoot +
    '; expected ' + expectedAppRoot)
}
console.log('GALLERY_REAL_DESKTOP_APP_ROOT ' + actualAppRoot)

// Benchmark-only Electron entry: imports the actual compiled xDrive Main.
// It never replaces Main IPC handlers, preload, Gallery data source or Agent.
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, budgetMs, label) {
  const start = Date.now()
  while (Date.now() - start < budgetMs) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw new Error('timed out waiting for ' + label)
}

// This source is evaluated only inside the production Desktop renderer,
// after the authentic preload and account state have loaded.
function activateGalleryAndMeasure() {
  const nav = document.querySelector('nav[aria-label="桌面版功能区"]')
  const gallery = Array.from(nav?.querySelectorAll('[role="button"]') || [])
    .find(node => node.textContent?.trim() === '图库')
  if (!window.xdriveDesktop?.agent || !gallery) return { started: false }
  const startedAt = performance.now()
  const elapsed = () => performance.now() - startedAt
  const decoded = new Set()
  const visited = new WeakMap()
  const data = {
    firstVisibleTileMs: null,
    firstImageElementMs: null,
    firstImageDecodedMs: null,
    firstImageTwoRAFMs: null,
    first12DecodedTwoRAFMs: null,
    decodedImages: 0,
    mountedTiles: 0,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    decoderErrors: 0,
    usedJSHeapSizeSnapshot: null,
    longestLongTaskMs: 0,
    longTasks: [],
    longTaskSupported: Boolean(PerformanceObserver.supportedEntryTypes?.includes('longtask')),
  }
  const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  let completed = false
  let observer
  if (data.longTaskSupported) {
    new PerformanceObserver(records => {
      for (const entry of records.getEntries()) {
        if (entry.startTime < startedAt) continue
        data.longestLongTaskMs = Math.max(data.longestLongTaskMs, entry.duration)
        if (data.longTasks.length < 200) data.longTasks.push({
          startMs: entry.startTime - startedAt,
          durationMs: entry.duration,
          attribution: Array.from(entry.attribution || []).map(a => ({
            name: a.name || '', containerType: a.containerType || '',
            containerName: a.containerName || '',
          })),
        })
      }
    }).observe({ type: 'longtask', buffered: false })
  }
  function finalize() {
    if (completed || decoded.size < 12 || data.firstImageTwoRAFMs === null) return
    completed = true
    void twoFrames().then(() => {
      data.first12DecodedTwoRAFMs = elapsed()
      data.decodedImages = decoded.size
      const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
      data.mountedTiles = grid?.querySelectorAll('[role="button"]').length || 0
      data.usedJSHeapSizeSnapshot = performance.memory?.usedJSHeapSize ?? null
      window.__xdriveDesktopRealColdResult = data
      observer.disconnect()
    })
  }
  function scan() {
    const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
    if (!grid) return
    if (data.firstVisibleTileMs === null && grid.querySelector('[role="button"]')) {
      data.firstVisibleTileMs = elapsed()
    }
    const images = Array.from(grid.querySelectorAll('img[src]'))
    if (data.firstImageElementMs === null && images.length > 0) {
      data.firstImageElementMs = elapsed()
    }
    for (const img of images) {
      const url = img.currentSrc || img.src
      if (!url || visited.get(img) === url) continue
      visited.set(img, url)
      void img.decode().then(async () => {
        if (!img.isConnected || (img.currentSrc || img.src) !== url || decoded.has(url)) return
        decoded.add(url)
        data.decodedImages = decoded.size
        if (data.firstImageDecodedMs === null) {
          data.firstImageDecodedMs = elapsed()
          await twoFrames()
          if (data.firstImageTwoRAFMs === null) data.firstImageTwoRAFMs = elapsed()
        }
        finalize()
      }).catch(() => { data.decoderErrors++ })
    }
  }
  observer = new MutationObserver(scan)
  observer.observe(document.body, { subtree: true, attributes: true, childList: true })
  window.__xdriveDesktopRealColdProbe = data
  gallery.click()
  scan()
  return { started: true }
}

let attached = false
async function run(win) {
  try {
    win.setContentSize(1440, 900)
    let lastRendererState = null
    try {
      await until(async () => {
        if (win.isDestroyed()) throw new Error('production Desktop window was destroyed')
        lastRendererState = await win.webContents.executeJavaScript(
          '({ nav: Boolean(document.querySelector("nav[aria-label=\\"桌面版功能区\\"]")), preload: Boolean(window.xdriveDesktop?.agent), ready: document.readyState, href: location.href, bodyText: (document.body?.innerText || "").slice(0, 1000) })',
        ).catch(error => ({ evaluationError: String(error) }))
        return lastRendererState.nav
      }, 45000, 'authenticated Desktop sidebar')
    } catch (error) {
      const state = await Promise.race([
        win.webContents.executeJavaScript(
          'window.xdriveDesktop?.agent?.getState?.().then(x=>({ok:x?.ok,connected:x?.connected??x?.data?.connected,configured:x?.status?.configured??x?.data?.status?.configured,error:typeof x?.error==="string"?x.error:x?.error?.message})).catch(e=>({ipcError:String(e)}))',
        ).catch(e => ({ evaluationError: String(e) })),
        delay(3000).then(() => ({ ipcTimeout: true })),
      ])
      let lifecycle = []
      try {
        const logPath = path.join(app.getPath('logs'), 'desktop.log')
        lifecycle = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
          .map(line => JSON.parse(line))
          .filter(entry => entry.event === 'startup_checkpoint' ||
            entry.event.includes('failed') || entry.event.includes('error'))
          .slice(-25)
          .map(entry => ({ event: entry.event, stage: entry.stage || null,
            error: entry.error || null }))
      } catch (logError) {
        lifecycle = [{ event: 'lifecycle_log_unavailable', error: String(logError) }]
      }
      const discoveryExists = fs.existsSync(path.join(app.getPath('appData'), 'xdrive', 'desktop-ipc.json'))
      throw new Error('real Desktop sidebar diagnosis: ' +
        JSON.stringify({ lastRendererState, state, appData: app.getPath('appData'),
          xdgConfigHome: process.env.XDG_CONFIG_HOME,
          discoveryExists, lifecycle }) +
        '; prior=' + String(error))
    }
    const fixture = process.env.XD_GALLERY_DESKTOP_REAL_SERVER_URL
    if (!fixture) throw new Error('fixture URL absent')
    const beforeResp = await fetch(fixture + '/__perf/stats')
    if (!beforeResp.ok) throw new Error('before CAS counters missing')
    const beforeCAS = await beforeResp.json()
    const armed = await win.webContents.executeJavaScript('(' + activateGalleryAndMeasure.toString() + ')()')
    if (!armed?.started) throw new Error('production Gallery navigation unavailable')
    const result = await until(
      () => win.webContents.executeJavaScript('window.__xdriveDesktopRealColdResult || null'),
      60000, '12 actual Gallery JPEG decodes and two animation frames',
    )
    const afterResp = await fetch(fixture + '/__perf/stats')
    if (!afterResp.ok) throw new Error('after CAS counters missing')
    const afterCAS = await afterResp.json()
    if (result.decodedImages < 12 || result.mountedTiles >= 1000 ||
        !Number.isFinite(result.firstImageTwoRAFMs) ||
        result.viewportWidth !== 1440 || result.viewportHeight !== 900) {
      throw new Error('real renderer 100k integrity failure: ' + JSON.stringify(result))
    }
    const metrics = app.getAppMetrics()
    const renderer = metrics.find(entry => entry.pid === win.webContents.getOSProcessId())
    console.log('GALLERY_REAL_DESKTOP_ELECTRON_SAMPLE ' + JSON.stringify({
      sample: Number(process.env.XD_GALLERY_DESKTOP_REAL_SAMPLE),
      realProductionDesktop: true,
      renderer: result,
      beforeCAS, afterCAS,
      rendererWorkingSetKiBSnapshot: renderer?.memory?.workingSetSize ?? null,
      description: 'production Electron Main + preload + actual shared Gallery + Agent + authenticated real Gin/PostgreSQL/CAS',
      boundaries: 'activation measured from Gallery sidebar click; initial Electron boot, fixture seed, prior Overview prewarming, physical GPU presentation, physical Windows, remote network and video codec decoding excluded',
    }))
    app.exit(0)
  } catch (error) {
    console.error('GALLERY_REAL_DESKTOP_ELECTRON_ERROR ' + (error?.stack || String(error)))
    app.exit(1)
  }
}
app.on('browser-window-created', (_event, win) => {
  if (attached) return
  attached = true
  win.webContents.once('did-finish-load', () => { void run(win) })
})
require('../dist/main/index.cjs')
