'use strict'
const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const path = require('node:path')
const { app, contentTracing } = require('electron')
const { readAndSummariseTrace } = require('./gallery-desktop-chromium-trace-analyze.cjs')
const { summariseCPUProfile } = require('./gallery-desktop-cpu-profile-analyze.cjs')

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
// Fail-closed error categories only. Raw Electron errors can contain private
// URLs and file paths and must never be forwarded to CI summary or artifacts.
function gallerySafeCpuFailure(error) {
  const message = String(error?.message || error || '')
  if (message.includes('real first-party Renderer V8 sampled CPU attribution unavailable'))
    return 'first_party_sourcemap_unresolved'
  if (message.includes('actual sampled V8 CPUProfile missing'))
    return 'v8_sample_count_missing'
  if (message.includes('invalid V8 CPUProfile duration'))
    return 'v8_profile_clock_invalid'
  if (message.includes('invalid V8 CPUProfile call tree'))
    return 'v8_call_tree_invalid'
  if (message.includes('invalid actual V8 CPU sample'))
    return 'v8_sample_reference_invalid'
  if (message.includes('invalid local Vite sourcemap JSON') ||
      message.includes('invalid Vite sourcemap') ||
      message.includes('sourcemap VLQ') ||
      message.includes('sourcemap segment'))
    return 'sourcemap_parse_invalid'
  if (/Profiler\.|Debugger|Protocol error|not attached|target closed/i.test(message))
    return 'devtools_protocol_error'
  if (message.includes('timed out waiting for'))
    return 'gallery_decode_timeout'
  if (message.includes('sidebar diagnosis'))
    return 'desktop_login_or_navigation'
  return 'unclassified_test_error'
}
// These are the only diagnostics forwarded outside the ephemeral Electron
// renderer. Never pass call frames, scripts, sample node IDs or URLs.
function gallerySafeV8Shape(profile) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes : []
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const intervals = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : []
  const ids = new Set(nodes.map(x => x?.id))
  return {
    nodeCount: nodes.length, sampleCount: samples.length,
    intervalCount: intervals.length,
    duplicateNodeCount: nodes.length - ids.size,
    missingSampleNodeCount: samples.filter(id => !ids.has(id)).length,
    nonFiniteIntervalCount: intervals.filter(x => !Number.isFinite(x)).length,
    negativeIntervalCount: intervals.filter(x => Number.isFinite(x) && x < 0).length,
    largestNegativeIntervalMs: intervals.reduce((a, x) => Number.isFinite(x) ? Math.max(a, -x/1000) : a, 0),
    longerThan120sIntervalCount: intervals.filter(x => Number.isFinite(x) && x > 120000000).length,
    longestIntervalMs: intervals.reduce((a, x) => Number.isFinite(x) ? Math.max(a, x/1000) : a, 0),
    clockValid: Number.isFinite(profile?.startTime) &&
      Number.isFinite(profile?.endTime) && profile.endTime > profile.startTime,
  }
}
function nativeProcessMetrics(pid) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8')
    const line = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
    const fields = line.slice(line.lastIndexOf(') ') + 2).split(' ')
    const rssKiB = Number(status.match(/^VmRSS:\s*(\d+) kB/m)?.[1] || 0)
    const cpuTicks = Number(fields[11]) + Number(fields[12])
    if (!Number.isFinite(rssKiB) || !Number.isFinite(cpuTicks)) return null
    return { pid, rssKiB, cpuTicks }
  } catch { return null }
}
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
    // Observer diagnostic is test-only; never emitted by the production app.
    mutationNotifications: 0,
    coalescedScanFrames: 0,
    gridScanCount: 0,
    gridScanCpuMs: 0,
    maxGridScanCpuMs: 0,
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
    const scanStarted = performance.now()
    data.gridScanCount++
    try {
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
    } finally {
      const cpu = performance.now() - scanStarted
      data.gridScanCpuMs += cpu
      data.maxGridScanCpuMs = Math.max(data.maxGridScanCpuMs, cpu)
    }
  }
  // The previous real-Desktop benchmark rescanned the entire Gallery grid
  // synchronously on every mutation anywhere in document.body (including
  // unrelated attributes). Batch observations into at most one scan per frame
  // and retain notifications needed for new tiles and changed image sources.
  // This changes BENCHMARK observation only, not the production application.
  let scanQueued = false
  function scheduleScan() {
    data.mutationNotifications++
    if (scanQueued || completed) return
    scanQueued = true
    requestAnimationFrame(() => {
      scanQueued = false
      if (completed) return
      data.coalescedScanFrames++
      scan()
    })
  }
  observer = new MutationObserver(scheduleScan)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  })
  window.__xdriveDesktopRealColdProbe = data
  gallery.click()
  scan()
  return { started: true }
}

// Opt-in benchmark only. Runs in the actual isolated production Renderer
// against its contextBridge preload, Electron Main and authenticated Go Agent.
// Measuring after first-12 decode avoids contaminating initial Gallery paint.
async function measureRealDesktopMediaProgress(sample) {
  const agent = window.xdriveDesktop?.agent
  if (!agent) throw new Error('real Desktop preload Agent unavailable')
  const range = await agent.getMediaItemRange('', 100, 0, {})
  if (!range?.ok || !Array.isArray(range.data?.items) || range.data.total_count !== 100000) {
    throw new Error('real Desktop 100k media range unavailable for progress probe: ' +
      JSON.stringify({ ok: range?.ok, count: range?.data?.total_count }))
  }
  const candidates = range.data.items.filter(item => item?.metadata?.media_kind === 'image' &&
    item.metadata.has_thumbnail && Number.isSafeInteger(item.node?.id) && item.node.id > 0 &&
    Number.isSafeInteger(item.node?.revision) && item.node.revision > 0).slice(0, 3)
  if (candidates.length !== 3) {
    throw new Error('real 100k fixture must provide three thumbnail-backed JPEG assets')
  }
  const modes = sample % 2 === 0 ? ['on', 'off'] : ['off', 'on']
  const rows = []
  for (let index = 0; index < candidates.length; index++) {
    const item = candidates[index]
    for (const mode of modes) {
      const callbackRows = []
      const t0 = performance.now()
      const heapStartBytes = performance.memory?.usedJSHeapSize ?? null
      const requestID = 'bench-media-progress-' + sample + '-' + index + '-' + mode
      const response = await agent.getMediaThumbnail(
        item.node.id, requestID, item.node.revision,
        mode === 'on' ? (loaded, total) => {
          callbackRows.push({ loaded, total: total ?? null, atMs: performance.now() - t0 })
        } : undefined,
      )
      const elapsedMs = performance.now() - t0
      if (!response?.ok || !(response.data?.data instanceof ArrayBuffer)) {
        throw new Error('real Renderer→Main→Agent binary thumbnail failed: ' +
          JSON.stringify({ id: item.node.id, mode, error: response?.error }))
      }
      const bodyBytes = response.data.data.byteLength
      if (bodyBytes <= 0) throw new Error('empty production Agent binary thumbnail')
      if (mode === 'on') {
        if (callbackRows.length < 2 || callbackRows[0].loaded !== 0) {
          throw new Error('no actual initial IPC media progress: ' +
            JSON.stringify({ id: item.node.id, callbackRows }))
        }
        let last = 0
        for (const event of callbackRows) {
          if (!Number.isSafeInteger(event.loaded) || event.loaded < last ||
              event.loaded > bodyBytes || (event.total !== null && event.total !== bodyBytes)) {
            throw new Error('nonmonotonic / inconsistent IPC media bytes: ' +
              JSON.stringify({ id: item.node.id, bodyBytes, callbackRows }))
          }
          last = event.loaded
        }
        if (last !== bodyBytes) {
          throw new Error('IPC media final callback did not match real ArrayBuffer length: ' +
            JSON.stringify({ id: item.node.id, bodyBytes, callbackRows }))
        }
      } else if (callbackRows.length !== 0) {
        throw new Error('OFF response unexpectedly counted progress')
      }
      rows.push({
        mode, itemIndex: index, nodeID: item.node.id, revision: item.node.revision,
        requestID, bodyBytes, elapsedMs,
        callbackCount: callbackRows.length,
        firstReportedBytes: callbackRows[0]?.loaded ?? null,
        lastReportedBytes: callbackRows.at(-1)?.loaded ?? null,
        lastReportedTotal: callbackRows.at(-1)?.total ?? null,
        callbackRows,
        heapStartBytes,
        heapEndBytes: performance.memory?.usedJSHeapSize ?? null,
      })
    }
  }
  const paired = candidates.map((item, i) => {
    const off = rows.find(row => row.mode === 'off' && row.itemIndex === i)
    const on = rows.find(row => row.mode === 'on' && row.itemIndex === i)
    if (!off || !on || off.bodyBytes !== on.bodyBytes) {
      throw new Error('real media ON/OFF data bytes do not match same revision: ' + item.node.id)
    }
    return { itemIndex: i, nodeID: item.node.id, bodyBytes: on.bodyBytes,
      offMs: off.elapsedMs, onMs: on.elapsedMs, onMinusOffMs: on.elapsedMs - off.elapsedMs }
  })
  return {
    kind: 'actual-production-Electron-preload-Main-Agent-binary-byte-progress',
    sourceCount: range.data.total_count, modes, rows, pairs: paired,
    noObserverTransfers: rows.filter(row => row.mode === 'off').length,
    observedTransfers: rows.filter(row => row.mode === 'on').length,
    realObserverEvents: rows.filter(row => row.mode === 'on').reduce((sum, row) => sum + row.callbackCount, 0),
    totalVerifiedObservedBytes: rows.filter(row => row.mode === 'on').reduce((sum, row) => sum + row.bodyBytes, 0),
    limits: '3 real JPEG-backed thumbnail assets per 100k fixture, exact revision and per-request ID. Warm-cache/ordering may affect timing. No production code modification, real viewport cancellation not measured here.',
  }
}

// Read only fixed-schema timings from the existing private Desktop lifecycle
// log. Never put auth/session fields or complete log lines into the benchmark.
function galleryFirstRangeTimings(logDir) {
  const filename = path.join(logDir, 'desktop.log')
  if (!fs.existsSync(filename)) return []
  return fs.readFileSync(filename, 'utf8').split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(entry => entry?.event === 'gallery_first_range_timing')
    .map(entry => ({
      result: entry.result,
      total_ms: entry.total_ms,
      agent_ready_ms: entry.agent_ready_ms,
      pre_http_ms: entry.pre_http_ms,
      http_ms: entry.http_ms,
    }))
}

let attached = false
async function run(win) {
  let tracingStarted = false
  let chromiumTracePath = null
  let cpuProfilingStarted = false
  let cpuDebuggerAttached = false
  let safeV8Shape = null
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
    // Only this opt-in *benchmark* enables the real Chromium RendererMain
    // timeline. Raw traces stay in a temporary directory and are deleted
    // before CI artifacts are uploaded: trace args may contain private URLs.
    const traceEnabled = process.env.XD_GALLERY_DESKTOP_COLD_CHROME_TRACE === '1'
    if (traceEnabled) {
      const scratch = process.env.XD_GALLERY_DESKTOP_TRACE_SCRATCH
      if (!scratch || !fs.statSync(scratch, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error('real desktop Chromium trace requires private scratch directory')
      }
      chromiumTracePath = path.join(scratch, 'real-desktop-gallery-' +
        Number(process.env.XD_GALLERY_DESKTOP_REAL_SAMPLE) + '.json')
      await contentTracing.startRecording({
        recording_mode: 'record-until-full',
        included_categories: [
          'toplevel',
          'blink',
          'blink.user_timing',
          'devtools.timeline',
          'renderer.scheduler',
          'v8.execute',
        ],
      })
      tracingStarted = true
    }
    // CPU profiling is a distinct opt-in diagnostics arm, not a synthetic
    // renderer or a production App modification. Keep it separate from full
    // Chromium Timeline recording to avoid compounded observer overhead.
    const cpuEnabled = process.env.XD_GALLERY_DESKTOP_COLD_CPU_PROFILE === '1'
    if (cpuEnabled) {
      if (traceEnabled || win.webContents.debugger.isAttached())
        throw new Error('independent Desktop CPU profile target required')
      win.webContents.debugger.attach('1.3')
      cpuDebuggerAttached = true
      await win.webContents.debugger.sendCommand('Profiler.enable')
      await win.webContents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 1000 })
      await win.webContents.debugger.sendCommand('Profiler.start')
      cpuProfilingStarted = true
    }
    const beforeRangeRows = galleryFirstRangeTimings(app.getPath('logs')).length
    const armed = await win.webContents.executeJavaScript('(' + activateGalleryAndMeasure.toString() + ')()')
    if (!armed?.started) throw new Error('production Gallery navigation unavailable')
    const result = await until(
      () => win.webContents.executeJavaScript('window.__xdriveDesktopRealColdResult || null'),
      60000, '12 actual Gallery JPEG decodes and two animation frames',
    )
    let cpuProfileSummary = null
    if (cpuProfilingStarted) {
      const { profile } = await win.webContents.debugger.sendCommand('Profiler.stop')
      cpuProfilingStarted = false
      // Never log/serialize/save raw CPUProfile. It contains script URLs and
      // function names. Source maps are read privately, not uploaded.
      win.webContents.debugger.detach()
      cpuDebuggerAttached = false
      try {
        cpuProfileSummary = summariseCPUProfile(profile,
          path.join(expectedAppRoot, 'dist', 'renderer', 'assets'))
      } catch (profileError) {
        safeV8Shape = gallerySafeV8Shape(profile)
        throw profileError
      }
      if (cpuProfileSummary.sampleCount < 100 ||
          cpuProfileSummary.sourceMappedSampleFrames < 1 ||
          cpuProfileSummary.firstPartySampleCount < 1 ||
          cpuProfileSummary.rawProfileArgsPathsOrURLsIncluded !== false)
        throw new Error('real first-party Renderer V8 sampled CPU attribution unavailable')
    }
    let chromiumTimeline = null
    if (tracingStarted) {
      await contentTracing.stopRecording(chromiumTracePath)
      tracingStarted = false
      try {
        chromiumTimeline = readAndSummariseTrace(
          chromiumTracePath,
          win.webContents.getOSProcessId(),
          result.longTasks,
        )
        if (!chromiumTimeline.rendererPIDMatched ||
            chromiumTimeline.rendererEvents < 1 ||
            chromiumTimeline.longTaskTraceCount < 1) {
          throw new Error('real renderer main-thread long tasks were not traced')
        }
      } finally {
        // TraceEvent JSON can include headers, URLs and file paths. Never
        // persist raw trace bytes in a benchmark artifact or console log.
        fs.rmSync(chromiumTracePath, { force: true })
      }
    }
    const firstRangeTimings = galleryFirstRangeTimings(app.getPath('logs'))
      .slice(beforeRangeRows)
    if (!firstRangeTimings.some(row => row.result === 'ok' &&
        Number.isFinite(row.total_ms) &&
        Number.isFinite(row.agent_ready_ms) &&
        Number.isFinite(row.http_ms) &&
        row.total_ms >= row.http_ms)) {
      throw new Error('real Desktop Gallery first Range stage timing missing: ' +
        JSON.stringify(firstRangeTimings))
    }
    const afterResp = await fetch(fixture + '/__perf/stats')
    if (!afterResp.ok) throw new Error('after CAS counters missing')
    const afterCAS = await afterResp.json()
    // Snapshot before the independent probe: Gallery-first-paint metrics and
    // accounting cannot accidentally absorb benchmark-only Agent thumbnail GETs.
    const galleryRendererMetrics = app.getAppMetrics().find(
      entry => entry.pid === win.webContents.getOSProcessId(),
    )
    const rendererPID = win.webContents.getOSProcessId()
    const agentPID = Number(process.env.XD_GALLERY_DESKTOP_REAL_AGENT_PID)
    const beforeResources = {
      renderer: nativeProcessMetrics(rendererPID),
      agent: nativeProcessMetrics(agentPID),
    }
    let maxSampledRendererRssKiB = beforeResources.renderer?.rssKiB || 0
    let maxSampledAgentRssKiB = beforeResources.agent?.rssKiB || 0
    const sampleRSS = setInterval(() => {
      const renderer = nativeProcessMetrics(rendererPID)
      const agent = nativeProcessMetrics(agentPID)
      if (renderer) maxSampledRendererRssKiB = Math.max(maxSampledRendererRssKiB, renderer.rssKiB)
      if (agent) maxSampledAgentRssKiB = Math.max(maxSampledAgentRssKiB, agent.rssKiB)
    }, 5)
    let sourceExactMediaProgress = null
    try {
      if (process.env.XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE === '1') {
        sourceExactMediaProgress = await win.webContents.executeJavaScript(
          '(' + measureRealDesktopMediaProgress.toString() + ')(' +
          Number(process.env.XD_GALLERY_DESKTOP_REAL_SAMPLE) + ')', true,
        )
      }
    } finally {
      clearInterval(sampleRSS)
    }
    const afterResources = {
      renderer: nativeProcessMetrics(rendererPID),
      agent: nativeProcessMetrics(agentPID),
    }
    const sourceProgressResources = sourceExactMediaProgress ? {
      before: beforeResources,
      after: afterResources,
      maxSampledRendererRssKiB,
      maxSampledAgentRssKiB,
      rendererCpuTicksDelta: beforeResources.renderer && afterResources.renderer
        ? afterResources.renderer.cpuTicks - beforeResources.renderer.cpuTicks : null,
      agentCpuTicksDelta: beforeResources.agent && afterResources.agent
        ? afterResources.agent.cpuTicks - beforeResources.agent.cpuTicks : null,
      sampling: 'Linux /proc 5ms sampled VmRSS (not exact peak), CPU in scheduler ticks, across all six paired binary IPC requests',
    } : null
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
      firstRangeTimings,
      chromiumTimeline,
      cpuProfileSummary,
      beforeCAS, afterCAS,
      sourceExactMediaProgress,
      sourceProgressResources,
      rendererWorkingSetKiBSnapshot: galleryRendererMetrics?.memory?.workingSetSize ?? null,
      rendererWorkingSetKiBAfterProbe: renderer?.memory?.workingSetSize ?? null,
      description: 'production Electron Main + preload + actual shared Gallery + Agent + authenticated real Gin/PostgreSQL/CAS',
      boundaries: 'activation measured from Gallery sidebar click; initial Electron boot, fixture seed, prior Overview prewarming, physical GPU presentation, physical Windows, remote network and video codec decoding excluded',
    }))
    app.exit(0)
  } catch (error) {
    if (cpuProfilingStarted) {
      try { await win.webContents.debugger.sendCommand('Profiler.stop') } catch {}
    }
    if (cpuDebuggerAttached) {
      try { win.webContents.debugger.detach() } catch {}
    }
    if (tracingStarted) {
      try { await contentTracing.stopRecording(chromiumTracePath) } catch {}
    }
    if (chromiumTracePath) fs.rmSync(chromiumTracePath, { force: true })
    if (process.env.XD_GALLERY_DESKTOP_COLD_CPU_PROFILE === '1') {
      console.log('GALLERY_REAL_DESKTOP_ELECTRON_SAFE_FAILURE ' +
        JSON.stringify({ reason: gallerySafeCpuFailure(error),
          profileShape: safeV8Shape }))
    }
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
