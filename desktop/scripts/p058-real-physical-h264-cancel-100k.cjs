'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const out = path.resolve(process.env.XD_P058_RESULTS || path.join(__dirname, '..', 'p058-physical-h264-cancel-100k-results'))
const testBinary = process.env.XD_P058_TEST_BINARY
if (!testBinary) throw Error('P058 requires compiled actual Go test binary')
const source = path.join(root, 'ui/shared/src/mui/MediaGalleryVideoPoster.ts')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const modes = ['viewport-eviction', 'window-destroy']
const observationMs = 160
const maxGoRSSGrowth = 256 * 1024 * 1024
const clockTicks = Number(require('node:child_process').execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8'}).trim())
function nativeResource(pid) {
  const text = fs.readFileSync('/proc/' + pid + '/status','utf8')
  const kb = Number(text.match(/^VmRSS:\s+(\d+) kB/m)?.[1])
  const stat = fs.readFileSync('/proc/' + pid + '/stat','utf8')
  const ticks = stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const cpu = (Number(ticks[11])+Number(ticks[12]))*1000/clockTicks
  assert(Number.isFinite(kb) && Number.isFinite(cpu) && clockTicks>0,'native Go CPU/RSS absent')
  return {rssBytes:kb*1024,cpuMs:cpu}
}

app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function until(fn, duration, reason) {
  const began = performance.now()
  while (performance.now() - began < duration) {
    const result = await fn()
    if (result) return result
    await sleep(15)
  }
  throw Error('timed out: ' + reason)
}

async function fixtureStart(sample, ready) {
  const log = fs.createWriteStream(path.join(out, 'native-' + sample + '.log'))
  const child = spawn(testBinary, [
    '-test.run=^TestFileExplorerRealH264PosterBrowser100K$',
    '-test.count=1', '-test.timeout=18m', '-test.v',
  ], {
    cwd: root,
    env: { ...process.env,
      XD_FILEEXPLORER_REAL_H264_100K_PERF: '1',
      XD_FILEEXPLORER_H264_CANCEL_100K_PERF: '1',
      XD_FILEEXPLORER_REAL_H264_PHYSICAL_100K_PERF: '1',
      XD_P058_REAL_PHYSICAL_H264_CANCEL_100K_PERF: '1',
      XD_FILEEXPLORER_REAL_H264_READY_FILE: ready,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.on('error', e => log.write('spawn error: ' + String(e)))
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const config = await until(() => {
    if (child.exitCode !== null) throw Error('native fixture quit before ready: ' + child.exitCode)
    return fs.existsSync(ready) ? JSON.parse(fs.readFileSync(ready, 'utf8')) : null
  }, 12 * 60 * 1000, '100k actual SHA-distinct MP4 original CAS seed')
  return { child, exited, log, config }
}

async function fixtureStop(fixture) {
  if (!fixture) return
  try { await fetch(fixture.config.url + '/__perf/stop', { method: 'POST' }) } catch (_) {}
  const exit = await Promise.race([fixture.exited, sleep(60000).then(() => ({ code: 'timeout' }))])
  if (exit.code !== 0) {
    fixture.child.kill('SIGKILL')
    fixture.log.end()
    throw Error('native fixture did not exit 0: ' + JSON.stringify(exit))
  }
  fixture.log.end()
}

async function stats(base) {
  const r = await fetch(base + '/__perf/stats', { cache: 'no-store' })
  assert.equal(r.status, 200)
  return r.json()
}

// This body runs in the actual Chromium renderer and imports the genuine
// xDriveCaptureVideoPosterBlob source. Do NOT await the pending media decoder.
async function rendererStart(options) {
  const { xDriveCaptureVideoPosterBlob } = require(options.sourceModule)
  const tickets = await Promise.all(options.ids.map(async id => {
    const response = await fetch('/api/v1/files/' + id + '/preview-ticket', {
      method: 'POST', headers: { Authorization: 'Bearer ' + options.token },
      cache: 'no-store',
    })
    if (response.status !== 200) throw Error('signed real Preview ticket HTTP=' + response.status)
    const ticket = await response.json()
    if (ticket.kind !== 'video' || !ticket.url) throw Error('invalid video ticket')
    const u = new URL(ticket.url, location.origin)
    u.searchParams.set('bench_slow', '1')
    return u.href
  }))
  window.__xdriveRealH264AbortControllers = tickets.map(() => new AbortController())
  window.__xdriveRealH264CapturePromises = tickets.map((url, index) =>
    xDriveCaptureVideoPosterBlob(
      url, 0, 96, 64, 512, window.__xdriveRealH264AbortControllers[index].signal,
    ),
  )
  return { launched: tickets.length }
}

function browserWindow(label) {
  return new BrowserWindow({ show: true, width: 1100, height: 720,
    webPreferences: { partition: 'h264-cancel-' + label,
      nodeIntegration: true, contextIsolation: false, sandbox: false,
      backgroundThrottling: false },
  })
}

async function measureMode(fixture, sample, mode, moduleFile, ids) {
  const base = fixture.config.url
  const before = await stats(base)
  let win = null
  try {
    win = browserWindow(sample + '-' + mode)
    await win.loadURL(base + '/')
    const opts = { ids, token: fixture.config.config.token, sourceModule: moduleFile }
    const result = await win.webContents.executeJavaScript(
      '(' + rendererStart.toString() + ')(' + JSON.stringify(opts) + ')', true)
    assert.equal(result.launched, 3)

    const running = await until(async () => {
      const now = await stats(base)
      const started = now.preview_started - before.preview_started
      const ranged = now.preview_range_started - before.preview_range_started
      const streamed = now.preview_emitted_bytes - before.preview_emitted_bytes
      return started === 3 && ranged >= 3 && now.preview_active === 3 &&
        streamed >= 3 * 256 ? now : null
    }, 12000, 'three real H264 signed Range requests in native Gin')

    const mark = await fetch(base + '/__perf/cancel-mark', { method: 'POST' })
    assert.equal(mark.status, 204)
    let browserNullResults = null
    if (mode === 'viewport-eviction') {
      browserNullResults = await win.webContents.executeJavaScript(
        '(async () => {' +
        'window.__xdriveRealH264AbortControllers.forEach(c => c.abort());' +
        'const values = await Promise.all(window.__xdriveRealH264CapturePromises);' +
        'return { count: values.length, allNull: values.every(x => x === null) }' +
        '})()', true)
      assert.deepEqual(JSON.parse(JSON.stringify(browserNullResults)), { count: 3, allNull: true })
    } else if (mode === 'window-destroy') {
      win.destroy()
      win = null
    } else {
      throw Error('unknown viewport request cancellation mode ' + mode)
    }

    await sleep(observationMs)
    const after = await stats(base)
    const change = key => after[key] - before[key]
    const row = {
      sample, mode, namespaceVideoCount: fixture.config.config.total_count,
      actualMP4BytesEach: fixture.config.config.video_bytes,
      rangeRequests: change('preview_range_started'),
      requestsStarted: change('preview_started'),
      contextDone: change('preview_context_done'),
      cancelledHandlers: change('preview_cancelled'),
      serverActiveAt160Ms: after.preview_active,
      bytesSentBeforeCancel: running.preview_emitted_bytes - before.preview_emitted_bytes,
      staleBytesSentAfterCancel: after.preview_emitted_bytes - running.preview_emitted_bytes,
      totalPotentialBytes: fixture.config.config.video_bytes * 3,
      originalOpens: change('original_open'),
      posterPuts: change('preview_poster_puts'),
      worstContextNotificationMs: after.preview_max_cancel_us / 1000,
      browserNullResults,
      measurementScope: 'P058 physical 100k SHA-distinct actual MP4 CAS originals with same encoded 96x64 H264 essence but different legal ISO-BMFF trailer; genuine signed Gin/PG/LocalCAS Preview Range, test-only delayed response writer; manual AbortController simulates viewport eviction, NOT real FileExplorer scroll',
    }
    if (row.requestsStarted !== 3 || row.rangeRequests < 3 ||
        row.contextDone !== 3 || row.cancelledHandlers !== 3 ||
        row.serverActiveAt160Ms !== 0 || row.staleBytesSentAfterCancel !== 0 ||
        row.bytesSentBeforeCancel >= row.totalPotentialBytes ||
        row.originalOpens < 3 || row.posterPuts !== 0 ||
        row.worstContextNotificationMs > observationMs) {
      throw Error('source-exact native video cancel gate failed: ' + JSON.stringify(row))
    }
    return row
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

async function healthyIndependentPreview(fixture) {
  const base = fixture.config.url
  const cfg = fixture.config.config
  const id = cfg.sample_node_ids[0]
  const res = await fetch(base + '/api/v1/files/' + id + '/preview-ticket', {
    method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token },
  })
  assert.equal(res.status, 200)
  const ticket = await res.json()
  const response = await fetch(base + ticket.url, {
    headers: { Range: 'bytes=0-1023' }, cache: 'no-store',
  })
  const bytes = (await response.arrayBuffer()).byteLength
  assert.equal(response.status, 206)
  assert.equal(bytes, 1024)
  return { status: 206, bytes }
}

async function main() {
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL 17 required')
  fs.mkdirSync(out, { recursive: true })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-h264-cancel-100k-'))
  const moduleFile = path.join(temp, 'poster.cjs')
  fs.writeFileSync(moduleFile, ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    fileName: source,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const results = []
  try {
    await app.whenReady()
    for (let sample = 1; sample <= 3; sample++) {
      let fixture = null
      try {
        fixture = await fixtureStart(sample, path.join(temp, 'ready-' + sample + '.json'))
        const cfg = fixture.config.config
        assert.equal(cfg.total_count, 100000)
        assert.equal(cfg.unique_sha256_count, 100000)
        assert.equal(cfg.cancel_mode, true)
        assert.equal(cfg.physical_mode, true)
        assert.equal(cfg.physical_videos, 100000)
        assert.equal(cfg.physical_source_bytes, cfg.video_bytes * 100000)
        assert(cfg.video_bytes > 1000, 'actual H264 MP4 original content missing')
        const goBefore = nativeResource(fixture.child.pid)
        let goPeakRSS = goBefore.rssBytes
        const meter = setInterval(() => {
          try { goPeakRSS = Math.max(goPeakRSS, nativeResource(fixture.child.pid).rssBytes) }
          catch (_) {}
        }, 25)
        let eviction, windowDestroy, healthy, goAfter
        try {
          eviction = await measureMode(fixture, sample, modes[0], moduleFile,
            cfg.sample_node_ids.slice(0, 3))
          windowDestroy = await measureMode(fixture, sample, modes[1], moduleFile,
            cfg.sample_node_ids.slice(3, 6))
          healthy = await healthyIndependentPreview(fixture)
          goAfter = nativeResource(fixture.child.pid)
        } finally { clearInterval(meter) }
        goPeakRSS = Math.max(goPeakRSS, goAfter.rssBytes)
        const resource = {goRSSPeakGrowthBytes: Math.max(0, goPeakRSS - goBefore.rssBytes),
          goCPUAfterSeedMs: Math.max(0, goAfter.cpuMs - goBefore.cpuMs)}
        assert(resource.goRSSPeakGrowthBytes <= maxGoRSSGrowth,
          'real Go postseed RSS delta > 256MiB frozen')
        const entry = { sample, seedMsExcluded: cfg.seed_ms,
          realChromiumVersion: process.versions.chrome,
          physicalOriginals: cfg.physical_videos,
          physicalSourceBytes: cfg.physical_source_bytes,
          uniqueSHA256: cfg.unique_sha256_count,
          resource, viewportEviction: eviction, windowDestroy, healthy }
        results.push(entry)
        fs.writeFileSync(path.join(out, 'sample-' + sample + '.json'),
          JSON.stringify(entry, null, 2) + '\n')
        console.log('P058_PHYSICAL_H264_CANCEL_SAMPLE ' + JSON.stringify(entry))
      } finally {
        if (fixture) await fixtureStop(fixture)
      }
    }
    const rows = results.flatMap(item => [item.viewportEviction, item.windowDestroy])
    const summary = {
      status: 'P058-original-real-100k-physical-MP4-H264-preview-ctx-cancel',
      sourceHead: process.env.XD_P058_SOURCE_HEAD,
      runCount: results.length, modeRuns: rows.length,
      passed: results.length === 3 && rows.length === 6 &&
        results.every(x => x.physicalOriginals === 100000 && x.uniqueSHA256 === 100000 &&
          x.physicalSourceBytes === 100000 * x.viewportEviction.actualMP4BytesEach &&
          x.healthy.status === 206 && x.healthy.bytes === 1024 &&
          x.resource.goRSSPeakGrowthBytes <= maxGoRSSGrowth) &&
        rows.every(x => x.requestsStarted === 3 && x.contextDone === 3 &&
          x.cancelledHandlers === 3 && x.serverActiveAt160Ms === 0 &&
          x.staleBytesSentAfterCancel === 0 && x.posterPuts === 0 &&
          x.worstContextNotificationMs <= observationMs),
      maxContextNotificationMs: Math.max(...rows.map(x => x.worstContextNotificationMs)),
      savedObsoleteBodyBytesVsFullStream: rows.map(x =>
        x.totalPotentialBytes - x.bytesSentBeforeCancel - x.staleBytesSentAfterCancel),
      physical_sources_per_fixture: 100000,
      physical_corpora: 3,
      signed_cancelled_range_requests: 18,
      goRSSPeakGrowthWorstBytes: Math.max(...results.map(x => x.resource.goRSSPeakGrowthBytes)),
      goCPUAfterSeedMs: results.map(x => x.resource.goCPUAfterSeedMs),
      scope: '3 independent PG17/LocalCAS corpora with 100k SHA-distinct MP4 container originals containing SAME encoded 96x64 H264 bitstream; six groups x 3 real Chromium signed Preview Range requests, 18 Go Context.Done and 0 obsolete Handler/bytes at +160ms, test-only delayed writer; manual eviction vs real window destroy, NOT mounted FileExplorer virtual scroll/Agent IPC, independently encoded 100k video scenes, HEVC/Live or durable task cancellation',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('P058_PHYSICAL_H264_CANCEL_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => {
  console.error('P058_PHYSICAL_H264_CANCEL_ERROR ' + (error?.stack || String(error)))
  app.exit(1)
})
