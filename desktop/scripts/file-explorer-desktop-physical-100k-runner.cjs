'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')
const electron = require('electron')

const root = path.resolve(__dirname, '../..')
const desktop = path.join(root, 'desktop')
const apiBinary = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_API_BINARY || '')
const agentBinary = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_AGENT_BINARY || '')
const resultRoot = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_RESULTS ||
  path.join(desktop, 'file-explorer-desktop-physical-100k-results'))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
async function until(fn, budget, label) {
  const start = performance.now()
  while (performance.now() - start < budget) {
    const current = await fn()
    if (current) return current
    await delay(100)
  }
  throw Error('timeout waiting for ' + label)
}
function rss(pid) {
  try {
    const match = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
    return match ? Number(match[1]) * 1024 : null
  } catch { return null }
}
function launch(binary, args, env, label, cwd = root) {
  const log = fs.createWriteStream(path.join(resultRoot, label + '.log'))
  const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.on('error', error => log.write('SPAWN_ERROR ' + error + '\n'))
  const exited = new Promise(resolve => child.once('exit', (code, signal) => {
    log.end()
    resolve({ code, signal })
  }))
  return { child, exited }
}
async function stop(proc, budget = 6000) {
  if (!proc) return null
  if (proc.child.exitCode !== null) return proc.exited
  let result = await Promise.race([proc.exited, delay(budget).then(() => null)])
  if (result) return result
  proc.child.kill('SIGTERM')
  result = await Promise.race([proc.exited, delay(5000).then(() => null)])
  if (result) return result
  proc.child.kill('SIGKILL')
  return proc.exited
}
async function realFixture(sample, temp) {
  const readyFile = path.join(temp, 'fixture-' + sample + '.json')
  const proc = launch(apiBinary, [
    '-test.run=^TestFileExplorerRealWebScrollCancelFixture100K$',
    '-test.count=1', '-test.timeout=25m', '-test.v',
  ], {
    ...process.env,
    XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF: '1',
    XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF: '1',
    XD_FILEEXPLORER_REAL_WEB_DIST: path.join(root, 'web', 'dist'),
    XD_FILEEXPLORER_REAL_WEB_READY_FILE: readyFile,
  }, 'fixture-' + sample)
  try {
    const ready = await until(() => {
      if (proc.child.exitCode !== null) throw Error('compiled actual Gin 100k fixture ended before ready')
      return fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile, 'utf8')) : null
    }, 15 * 60_000, '100k unique actually encoded JPEGs in PostgreSQL/CAS')
    assert.equal(ready.logical_count, 100000)
    assert.equal(ready.physical_images, 100000)
    assert.equal(ready.physical_mode, true)
    assert(ready.physical_source_bytes > 50000000, 'not 100k actual physical source bytes')
    return { proc, ready }
  } catch (error) {
    await stop(proc, 500)
    throw error
  }
}
async function actualAgent(sample, server, temp) {
  const config = path.join(temp, 'agent-config-' + sample)
  const cache = path.join(temp, 'agent-cache-' + sample)
  fs.mkdirSync(config, { recursive: true })
  fs.mkdirSync(cache, { recursive: true })
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XD_DISABLE_SECRET_SERVICE: '1',
    XD_AGENT_PATH: agentBinary,
  }
  const proc = launch(agentBinary, [], env, 'agent-' + sample)
  const discover = path.join(config, 'xdrive', 'desktop-ipc.json')
  let client
  try {
    await until(() => {
      if (proc.child.exitCode !== null) throw Error('production Agent died before IPC discovery')
      return fs.existsSync(discover)
    }, 30_000, 'real Go Agent discovery')
    client = new AgentIPCClient(discover)
    const hello = await client.hello()
    assert(hello.protocol_min <= 2 && hello.protocol_max >= 2, 'actual IPC Agent protocol mismatch')
    const state = await client.login({
      server: server.url,
      username: 'file-explorer-real-scroll-perf',
      password: 'password',
    })
    assert(state.configured && !state.must_change_password, 'real Desktop Agent auth failed')
    await client.setPaused(true)
    const rootNode = await client.cloudRoot()
    const page = await client.cloudChildrenPage(rootNode.id, { limit: 10 })
    assert(page.items?.some(node => node.name === '100k Images'),
      'real authenticated Agent did not list seeded 100k child folder')
    return { proc, client, env }
  } catch (error) {
    if (client) await client.shutdown().catch(() => {})
    await stop(proc, 1000)
    throw error
  }
}
async function electronWindow(sample, mode, fixture, agent) {
  const bootstrap = path.join(desktop, '.file-explorer-desktop-physical-100k-entry.cjs')
  const json = path.join(resultRoot, 'sample-' + sample + '-' + mode + '.json')
  fs.writeFileSync(bootstrap,
    "require('./scripts/file-explorer-desktop-physical-100k-electron-main.cjs')\n",
    { mode: 0o600 })
  const proc = launch(electron, ['--no-sandbox', bootstrap], {
    ...agent.env,
    XD_FILEEXPLORER_DESKTOP_PHYSICAL_SAMPLE: String(sample),
    XD_FILEEXPLORER_DESKTOP_PHYSICAL_VIEW: mode,
    XD_FILEEXPLORER_DESKTOP_PHYSICAL_URL: fixture.url,
    XD_FILEEXPLORER_DESKTOP_PHYSICAL_OUTPUT: json,
  }, 'electron-' + sample + '-' + mode, desktop)
  try {
    const finished = await Promise.race([proc.exited, delay(5 * 60_000).then(() => ({ code: 'timeout' }))])
    assert.equal(finished.code, 0, 'authentic Desktop ' + mode + ' process failed: ' + JSON.stringify(finished))
    assert(fs.existsSync(json), 'real Desktop result JSON missing')
    const result = JSON.parse(fs.readFileSync(json, 'utf8'))
    assert(result.passed && result.productionDesktop && result.view === mode &&
      result.sample === sample, 'Desktop original-product viewport benchmark RED')
    return result
  } finally {
    await stop(proc, 1500)
    fs.rmSync(bootstrap, { force: true })
  }
}
async function main() {
  assert.equal(process.env.XD_FILEEXPLORER_DESKTOP_PHYSICAL_100K_PERF, '1',
    'explicit opt-in benchmark flag required')
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL17 missing')
  assert(fs.existsSync(apiBinary) && fs.existsSync(agentBinary), 'compiled Go fixture / authentic Agent absent')
  for (const rel of ['web/dist/index.html', 'desktop/dist/main/index.cjs',
    'desktop/dist/preload/index.cjs', 'desktop/dist/renderer/index.html']) {
    assert(fs.existsSync(path.join(root, rel)), 'built production file missing: ' + rel)
  }
  fs.mkdirSync(resultRoot, { recursive: true })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-desktop-100k-physical-'))
  const rows = []
  try {
    for (let sample = 1; sample <= 3; sample++) {
      const { proc, ready } = await realFixture(sample, temp)
      let agent = null
      try {
        agent = await actualAgent(sample, ready, temp)
        for (const mode of ['grid', 'details']) {
          const agentBefore = rss(agent.proc.child.pid)
          const goBefore = rss(proc.child.pid)
          const view = await electronWindow(sample, mode, ready, agent)
          const agentAfter = rss(agent.proc.child.pid)
          const goAfter = rss(proc.child.pid)
          const row = {
            ...view, fixtureSeedMs: ready.seed_ms, persistedPhysicalOriginalBytes: ready.physical_source_bytes,
            agentRssGrowthBytes: agentBefore === null || agentAfter === null
              ? null : Math.max(0, agentAfter - agentBefore),
            goRssGrowthBytes: goBefore === null || goAfter === null
              ? null : Math.max(0, goAfter - goBefore),
          }
          row.passed = row.passed &&
            row.agentRssGrowthBytes !== null && row.agentRssGrowthBytes <= 268435456 &&
            row.goRssGrowthBytes !== null && row.goRssGrowthBytes <= 268435456
          rows.push(row)
          fs.writeFileSync(path.join(resultRoot, 'sample-' + sample + '-' + mode + '.json'),
            JSON.stringify(row, null, 2) + '\n')
          console.log('FILEEXPLORER_DESKTOP_100K_VIEW ' + JSON.stringify(row))
          assert(row.passed, 'actual Desktop/Go Agent RSS performance budget RED')
        }
      } finally {
        if (agent) { await agent.client.shutdown().catch(() => {}); await stop(agent.proc) }
        await fetch(ready.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const closed = await Promise.race([proc.exited, delay(40_000).then(() => null)])
        if (!closed) await stop(proc, 500)
        else assert.equal(closed.code, 0, 'original 100k CAS server fixture failed')
      }
    }
    const summary = {
      status: 'CURRENT baseline only, no production optimization, AFTER=N/A',
      name: 'P035/M002-a Desktop FileExplorer 100k distinct physical JPEG originals n3, Grid/Details x 5',
      fixtures: 3, modes: ['grid', 'details'], fractions: [0, .25, .5, .75, .95],
      physicalJPEGOriginalsPerFixture: 100000,
      gridP50Ms: median(rows.filter(x => x.view === 'grid').map(x => x.viewportFirstSixP50Ms)),
      detailsP50Ms: median(rows.filter(x => x.view === 'details').map(x => x.viewportFirstSixP50Ms)),
      maxRendererGrowthBytes: Math.max(...rows.map(x => x.rendererWorkingSetGrowthBytes)),
      maxAgentRssGrowthBytes: Math.max(...rows.map(x => x.agentRssGrowthBytes)),
      maxGoRssGrowthBytes: Math.max(...rows.map(x => x.goRssGrowthBytes)),
      samples: rows,
      passed: rows.length === 6 && rows.every(x => x.passed),
      exclusions: 'Actual Desktop only; no H264/HEVC/RAW/LIVP, WAN, 4GiB, full 100k decode, true Go cancel timing or Race changes',
    }
    fs.writeFileSync(path.join(resultRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('FILEEXPLORER_DESKTOP_100K_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed, 'unchanged production Desktop original CURRENT performance budget RED')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error('FILEEXPLORER_DESKTOP_100K_ERROR ' + (error?.stack || String(error))); process.exitCode = 1 })
