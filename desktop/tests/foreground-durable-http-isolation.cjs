'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
function loadSource(file, requireFn = require) {
  const code = fs.readFileSync(path.join(root, file), 'utf8')
  const js = ts.transpileModule(code, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', js)(mod.exports, mod, requireFn)
  return mod.exports
}
const coordinatorFile = 'ui/shared/src/mui/ViewerForegroundPriority.ts'
const bus = loadSource(coordinatorFile)
const { XDriveMediaThumbnailScheduler } = loadSource(
  'ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts',
  name => name === './ViewerForegroundPriority' ? bus : require(name),
)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return
    await sleep(5)
  }
  assert.fail('timed out: ' + label)
}

async function fixture() {
  const media = [], durable = []
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/thumb/')) {
      const item = { res, id: Number(req.url.split('/').at(-1)), earlyClosed: false, bytes: 0 }
      media.push(item)
      res.once('close', () => { item.earlyClosed = !res.writableEnded })
      return // hold the old thumbnail bodies until preemption releases their sockets
    }
    if (req.url?.startsWith('/durable/')) {
      const item = { res, name: req.url.slice('/durable/'.length), earlyClosed: false }
      durable.push(item)
      res.once('close', () => { item.earlyClosed = !res.writableEnded })
      req.resume()
      return // intentionally keep durable jobs in flight across every transition
    }
    res.writeHead(404); res.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    media, durable,
    url: 'http://127.0.0.1:' + server.address().port,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

async function trial(platform) {
  const s = await fixture()
  bus.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage(platform + ':files')
  const scheduler = new XDriveMediaThumbnailScheduler(async (id, signal) => {
    const result = await fetch(s.url + '/thumb/' + id, { signal })
    await result.arrayBuffer()
    return 'blob:thumb-' + id
  }, { concurrency: 6, revokeURL: () => {} })
  const transfers = [
    { name: 'upload', method: 'POST' },
    { name: 'download', method: 'GET' },
    { name: 'backup', method: 'POST' },
    { name: 'sync', method: 'POST' },
  ].map(spec => ({ ...spec, controller: new AbortController() }))
  let finish = null
  try {
    const stale = Array.from({ length: 6 }, (_, index) => scheduler.load(index + 1, 0, 1))
    const live = transfers.map(async transfer => {
      const response = await fetch(s.url + '/durable/' + transfer.name, {
        method: transfer.method,
        ...(transfer.method === 'POST' ? { body: 'persistent-user-operation' } : {}),
        signal: transfer.controller.signal,
      })
      assert.equal(response.status, 200)
      return response.text()
    })
    await until(() => s.media.length === 6 && s.durable.length === 4,
      platform + ': six thumbnail GETs and four real persistent HTTP operations')

    // Files directory A -> B is a same-route *content* switch, not an app switch.
    finish = bus.xDriveBeginForegroundContentTransition('files')
    assert.equal(bus.xDriveCurrentForegroundPage(), platform + ':files')
    assert.deepEqual(await Promise.all(stale), Array(6).fill(null),
      'only superseded disposable thumbnail promises resolve as cancelled')
    await until(() => s.media.slice(0, 6).every(item => item.earlyClosed),
      platform + ': all six physical old HTTP connections close')
    assert.equal(s.media.slice(0, 6).reduce((sum, row) => sum + row.bytes, 0), 0)
    assert.equal(await scheduler.load(91, 0, 1), null,
      'old directory cannot requeue thumbnails during first counted Range')
    assert.equal(s.media.length, 6)

    // Accepted directory B can start new reads; the durable jobs remain live.
    finish(); finish = null
    const newRead = scheduler.load(92, 0, 1)
    await until(() => s.media.length === 7, platform + ': new directory read was admitted')
    s.media[6].res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    s.media[6].bytes += 1
    s.media[6].res.end('b')
    assert.equal(await newRead, 'blob:thumb-92')

    // Files -> Gallery must not touch still-running uploads, downloads, backups or sync.
    bus.xDriveEnterForegroundPage(platform + ':gallery')
    assert.equal(await scheduler.load(93, 0, 1), null,
      'obsolete Files owner stays suspended after route exit')
    const releaseViewer = bus.xDriveAcquireViewerForeground({})
    try {
      for (const transfer of transfers) assert.equal(transfer.controller.signal.aborted, false,
        platform + ' ' + transfer.name + ' must not receive renderer navigation abort')
      assert.ok(s.durable.every(item => !item.res.destroyed),
        'all durable HTTP response streams are still open while Viewer owns foreground')
      for (const item of s.durable) {
        item.res.writeHead(200, { 'Content-Type': 'text/plain' })
        item.res.end(item.name + ':completed')
      }
      assert.deepEqual(await Promise.all(live), transfers.map(x => x.name + ':completed'))
      assert.ok(s.durable.every(item => !item.earlyClosed),
        'no durable HTTP connection was cancelled by page/content/Viewer priority')
    } finally { releaseViewer() }
  } finally {
    finish?.()
    scheduler.dispose()
    bus.xDriveEnterForegroundPage(null)
    await s.close()
  }
}

test('real HTTP: same-route folder, cross-route and Viewer priority never abort durable transfers', async () => {
  for (const platform of ['web', 'desktop', 'synology']) await trial(platform)
})

test('one renderer/window cannot preempt the disposable readers of another renderer', () => {
  const secondWindow = loadSource(coordinatorFile)
  bus.xDriveEnterForegroundPage(null)
  secondWindow.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage('desktop:files')
  secondWindow.xDriveEnterForegroundPage('desktop:files')
  const firstStates = [], secondStates = []
  const stopFirst = bus.xDriveObserveViewerForeground(value => firstStates.push(value))
  const stopSecond = secondWindow.xDriveObserveViewerForeground(value => secondStates.push(value))
  try {
    const finish = bus.xDriveBeginForegroundContentTransition('files')
    assert.equal(firstStates.at(-1), true)
    assert.equal(secondStates.at(-1), false)
    bus.xDriveEnterForegroundPage('desktop:gallery')
    finish()
    assert.equal(secondStates.at(-1), false)
    const release = bus.xDriveAcquireViewerForeground({})
    try {
      assert.equal(secondWindow.xDriveViewerForegroundActive(), false)
      assert.equal(secondStates.at(-1), false)
    } finally { release() }
  } finally {
    stopFirst(); stopSecond()
    bus.xDriveEnterForegroundPage(null)
    secondWindow.xDriveEnterForegroundPage(null)
  }
})
