'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')
const electron = require('electron')
const root = path.resolve(__dirname, '../..')
const desktop = path.join(root, 'desktop')
const apiBinary = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_CANCEL_API_BINARY || '')
const agentBinary = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_CANCEL_AGENT_BINARY || '')
const results = path.resolve(process.env.XD_FILEEXPLORER_DESKTOP_CANCEL_RESULTS ||
  path.join(desktop, 'file-explorer-desktop-go-cancel-100k-results'))
const modes = ['virtual-scroll', 'app-switch', 'window-destroy']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, budgetMs, label) {
  const began = performance.now()
  while (performance.now() - began < budgetMs) {
    const value = await check()
    if (value) return value
    await sleep(75)
  }
  throw Error('timeout ' + label)
}
function rss(pid) {
  const match = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
  assert(match, 'real native Agent RSS unavailable')
  return Number(match[1]) * 1024
}
function launch(binary, args, env, label, cwd = root) {
  const log = fs.createWriteStream(path.join(results, label + '.log'))
  const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  child.once('error', e => log.write('SPAWN_ERROR ' + String(e) + '\n'))
  const finished = new Promise(resolve => child.once('exit', (code, signal) => {
    log.end(); resolve({ code, signal })
  }))
  return { child, finished }
}
async function stop(proc, budgetMs = 5000) {
  if (!proc) return null
  if (proc.child.exitCode !== null) return proc.finished
  let result = await Promise.race([proc.finished, sleep(budgetMs).then(() => null)])
  if (result) return result
  proc.child.kill('SIGTERM')
  result = await Promise.race([proc.finished, sleep(5000).then(() => null)])
  if (result) return result
  proc.child.kill('SIGKILL')
  return proc.finished
}
async function nativeFixture(sample, tmp) {
  const readyPath = path.join(tmp, 'ready-' + sample + '.json')
  const proc = launch(apiBinary, [
    '-test.run=^TestFileExplorerRealWebScrollCancelFixture100K$',
    '-test.count=1', '-test.timeout=20m', '-test.v',
  ], {
    ...process.env,
    XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF: '1',
    XD_FILEEXPLORER_REAL_WEB_DIST: path.join(root, 'web', 'dist'),
    XD_FILEEXPLORER_REAL_WEB_READY_FILE: readyPath,
  }, 'fixture-' + sample)
  try {
    const ready = await until(() => {
      if (proc.child.exitCode !== null) throw Error('actual Gin fixture ended before ready')
      return fs.existsSync(readyPath) ? JSON.parse(fs.readFileSync(readyPath, 'utf8')) : null
    }, 12 * 60 * 1000, 'genuine 100k Node/PostgreSQL fixture')
    assert.equal(ready.logical_count, 100000)
    assert.equal(ready.physical_images, 16)
    assert(ready.folder_id > 0 && ready.url, 'real folder or Server missing')
    return { proc, ready }
  } catch (error) { await stop(proc, 1000); throw error }
}
async function nativeAgent(sample, ready, tmp) {
  const config = path.join(tmp, 'agent-config-' + sample)
  const cache = path.join(tmp, 'agent-cache-' + sample)
  fs.mkdirSync(config, { recursive: true }); fs.mkdirSync(cache, { recursive: true })
  const env = { ...process.env, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache,
    XD_DISABLE_SECRET_SERVICE: '1', XD_AGENT_PATH: agentBinary }
  const proc = launch(agentBinary, [], env, 'agent-' + sample)
  const discover = path.join(config, 'xdrive', 'desktop-ipc.json')
  let client
  try {
    await until(() => {
      if (proc.child.exitCode !== null) throw Error('actual Agent died before IPC discovery')
      return fs.existsSync(discover)
    }, 30000, 'production Agent discovery')
    client = new AgentIPCClient(discover)
    const hello = await client.hello()
    assert(hello.protocol_min <= 2 && hello.protocol_max >= 2, 'Agent IPC protocol mismatch')
    const login = await client.login({ server: ready.url,
      username: 'file-explorer-real-scroll-perf', password: 'password' })
    assert(login.configured && !login.must_change_password, 'real Agent login failed')
    await client.setPaused(true)
    const cloud = await client.cloudRoot()
    const page = await client.cloudChildrenPage(cloud.id, { limit: 10 })
    assert(page.items?.some(node => node.name === '100k Images'), 'seeded folder missing in Agent')
    return { proc, client, env, rootID: cloud.id }
  } catch (error) {
    if (client) await client.shutdown().catch(() => {})
    await stop(proc, 1000); throw error
  }
}
async function electronMode(sample, mode, ready, agent) {
  const bootstrap = path.join(desktop, '.file-explorer-desktop-go-cancel-p037-entry.cjs')
  const filename = path.join(results, 'sample-' + sample + '-' + mode + '.json')
  fs.writeFileSync(bootstrap, "require('./scripts/file-explorer-desktop-go-cancel-100k-electron-main.cjs')\n", { mode: 0o600 })
  const proc = launch(electron, ['--no-sandbox', bootstrap], {
    ...agent.env, XD_FILEEXPLORER_DESKTOP_GO_CANCEL_SAMPLE: String(sample),
    XD_FILEEXPLORER_DESKTOP_GO_CANCEL_MODE: mode,
    XD_FILEEXPLORER_DESKTOP_GO_CANCEL_SERVER: ready.url,
    XD_FILEEXPLORER_DESKTOP_GO_CANCEL_OUTPUT: filename,
  }, 'electron-' + sample + '-' + mode, desktop)
  try {
    const result = await Promise.race([proc.finished, sleep(150000).then(() => ({ code: 'timeout' }))])
    assert.equal(result.code, 0, 'real Desktop cancellation Electron failed ' + JSON.stringify({sample,mode,result}))
    assert(fs.existsSync(filename), 'real Electron benchmark row file missing')
    const row = JSON.parse(fs.readFileSync(filename, 'utf8'))
    assert(row.passed && row.mode === mode && row.sample === sample,
      'unchanged product Desktop FileExplorer cancellation budget RED')
    return row
  } finally {
    await stop(proc, 1000)
    fs.rmSync(bootstrap, { force: true })
  }
}
async function main() {
  assert.equal(process.env.XD_FILEEXPLORER_DESKTOP_GO_CANCEL_100K_PERF, '1', 'explicit P037 opt-in flag required')
  assert(process.env.XD_TEST_DATABASE_URL, 'real PostgreSQL17 DSN required')
  assert(fs.existsSync(apiBinary) && fs.existsSync(agentBinary), 'compiled Go Gin/Agent binaries required')
  for (const name of ['web/dist/index.html', 'desktop/dist/main/index.cjs',
    'desktop/dist/preload/index.cjs', 'desktop/dist/renderer/index.html']) {
    assert(fs.existsSync(path.join(root, name)), 'missing production Desktop/Web build ' + name)
  }
  fs.mkdirSync(results, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-explorer-desktop-go-cancel-p037-'))
  const rows = []
  try {
    for (let n = 1; n <= 3; n++) {
      const fixture = await nativeFixture(n, tmp)
      let agent
      try {
        agent = await nativeAgent(n, fixture.ready, tmp)
        const beforeRSS = rss(agent.proc.child.pid)
        for (const mode of modes) {
          const row = await electronMode(n, mode, fixture.ready, agent)
          const page = await agent.client.cloudChildrenRange(fixture.ready.folder_id,
            50000, 200, 'name', 'asc', true)
          assert.equal(page.total_count, 100000, 'independent new Agent 100k range failed')
          assert.equal(page.items?.length, 200, 'independent new Agent page unavailable')
          row.recovery = { totalCount: page.total_count, returned: page.items.length }
          rows.push(row)
          fs.writeFileSync(path.join(results, 'sample-' + n + '-' + mode + '.json'),
            JSON.stringify(row, null, 2) + '\n')
        }
        const agentGrowth = Math.max(0, rss(agent.proc.child.pid) - beforeRSS)
        assert(agentGrowth <= 128*1024*1024, 'Go Agent post-seed RSS >128MiB')
        for (const row of rows.filter(x => x.sample === n)) row.agentRssGrowthBytes = agentGrowth
      } finally {
        if (agent) { await agent.client.shutdown().catch(() => {}); await stop(agent.proc) }
        await fetch(fixture.ready.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const end = await Promise.race([fixture.proc.finished, sleep(40000).then(() => null)])
        if (!end) await stop(fixture.proc, 1000)
        else assert.equal(end.code, 0, 'real fixture did not exit cleanly')
      }
    }
    const summary = {
      id: 'P037/M005-fileexplorer-desktop-real-100k-request-cancel',
      status: 'Measured CURRENT only, no product change, AFTER=N/A',
      platform: 'native Linux Xvfb Electron Renderer/Preload/Main -> Go Agent -> Gin/PG17/CAS',
      fixtures: 3, modes, cases: rows.length,
      logicalFiles: 100000, realPhysicalJPEGsPerFixture: 16,
      started: rows.reduce((n, x) => n + x.startedRequests, 0),
      actualGoContextDone: rows.reduce((n, x) => n + x.contextDone, 0),
      canceledHandlers: rows.reduce((n, x) => n + x.cancelledHandlers, 0),
      wastedOldBytes: rows.reduce((n, x) => n + x.wastedBytesAfterAction, 0),
      worstGoNotificationMs: Math.max(...rows.map(x => x.worstGoContextNotificationMs)),
      maxAgentRssGrowthBytes: Math.max(...rows.map(x => x.agentRssGrowthBytes || 0)),
      results: rows,
      budgets: { cases: 9, expectedStartedPerCase: 6, expectedContextDonePerCase: 6,
        maxNotificationMs: 160, activeOldHandlersAt160ms: 0, staleBytesAt160ms: 0,
        agentRssGrowthMaxBytes: 134217728, recoveredPage: 200, totalRange: 100000 },
      passed: rows.length === 9 && rows.every(x => x.passed && x.recovery?.totalCount === 100000 &&
        x.recovery?.returned === 200 && x.startedRequests === 6 && x.contextDone === 6 &&
        x.cancelledHandlers === 6 && x.stillActiveHandlersAt160ms === 0 &&
        x.wastedBytesAfterAction === 0 && x.worstGoContextNotificationMs <= 160 &&
        x.agentRssGrowthBytes <= 134217728),
      exclusions: 'Actual 100k Node metadata but only 16 actual JPEG original files; no 100k physical image decode, H264/Live/RAW/HEVC, physical Windows, WAN, durable task cancellation or Race proof',
    }
    fs.writeFileSync(path.join(results, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('FILEEXPLORER_DESKTOP_GO_CANCEL_100K_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed, 'authentic P037 Desktop FileExplorer 100k cancellation baseline is RED')
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
main().catch(error => {
  console.error('FILEEXPLORER_DESKTOP_GO_CANCEL_100K_RUNNER_ERROR ' + (error?.stack || String(error)))
  process.exitCode = 1
})
