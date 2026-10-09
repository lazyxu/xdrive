'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')

const root = path.resolve(__dirname, '..', '..')
const out = path.resolve(__dirname, '..', 'gallery-agent-ipc-100k-results')
const webDist = path.join(root, 'web', 'dist')
const samples = 3
const maxWaitMs = 240000
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (ok, reason) => { if (!ok) throw new Error(reason) }
const p50 = values => [...values].sort((a, b) => a - b)[1]
function rssBytes(pid) {
  try {
    const match = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
    return match ? Number(match[1]) * 1024 : null
  } catch { return null }
}
async function until(check, budget, message) {
  const started = Date.now()
  while (Date.now() - started < budget) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error('timed out: ' + message)
}

async function serveSample(sample, ready) {
  const serverLog = fs.createWriteStream(path.join(out, 'postgres-gin-sample-' + sample + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$',
    '-count=1', '-timeout=14m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF: '1',
      XD_GALLERY_REAL_WEB_READY_FILE: ready,
      XD_GALLERY_REAL_WEB_DIST: webDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(serverLog, { end: false })
  child.stderr.pipe(serverLog, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const config = await until(async () => {
    if (child.exitCode !== null) {
      throw new Error('real Gin server stopped before fixture was ready, exit=' + child.exitCode)
    }
    if (!fs.existsSync(ready)) return null
    return JSON.parse(fs.readFileSync(ready, 'utf8'))
  }, maxWaitMs, '100k PostgreSQL fixture start')
  return { child, exited, config, serverLog }
}


async function agentSample(sample, fixture, tempDir) {
  const configRoot = path.join(tempDir, 'agent-config-' + sample)
  const cacheRoot = path.join(tempDir, 'agent-cache-' + sample)
  fs.mkdirSync(configRoot, { recursive: true })
  fs.mkdirSync(cacheRoot, { recursive: true })
  const log = fs.createWriteStream(path.join(out, 'agent-' + sample + '.log'))
  const agent = spawn(process.env.XD_GALLERY_AGENT_BINARY, [], {
    cwd: root,
    env: {
      ...process.env, XDG_CONFIG_HOME: configRoot,
      XDG_CACHE_HOME: cacheRoot, XD_DISABLE_SECRET_SERVICE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  agent.stdout.pipe(log, { end: false })
  agent.stderr.pipe(log, { end: false })
  const exited = new Promise(resolve => agent.once('exit', (code, signal) => resolve({ code, signal })))
  const discovery = path.join(configRoot, 'xdrive', 'desktop-ipc.json')
  let client = null
  try {
    await until(() => {
      if (agent.exitCode !== null) throw new Error('Agent exited before IPC discovery')
      return fs.existsSync(discovery)
    }, 20000, 'production Agent IPC discovery')
    client = new AgentIPCClient(discovery)
    const hello = await client.hello()
    assert(hello.protocol_min <= 2 && hello.protocol_max >= 2, 'Agent IPC protocol mismatch')
    const status = await client.login({
      server: fixture.url,
      username: 'gallery-web-cold-100k',
      password: 'browser-performance-password',
    })
    assert(status.configured && !status.must_change_password, 'Agent failed real Gin login')
    await client.setPaused(true)
    const rssBefore = rssBytes(agent.pid)
    const start = performance.now()
    const page = await client.mediaItemRange('', 100, 0, {})
    const firstRangeMs = performance.now() - start
    assert(page.total_count === 100000 && page.offset === 0 &&
      page.items?.length === 100, 'Agent failed real 100k range integrity')
    const images = page.items.filter(item => item.metadata?.media_kind === 'image').slice(0, 12)
    const videos = page.items.filter(item => item.metadata?.media_kind === 'video')
    const lives = page.items.filter(item => item.live_photo || item.asset_kind === 'live_photo')
    assert(images.length === 12 && videos.length > 0 && lives.length > 0,
      'real 100k first page must contain 12 images, video and Live Photo')
    let firstThumbMs = null
    let transferredThumbnailBytes = 0
    let thumbnailCount = 0
    const thumbStart = performance.now()
    for (let offset = 0; offset < images.length; offset += 6) {
      await Promise.all(images.slice(offset, offset + 6).map(async item => {
        const response = await client.mediaThumbnail(item.node.id, undefined, item.node.revision)
        assert(response.data?.byteLength > 0 && response.content_type?.startsWith('image/'),
          'Agent returned no real image thumbnail')
        thumbnailCount++
        transferredThumbnailBytes += response.data.byteLength
        if (firstThumbMs === null) firstThumbMs = performance.now() - thumbStart
      }))
    }
    const first12Ms = performance.now() - thumbStart
    const warmStart = performance.now()
    await Promise.all(images.map(async item => {
      const result = await client.mediaThumbnail(item.node.id, undefined, item.node.revision)
      assert(result.data?.byteLength > 0, 'warm Agent thumbnail unavailable')
    }))
    const warm12Ms = performance.now() - warmStart
    assert(thumbnailCount === 12 && transferredThumbnailBytes > 0, 'missing 12 real JPEG payloads')
    const statsResponse = await fetch(fixture.url + '/__perf/stats')
    assert(statsResponse.ok, 'real CAS counters unavailable')
    const storeStats = await statsResponse.json()
    const rssAfter = rssBytes(agent.pid)
    return {
      sample, logicalItems: page.total_count, physicalNodes: fixture.physical_nodes,
      firstPageItems: page.items.length, videosInPage: videos.length, liveInPage: lives.length,
      firstRangeMs, firstThumbnailMs: firstThumbMs, first12ThumbnailsMs: first12Ms,
      warm12ThumbnailsMs: warm12Ms, thumbnailCount, thumbnailBytes: transferredThumbnailBytes,
      agentRssStartBytes: rssBefore, agentRssEndBytes: rssAfter,
      agentRssDeltaBytes: rssBefore !== null && rssAfter !== null ? rssAfter - rssBefore : null,
      storeStats, seedMs: fixture.seed_ms,
      label: 'Go Agent IPC/Go client/Gin/PostgreSQL/CAS; no renderer or decode',
    }
  } finally {
    if (client) await client.shutdown().catch(() => {})
    const result = await Promise.race([exited, delay(6000).then(() => null)])
    if (!result) {
      agent.kill('SIGTERM')
      const stopped = await Promise.race([exited, delay(4000).then(() => null)])
      if (!stopped) { agent.kill('SIGKILL'); await exited }
    }
    log.end()
  }
}
async function main() {
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL 17 URL required')
  assert(process.env.XD_GALLERY_AGENT_BINARY && fs.existsSync(process.env.XD_GALLERY_AGENT_BINARY),
    'production-built Agent binary required')
  assert(fs.existsSync(path.join(webDist, 'index.html')), 'real Go fixture needs built Web dist')
  fs.mkdirSync(out, { recursive: true })
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-agent-real-cold-'))
  const results = []
  try {
    for (let sample = 1; sample <= samples; sample++) {
      const ready = path.join(tempDir, 'ready-' + sample + '.json')
      const server = await serveSample(sample, ready)
      try {
        assert(server.config.logical_assets === 100000 && server.config.physical_nodes === 115000,
          'native PostgreSQL 100k fixture was not built')
        assert(server.config.first_image_nodes >= 12 &&
          server.config.first_video_nodes > 0 && server.config.first_live_assets > 0,
          'mixed first viewport missing')
        const result = await agentSample(sample, server.config, tempDir)
        results.push(result)
        console.log('GALLERY_REAL_AGENT_IPC_100K_SAMPLE ' + JSON.stringify(result))
      } finally {
        await fetch(server.config.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const ended = await Promise.race([
          server.exited, delay(30000).then(() => ({ code: 'timeout' })),
        ])
        if (ended.code !== 0) {
          server.child.kill('SIGTERM')
          throw new Error('real Gin fixture exit failed: ' + JSON.stringify(ended))
        }
        server.serverLog.end()
      }
    }
    const summary = {
      name: 'gallery-agent-ipc-real-100k',
      status: 'measured-baseline-no-production-change',
      n: results.length,
      samples: results,
      medianFirstAgentRangeMs: p50(results.map(x => x.firstRangeMs)),
      medianFirst12ThumbnailMs: p50(results.map(x => x.first12ThumbnailsMs)),
      medianWarm12ThumbnailMs: p50(results.map(x => x.warm12ThumbnailsMs)),
      integrityPassed: results.length === 3 && results.every(x =>
        x.logicalItems === 100000 && x.physicalNodes === 115000 && x.thumbnailCount === 12),
      limits: 'Real independent Go Agent IPC/Go client/Gin/Postgres/CAS, n=3. No Electron Renderer/Main IPC, image decode/paint, WAN, physical devices or peak RSS.',
    }
    assert(summary.integrityPassed, '100k actual Agent IPC benchmark integrity failure')
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('GALLERY_REAL_AGENT_IPC_100K_REPORT ' + JSON.stringify(summary))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
main().catch(err => { console.error(err.stack || String(err)); process.exitCode = 1 })
