'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { app, net, BrowserWindow } = require('electron')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

const root = path.resolve(__dirname, '..', '..')
const out = path.resolve(__dirname, '..', 'perf-results')
const rangeLimit = 1048576
const repeats = 3
const sleep = n => new Promise(resolve => setTimeout(resolve, n))
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]

function rss(pid) {
  try {
    const match = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
    return match ? Number(match[1]) * 1024 : null
  } catch { return null }
}
async function until(fn, timeout, reason) {
  const begin = Date.now()
  while (Date.now() - begin < timeout) {
    const result = fn()
    if (result) return result
    await sleep(100)
  }
  throw new Error('Timed out: ' + reason)
}
function spawnLogged(name, cmd, args, env) {
  const stream = fs.createWriteStream(path.join(out, name + '.log'))
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(stream, { end: false })
  child.stderr.pipe(stream, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.once('error', err => stream.write('spawn error: ' + String(err)))
  return { child, exited, stream }
}
async function terminate(childInfo) {
  if (!childInfo) return
  if (childInfo.child.exitCode === null) childInfo.child.kill('SIGTERM')
  const result = await Promise.race([childInfo.exited, sleep(6000).then(() => null)])
  if (!result) childInfo.child.kill('SIGKILL')
  childInfo.stream.end()
}
async function stats(base) {
  const resp = await fetch(base + '/__bench/stats', { cache: 'no-store' })
  assert.equal(resp.status, 200)
  return await resp.json()
}
function rendererRange(win, source, abort = false) {
  const script = [
    '(async () => {',
    ' const controller = new AbortController();',
    ' const started = performance.now();',
    ' const response = await fetch(' + JSON.stringify(source) + ', {',
    "   headers: { Range: 'bytes=0-1048575' }, cache: 'no-store', signal: controller.signal",
    ' });',
    ' if (' + String(abort) + ') {',
    "   if (!response.body) throw Error('no response.body to cancel');",
    '   const reader = response.body.getReader();',
    '   const first = await reader.read();',
    '   controller.abort();',
    '   try { await reader.cancel() } catch (_) {}',
    '   return { status: response.status, firstBytes: first.value?.byteLength || 0,',
    '     aborted: controller.signal.aborted };',
    ' }',
    ' const bytes = (await response.arrayBuffer()).byteLength;',
    ' return { status: response.status, bytes, elapsedMs: performance.now() - started,',
    "   contentRange: response.headers.get('content-range'),",
    "   contentType: response.headers.get('content-type'),",
    "   cacheControl: response.headers.get('cache-control'),",
    "   nosniff: response.headers.get('x-content-type-options') };",
    '})()',
  ].join('\n')
  return Promise.race([
    win.webContents.executeJavaScript(script, true),
    sleep(30000).then(() => { throw new Error('Desktop signed Renderer Range/abort timed out: ' + source) }),
  ])
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// Keep the benchmark Main process alive if an offscreen renderer closes.
app.on('window-all-closed', () => console.error('DESKTOP_PROXY_DIAG window-all-closed'))

async function measure() {
  assert(process.env.XD_TEST_DATABASE_URL, 'real PostgreSQL test URL required')
  const agentBinary = process.env.XD_GALLERY_AGENT_BINARY
  assert(agentBinary && fs.existsSync(agentBinary), 'compiled production Agent binary required')
  fs.mkdirSync(out, { recursive: true })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-desktop-preview-proxy-'))
  let goFixture, agentProcess, agent, proxy, win, fixture
  const rows = [], posters = [], cancelled = []
  let complete = false
  try {
    const ready = path.join(temp, 'ready.json')
    goFixture = spawnLogged('gallery-real-gin', 'go', [
      'test', '-run', '^TestGalleryDesktopSignedVideoProxyFixture$',
      '-count=1', '-timeout=10m', '-v', './internal/api',
    ], { ...process.env, XD_GALLERY_DESKTOP_PROXY_PERF: '1',
      XD_GALLERY_DESKTOP_PROXY_READY_FILE: ready })
    fixture = await until(() => {
      if (goFixture.child.exitCode !== null) throw Error('real Gin fixture stopped prematurely')
      return fs.existsSync(ready) ? JSON.parse(fs.readFileSync(ready, 'utf8')) : null
    }, 240000, 'real Gin signed-video fixture')
    assert.equal(fixture.assets.length, 12)
    assert.equal(fixture.decodable_video, false, 'fixture is transport-only')

    const configRoot = path.join(temp, 'agent-config')
    fs.mkdirSync(configRoot, { recursive: true })
    const cacheRoot = path.join(temp, 'agent-cache')
    fs.mkdirSync(cacheRoot, { recursive: true })
    agentProcess = spawnLogged('real-production-agent', agentBinary, [], {
      ...process.env, XDG_CONFIG_HOME: configRoot,
      XDG_CACHE_HOME: cacheRoot, XD_DISABLE_SECRET_SERVICE: '1',
    })
    const discovery = path.join(configRoot, 'xdrive', 'desktop-ipc.json')
    await until(() => {
      if (agentProcess.child.exitCode !== null) throw Error('Agent exited before discovery')
      return fs.existsSync(discovery)
    }, 30000, 'real Agent discovery')
    agent = new AgentIPCClient(discovery)
    const hello = await agent.hello()
    assert(hello.protocol_min <= 2 && hello.protocol_max >= 2)
    const login = await agent.login({
      server: fixture.url, username: fixture.username, password: fixture.password,
    })
    assert(login.configured && !login.must_change_password, 'Agent must authenticate against genuine Gin')
    await agent.setPaused(true)

    proxy = new DesktopFilePreviewProxy(
      nodeID => agent.cloudFilePreviewTicket(nodeID),
      (input, init) => net.fetch(input, init),
    )
    win = new BrowserWindow({
      show: true, width: 840, height: 560,
      webPreferences: { sandbox: false, nodeIntegration: false,
        contextIsolation: true, backgroundThrottling: false },
    })
    win.on('closed', () => console.error('DESKTOP_PROXY_DIAG window-closed'))
    win.webContents.on('render-process-gone', (_event, details) => console.error('DESKTOP_PROXY_DIAG renderer-gone ' + JSON.stringify(details)))
    await win.loadURL('data:text/html,<html><body>Preview Engine benchmark</body></html>')
    console.log('DESKTOP_PROXY_DIAG renderer loaded')
    const agentRssStart = rss(agentProcess.child.pid)
    const firstPosters = await stats(fixture.url)

    for (const asset of fixture.assets.filter(x => !x.preview)) {
      for (let sample = 1; sample <= repeats; sample++) {
        const start = performance.now()
        const result = await agent.mediaThumbnail(asset.node_id, undefined, 1)
        assert(result.content_type === 'image/jpeg' && result.data.byteLength > 100,
          'genuine Agent persisted poster missing')
        const row = { asset: asset.label, sample, bytes: result.data.byteLength,
          elapsedMsDiagnostic: performance.now() - start }
        posters.push(row)
        console.log('GALLERY_DESKTOP_PROXY_POSTER ' + JSON.stringify(row))
      }
    }
    const afterPosters = await stats(fixture.url)
    assert.equal(afterPosters.original_open - firstPosters.original_open, 0,
      'persisted video poster reopened original 4K video')
    assert.equal(afterPosters.poster_open - firstPosters.poster_open, 4,
      'Agent should fetch four unique persisted posters and warm-hit repeats')

    for (const asset of fixture.assets) {
      for (let sample = 1; sample <= repeats; sample++) {
        const started = performance.now()
        console.log('DESKTOP_PROXY_DIAG begin range ' + asset.label + ' sample=' + sample)
        const localURL = await proxy.createURL(asset.node_id)
        console.log('DESKTOP_PROXY_DIAG signed ticket+proxy URL allocated ' + asset.label)
        assert(localURL.startsWith('http://127.0.0.1:') &&
          localURL.includes('/preview/'), 'proxy must hide actual signed upstream ticket')
        try {
          console.log('DESKTOP_PROXY_DIAG executing Chromium fetch ' + asset.label)
          const result = await rendererRange(win, localURL)
          const expected = Math.min(asset.size, rangeLimit)
          assert.equal(result.status, 206)
          assert.equal(result.bytes, expected, 'wrong signed Range body size')
          assert.equal(result.contentRange,
            'bytes 0-' + (expected - 1) + '/' + asset.size)
          assert.equal(result.cacheControl, 'private, no-store')
          assert.equal(result.contentType, 'video/mp4')
          assert.equal(result.nosniff, 'nosniff')
          const row = { asset: asset.label, sample,
            source: asset.source || null, preview: asset.preview,
            codecLabel: asset.codec_label, fileBytes: asset.size,
            rangeBytes: result.bytes, rendererElapsedMsDiagnostic: result.elapsedMs,
            ticketPlusProxyMsDiagnostic: performance.now() - started }
          rows.push(row)
          console.log('GALLERY_DESKTOP_PROXY_RANGE ' + JSON.stringify(row))
        } finally {
          assert(proxy.releaseURL(localURL), 'proxy URL must be revoked on lifecycle exit')
        }
      }
    }
    assert.equal(rows.length, 36)

    for (const label of ['h264-4k-60s-original', 'h264-4k-60s-480p']) {
      const asset = fixture.assets.find(x => x.label === label)
      assert(asset, 'missing abandonment source')
      for (let sample = 1; sample <= repeats; sample++) {
        const ticket = await agent.cloudFilePreviewTicket(asset.node_id)
        const signed = new URL(ticket.url)
        signed.searchParams.set('bench_delayed', '1')
        const localURL = await proxy.createURLFromTicket({ ...ticket, url: signed.toString() })
        const before = await stats(fixture.url)
        try {
          const result = await rendererRange(win, localURL, true)
          await sleep(160)
          const now = await stats(fixture.url)
          const row = { asset: label, sample,
            firstBytes: result.firstBytes, upstreamCanceled: now.cancelled_slow - before.cancelled_slow,
            serverActiveAfter160Ms: now.active_slow,
            bytesEmitted: now.emitted_slow - before.emitted_slow }
          cancelled.push(row)
          console.log('GALLERY_DESKTOP_PROXY_ABORT ' + JSON.stringify(row))
          assert.equal(result.status, 206)
          assert.equal(row.upstreamCanceled, 1, 'Renderer cancel did not propagate to Gin Context')
          assert.equal(row.serverActiveAfter160Ms, 0, 'abandoned Server request still active')
          assert(row.bytesEmitted < rangeLimit, 'abandoned proxy loaded complete 1MiB')
        } finally { proxy.releaseURL(localURL) }
      }
    }
    const gates = {
      genuinePosterNoOriginal: posters.length === 12 &&
        afterPosters.original_open - firstPosters.original_open === 0,
      signed206Range: rows.length === 36 &&
        rows.every(x => x.rangeBytes === Math.min(x.fileBytes, rangeLimit)),
      upstreamCancellation: cancelled.length === 6 &&
        cancelled.every(x => x.upstreamCanceled === 1 &&
          x.serverActiveAfter160Ms === 0 && x.bytesEmitted < rangeLimit),
    }
    const report = {
      name: 'P4 Desktop actual Renderer→Main net.fetch proxy→Agent-issued signed Gin Range',
      status: 'benchmark existing production; no media product changes',
      fixture: { allAssets: 12, originals: 4, threeSecondBoundedCandidates: 8,
        repeats, rangeLimitBytes: rangeLimit, decodable: false,
        label: 'pseudo bytes sized exactly like earlier real 4K-encoded fixtures' },
      runtime: { electron: process.versions.electron, chromium: process.versions.chrome },
      gates, rangeRows: rows, posterRows: posters, cancelRows: cancelled,
      agentMemoryDiagnostic: { startRSS: agentRssStart, endRSS: rss(agentProcess.child.pid) },
      medians: {
        originalCappedRangeBytes: median(rows.filter(x => !x.preview).map(x => x.rangeBytes)),
        preview480pBytes: median(rows.filter(x => x.asset.endsWith('-480p')).map(x => x.rangeBytes)),
        preview720pBytes: median(rows.filter(x => x.asset.endsWith('-720p')).map(x => x.rangeBytes)),
      },
      limitations: [
        'Real Postgres 17 Gin signed Preview Engine, production Go Agent IPC, Electron Main proxy/net.fetch and Chromium Renderer fetch',
        'Fixture contains pseudo bytes of measured encoded sizes, NOT decodable video; no first frame/HEVC/decode CPU conclusion',
        'No production transcoding directory, background worker generation, persistent short-preview cache or hover UI',
        'Loopback test environment, no remote WAN or physical device',
        'Baseline-only, no before/after latency optimization',
      ],
    }
    fs.writeFileSync(path.join(out, 'gallery-desktop-signed-video-proxy.json'),
      JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_DESKTOP_SIGNED_PROXY_REPORT ' +
      JSON.stringify({ gates, samples: { range: rows.length, posters: posters.length,
        abandoned: cancelled.length }, medians: report.medians }))
    assert(Object.values(gates).every(Boolean), 'Desktop signed proxy resource/cancel budget failed')
    complete = true
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    if (proxy) await proxy.close().catch(() => {})
    if (agent) await agent.shutdown().catch(() => {})
    await terminate(agentProcess)
    let fixtureExit = null
    if (fixture) {
      await fetch(fixture.url + '/__bench/stop', { method: 'POST' }).catch(() => {})
    }
    if (goFixture) {
      fixtureExit = await Promise.race([goFixture.exited, sleep(30000).then(() => null)])
      if (!fixtureExit) goFixture.child.kill('SIGKILL')
      goFixture.stream.end()
    }
    fs.rmSync(temp, { recursive: true, force: true })
    if (complete && (!fixtureExit || fixtureExit.code !== 0)) {
      throw new Error('Gin PostgreSQL fixture cleanup failed: ' + JSON.stringify(fixtureExit))
    }
  }
}

app.whenReady().then(async () => {
  try { await measure(); app.exit(0) }
  catch (err) { console.error(err.stack || String(err)); app.exit(1) }
})
