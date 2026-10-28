'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const compile = (file, src) => ts.transpileModule(src, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(file, requireModule = require) {
  const result = { exports: {} }
  new Function('exports', 'module', 'require', compile(file, read(file)))(
    result.exports, result, requireModule)
  return result.exports
}
const { DesktopViewportRequests } = load('desktop/src/main/viewport_requests.cts')
const priority = load('ui/shared/src/mui/ViewerForegroundPriority.ts')
const gallery = load('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts',
  name => name === './ViewerForegroundPriority' ? priority : require(name))
const flush = () => new Promise(resolve => setImmediate(resolve))
async function until(testCondition, label) {
  for (let i = 0; i < 80; i++) {
    if (testCondition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timeout waiting for ' + label)
}
const defer = () => {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}

test('Desktop root GET bridge keeps legacy no-ID path and scopes only read-only HTTP', () => {
  const renderer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const preload = read('desktop/src/preload/index.cts')
  const types = read('desktop/src/renderer/global.d.ts')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')
  const rootHandler = main.split("ipcMain.handle('agent:cloud-root'")[1]
    ?.split("ipcMain.handle('agent:cloud-children'")[0]
  assert.ok(rootHandler, 'cloud-root IPC still exists')
  assert.match(renderer, /loadRoot: async \(signal\?: AbortSignal\) =>/)
  assert.match(renderer, /hostPort\.requestViewport\(signal, requestID =>\s*hostPort\.browse\.cloudRoot\(requestID\)/)
  assert.match(renderer, /: await hostPort\.browse\.cloudRoot\(\)/,
    'old unscoped root callers remain compatible')
  assert.match(preload, /cloudRoot: \(requestID\?: string\) => ipcRenderer\.invoke\('agent:cloud-root', requestID\)/)
  assert.match(types, /cloudRoot: \(requestID\?: string\) => Promise<DesktopResult<AgentCloudNode>>/)
  assert.match(rootHandler, /viewportRequests\.run\(event\.sender, requestID, async \(signal\) =>/)
  assert.match(rootHandler, /requireAgentCapability\(hello, 'cloud-files'\)/)
  assert.match(rootHandler, /requireAgentClient\(\)\.cloudRoot\(signal\)/)
  assert.doesNotMatch(rootHandler, /cancelUpload|cancelTransfer|cancelDownload|cancelBackup|terminateWorker/)
  assert.match(agent, /cloudRoot\(signal\?: AbortSignal\) \{[\s\S]*?this\.request<AgentCloudNode>\('GET', '\/v1\/cloud\/root', undefined, 10_000, signal\)/)
  assert.match(read('desktop/src/main/viewport_requests.cts'), /if \(requestID === undefined\) return execute\(\)/)
})

test('sender-scoped root GET cancel closes old TCP response; new owner/window and durable signals survive', async () => {
  const requests = new DesktopViewportRequests()
  const senderA = Object.assign(new EventEmitter(), { id: 101 })
  const senderB = Object.assign(new EventEmitter(), { id: 202 })
  const stats = { active: 0, aborted: 0, sentOld: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/cloud/root?old') {
      stats.active++
      const timer = setTimeout(() => {
        if (!res.destroyed) {
          stats.sentOld += 1
          res.end(JSON.stringify({ id: 1, name: 'Old' }))
        }
      }, 500)
      res.on('close', () => {
        clearTimeout(timer)
        stats.active--
        if (!res.writableEnded) stats.aborted++
      })
      return
    }
    res.end(JSON.stringify({ id: 2, name: 'New' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const durables = ['upload','download','backup','sync'].map(() => new AbortController())
  try {
    const old = requests.run(senderA, 'root-old', async signal => {
      const res = await fetch(base + '/v1/cloud/root?old', { signal })
      return res.json()
    })
    const oldResult = old.then(() => ({ ok: true }), error => ({
      ok: false, error: error instanceof Error ? error.name : 'unknown',
    }))
    await until(() => stats.active === 1, 'old Owner root HTTP GET')
    const newResult = requests.run(senderA, 'root-new', async signal => {
      const res = await fetch(base + '/v1/cloud/root?new', { signal })
      return res.json()
    })
    const independentResult = requests.run(senderB, 'root-old', async signal => {
      const res = await fetch(base + '/v1/cloud/root?new', { signal })
      return res.json()
    })
    requests.cancel(senderA, 'root-old')
    assert.equal((await oldResult).ok, false)
    await until(() => stats.active === 0, 'cancelled old socket close')
    assert.deepEqual(await newResult, { id: 2, name: 'New' })
    assert.deepEqual(await independentResult, { id: 2, name: 'New' })
    assert.equal(stats.aborted, 1)
    assert.equal(stats.sentOld, 0, 'no aborted response body is served')
    for (const durable of durables) assert.equal(durable.signal.aborted, false)
    // Cancel-before-admission must not accidentally cancel a different sender.
    requests.cancel(senderA, 'pre-admission')
    await assert.rejects(requests.run(senderA, 'pre-admission', async () => 'must not run'),
      /cancelled before admission/)
    assert.equal(await requests.run(senderB, 'pre-admission', async () => 'allowed'), 'allowed')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('same-route typed path pauses old Files thumbnails BEFORE root metadata resolves, then restores on failure', async () => {
  priority.xDriveEnterForegroundPage(null)
  priority.xDriveEnterForegroundPage('web:files')
  let pendingOld = defer(), pendingNew = defer()
  const signals = []
  const scheduler = new gallery.XDriveMediaThumbnailScheduler((nodeID, signal) => {
    signals.push({ nodeID, signal })
    return nodeID === 71 ? pendingOld.promise : pendingNew.promise
  }, { concurrency: 2, revokeURL: () => {} })
  const uploads = new AbortController(), backup = new AbortController()
  let release
  try {
    const old = scheduler.load(71, 1, 1)
    await flush()
    assert.equal(signals.at(-1).signal.aborted, false)
    release = priority.xDriveBeginForegroundContentTransition('files')
    assert.equal(await old, null, 'old thumbnail stops while typed path resolves')
    assert.equal(signals[0].signal.aborted, true)
    assert.equal(await scheduler.load(72, 1, 1), null,
      'old mounted list cannot requeue while the typed path awaits root/child GET')
    release()
    release()
    const resumed = scheduler.load(73, 1, 1)
    await flush()
    pendingNew.resolve('blob:resumed-visible-folder')
    assert.equal(await resumed, 'blob:resumed-visible-folder')
    assert.equal(uploads.signal.aborted, false)
    assert.equal(backup.signal.aborted, false)
  } finally {
    release?.()
    pendingOld.resolve('blob:late-old')
    pendingNew.resolve(null)
    scheduler.dispose()
    priority.xDriveEnterForegroundPage(null)
  }
})

test('shared workspace enters disposable content priority before typed-path root request and always releases', () => {
  const workspace = read('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
  const source = workspace.slice(workspace.indexOf('  const submitPath = async'),
    workspace.indexOf('  const searchCrumbsForNode'))
  assert.match(source, /navigation\.beginNavigationIntent\(\)/)
  assert.match(source, /xDriveBeginForegroundContentTransition\('files'\)/)
  assert.ok(source.indexOf("xDriveBeginForegroundContentTransition('files')") <
    source.indexOf('await xDriveFileExplorerSubmitPath('),
    'old thumbnails must yield before root/child network request')
  assert.match(source, /finally \{\s*finishContentPreemption\(\)\s*\}/,
    'failed or cancelled typed path restores old visible thumbnails')
  assert.match(read('ui/shared/src/mui/ViewerForegroundPriority.ts'),
    /contentTransitions\.set\(page, \{ token, generation \}\)/)
})
