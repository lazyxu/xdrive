'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..', '..')
const output = path.join(root, 'desktop', 'gallery-desktop-real-cold-results')
const webDist = path.join(root, 'web', 'dist')
const agentBinary = path.resolve(root, process.env.XD_GALLERY_AGENT_BINARY || '')
const electronBinary = require('electron')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, reason) => { if (!condition) throw new Error(reason) }
const median = values => [...values].sort((a, b) => a - b)[1]
async function until(check, budgetMs, reason) {
  const start = Date.now()
  while (Date.now() - start < budgetMs) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error('timed out: ' + reason)
}
function rssBytes(pid) {
  try {
    const row = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
    return row ? Number(row[1]) * 1024 : null
  } catch { return null }
}
function launch(command, args, env, name, parseStdout = null, cwd = root) {
  const file = fs.createWriteStream(path.join(output, name + '.log'))
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let carry = ''
  child.stdout.on('data', chunk => {
    file.write(chunk)
    if (!parseStdout) return
    const lines = (carry + chunk.toString()).split('\n')
    carry = lines.pop()
    for (const line of lines) parseStdout(line)
  })
  child.stderr.pipe(file, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.once('exit', () => file.end())
  child.once('error', error => { file.write('PROCESS ERROR: ' + error.message + '\n') })
  return { child, exited }
}
async function stop(processInfo, graceMs = 6000) {
  if (!processInfo) return
  const { child, exited } = processInfo
  if (child.exitCode !== null) return exited
  const ended = await Promise.race([exited, delay(graceMs).then(() => null)])
  if (ended) return ended
  child.kill('SIGTERM')
  const stopped = await Promise.race([exited, delay(4000).then(() => null)])
  if (stopped) return stopped
  child.kill('SIGKILL')
  return exited
}
async function fixture(sample, dir) {
  const readyFile = path.join(dir, 'fixture-' + sample + '.json')
  const test = launch('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$',
    '-count=1', '-timeout=14m', '-v', './internal/api',
  ], {
    ...process.env,
    XD_GALLERY_REAL_WEB_COLD_PERF: '1',
    XD_GALLERY_REAL_WEB_READY_FILE: readyFile,
    XD_GALLERY_REAL_WEB_DIST: webDist,
  }, 'server-' + sample)
  try {
    const ready = await until(() => {
      if (test.child.exitCode !== null) throw new Error('real fixture exited before ready')
      return fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile, 'utf8')) : null
    }, 240000, '100k PostgreSQL Gin/CAS fixture')
    assert(ready.logical_assets === 100000 && ready.physical_nodes === 115000 &&
      ready.first_image_nodes >= 12 && ready.first_video_nodes > 0 &&
      ready.first_live_assets > 0, 'invalid real 100k/115k mixed-media fixture')
    return { test, ready }
  } catch (error) {
    test.child.kill('SIGTERM')
    await stop(test)
    throw error
  }
}
async function electronSample(sample, env) {
  let received = null
  const label = 'GALLERY_REAL_DESKTOP_ELECTRON_SAMPLE '
  // Entry lives at the REAL Desktop package root, so Electron app.getAppPath()
  // resolves the same assets/tray icon locations as production packaging.
  const desktopRoot = path.join(root, 'desktop')
  const bootstrap = path.join(desktopRoot, '.gallery-desktop-real-cold-entry.cjs')
  fs.writeFileSync(bootstrap, "require('./scripts/gallery-desktop-real-cold-electron-main.cjs')\n", { mode: 0o600 })
  const proc = launch(electronBinary, ['--no-sandbox', bootstrap], {
    ...process.env, ...env,
    XD_GALLERY_DESKTOP_REAL_SAMPLE: String(sample),
  }, 'electron-' + sample, line => {
    const pos = line.indexOf(label)
    if (pos >= 0) received = JSON.parse(line.slice(pos + label.length))
  }, desktopRoot)
  try {
    const end = await Promise.race([
      proc.exited, delay(100000).then(() => ({ code: 'timeout' })),
    ])
    assert(end.code === 0 && received?.realProductionDesktop,
      'real Electron did not produce a valid decoded 100k result: ' + JSON.stringify(end))
    return received
  } finally {
    await stop(proc)
    fs.rmSync(bootstrap, { force: true })
  }
}
async function oneSample(sample, ready, dir) {
  const configHome = path.join(dir, 'config-' + sample)
  const cacheHome = path.join(dir, 'cache-' + sample)
  fs.mkdirSync(configHome, { recursive: true })
  fs.mkdirSync(cacheHome, { recursive: true })
  const env = {
    XDG_CONFIG_HOME: configHome,
    XDG_CACHE_HOME: cacheHome,
    XD_DISABLE_SECRET_SERVICE: '1',
    XD_AGENT_PATH: agentBinary,
    XD_GALLERY_DESKTOP_REAL_SERVER_URL: ready.url,
  }
  const proc = launch(agentBinary, [], { ...process.env, ...env }, 'agent-' + sample)
  const discovery = path.join(configHome, 'xdrive', 'desktop-ipc.json')
  let client = null
  try {
    await until(() => {
      if (proc.child.exitCode !== null) throw new Error('Agent exited before IPC discovery')
      return fs.existsSync(discovery)
    }, 20000, 'production Go Agent IPC discovery')
    client = new AgentIPCClient(discovery)
    const hello = await client.hello()
    assert(hello.protocol_min <= 2 && hello.protocol_max >= 2, 'real Agent protocol mismatch')
    const status = await client.login({
      server: ready.url,
      username: 'gallery-web-cold-100k',
      password: 'browser-performance-password',
    })
    assert(status.configured && !status.must_change_password, 'Agent Gin login not configured')
    await client.setPaused(true)
    const agentRssBeforeBytes = rssBytes(proc.child.pid)
    // Actual source-agent PID lets the Electron benchmark sample renderer and
    // Agent resource ownership separately around post-first-paint progress.
    env.XD_GALLERY_DESKTOP_REAL_AGENT_PID = String(proc.child.pid)
    const result = await electronSample(sample, env)
    const agentRssAfterBytes = rssBytes(proc.child.pid)
    return {
      ...result,
      logicalItems: ready.logical_assets,
      physicalNodes: ready.physical_nodes,
      liveAssets: 15000,
      fixtureSeedMs: ready.seed_ms,
      agentRssBeforeBytes, agentRssAfterBytes,
      agentRssDeltaBytes: agentRssBeforeBytes === null || agentRssAfterBytes === null
        ? null : agentRssAfterBytes - agentRssBeforeBytes,
    }
  } finally {
    if (client) await client.shutdown().catch(() => {})
    await stop(proc)
  }
}
async function main() {
  assert(process.env.XD_TEST_DATABASE_URL, 'real PostgreSQL 17 URL required')
  assert(process.env.XD_GALLERY_AGENT_BINARY && fs.existsSync(agentBinary), 'production Agent binary missing')
  assert(fs.existsSync(path.join(webDist, 'index.html')), 'fixture Web dist missing')
  assert(fs.existsSync(path.join(root, 'desktop', 'dist', 'main', 'index.cjs')), 'real Main missing')
  assert(fs.existsSync(path.join(root, 'desktop', 'dist', 'preload', 'index.cjs')), 'real preload missing')
  assert(fs.existsSync(path.join(root, 'desktop', 'dist', 'renderer', 'index.html')), 'real renderer missing')
  fs.mkdirSync(output, { recursive: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-desktop-real-100k-'))
  const samples = []
  try {
    for (let sample = 1; sample <= 3; sample++) {
      const server = await fixture(sample, dir)
      try {
        const result = await oneSample(sample, server.ready, dir)
        assert(result.logicalItems === 100000 && result.physicalNodes === 115000 &&
          result.renderer.decodedImages >= 12 &&
          result.renderer.mountedTiles < 1000, 'real Desktop 100k result incorrect')
        if (process.env.XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE === '1') {
          const probe = result.sourceExactMediaProgress
          assert(probe && probe.sourceCount === 100000 &&
            probe.observedTransfers === 3 && probe.noObserverTransfers === 3 &&
            probe.realObserverEvents >= 6 && probe.totalVerifiedObservedBytes > 0 &&
            probe.rows.length === 6 && probe.pairs.length === 3,
            'real Desktop progress probe failed to traverse Renderer/Preload/Main/Agent')
          assert(probe.rows.every(row => row.bodyBytes > 0 && (
            row.mode === 'on'
              ? row.callbackCount >= 2 && row.firstReportedBytes === 0 &&
                row.lastReportedBytes === row.bodyBytes &&
                (row.lastReportedTotal === null || row.lastReportedTotal === row.bodyBytes)
              : row.callbackCount === 0 && row.lastReportedBytes === null)),
            'false, missing or incompatible Desktop progress byte callbacks')
          assert(probe.pairs.every(pair => pair.bodyBytes > 0 &&
            Number.isFinite(pair.offMs) && Number.isFinite(pair.onMs)),
            'Desktop ON/OFF do not refer to the same actual source bytes')
          assert(result.sourceProgressResources?.before?.renderer &&
            result.sourceProgressResources?.after?.renderer &&
            result.sourceProgressResources?.before?.agent &&
            result.sourceProgressResources?.after?.agent,
            'actual Desktop renderer/Agent CPU and RSS boundary was not measured')
        }
        samples.push(result)
        console.log('GALLERY_REAL_DESKTOP_COLD_100K_SAMPLE ' + JSON.stringify(result))
      } finally {
        await fetch(server.ready.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const finish = await Promise.race([
          server.test.exited, delay(30000).then(() => ({ code: 'timeout' })),
        ])
        if (finish.code !== 0) {
          server.test.child.kill('SIGTERM')
          await stop(server.test)
          throw new Error('real 100k Gin fixture stopped abnormally: ' + JSON.stringify(finish))
        }
      }
    }
    const probeEnabled = process.env.XD_GALLERY_DESKTOP_MEDIA_PROGRESS_PROBE === '1'
    const desktopProgressRows = probeEnabled
      ? samples.flatMap(row => row.sourceExactMediaProgress.rows) : []
    const progressMedians = probeEnabled
      ? Object.fromEntries(['off', 'on'].map(mode => [mode, {
          count: desktopProgressRows.filter(row => row.mode === mode).length,
          elapsedP50Ms: [...desktopProgressRows.filter(row => row.mode === mode)
            .map(row => row.elapsedMs)].sort((a, b) => a - b)[4],
          actualBodyBytes: desktopProgressRows.filter(row => row.mode === mode)
            .reduce((total, row) => total + row.bodyBytes, 0),
          callbackEvents: desktopProgressRows.filter(row => row.mode === mode)
            .reduce((total, row) => total + row.callbackCount, 0),
        }])) : null
    const report = {
      name: 'gallery-desktop-real-main-renderer-100k',
      status: probeEnabled
        ? 'measured-real-Desktop-Renderer-Main-Agent-progress-post-first-paint'
        : 'measured-baseline-only-no-production-optimization',
      samples, n: samples.length,
      progressProbeEnabled: probeEnabled,
      progressMedians,
      progressPairCount: probeEnabled ? samples.reduce(
        (sum, row) => sum + row.sourceExactMediaProgress.pairs.length, 0) : 0,
      medianClickToFirstDecodedPaintMs: median(samples.map(x => x.renderer.firstImageTwoRAFMs)),
      medianClickToFirst12DecodedMs: median(samples.map(x => x.renderer.first12DecodedTwoRAFMs)),
      worstLongTaskMs: Math.max(...samples.map(x => x.renderer.longestLongTaskMs)),
      scope: 'Real Electron Desktop App (Main/preload/Renderer) to Agent IPC, Gin/PostgreSQL/CAS and HTMLImageElement.decode. Browser activation, not complete process cold launch.',
      exclusions: 'Fixture seeding, process boot, cross-network, real 4K video codec, physical Windows, peak RSS and actual GPU present timestamp. Progress probe tests real source-exact 3 JPEG thumbnail IPC ON/OFF pairs per 100k session AFTER decoded Gallery, not rapid viewport scroll cancellation or RAW-HD.',
    }
    assert(report.n === 3, 'three fresh real Desktop samples required')
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_REAL_DESKTOP_COLD_100K_REPORT ' + JSON.stringify(report))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1 })
