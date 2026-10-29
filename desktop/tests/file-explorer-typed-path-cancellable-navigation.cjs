'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const filename = 'ui/shared/src/file-explorer-controller.ts'
const mod = { exports: {} }
new Function('exports', 'module', ts.transpileModule(read(filename), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod.exports, mod)
const { xDriveFileExplorerSubmitPath, xDriveResolveFileExplorerPath } = mod.exports
const rootNode = { id: 1, name: '我的文件' }
const aborted = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })
const defer = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const until = async (predicate, label) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for ' + label)
}

test('typed-path GET A -> B: abort during root prevents any child GET even if root ignores cancellation', async () => {
  const oldRoot = defer()
  const oldController = new AbortController()
  const calls = [], commits = []
  const pending = xDriveFileExplorerSubmitPath({
    rawPath: 'A/B', currentCrumbs: [rootNode],
    loadRoot: signal => { calls.push({ stage: 'root', signal }); return oldRoot.promise },
    findChildDirectory: async () => { calls.push({ stage: 'child' }); return null },
    signal: oldController.signal,
    navigate: async crumb => { commits.push(crumb) },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal, oldController.signal)
  oldController.abort()
  oldRoot.resolve(rootNode)
  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.deepEqual(calls.map(item => item.stage), ['root'])
  assert.deepEqual(commits, [])
})

test('typed-path GET A/B -> C: late uncooperative first child cannot load another child or commit', async () => {
  const oldFirstChild = defer()
  const oldController = new AbortController()
  const lookedUp = [], committed = []
  const pathPromise = xDriveFileExplorerSubmitPath({
    rawPath: '/A/B', currentCrumbs: [rootNode],
    loadRoot: async () => rootNode,
    findChildDirectory: (parent, name, signal) => {
      lookedUp.push({ parent, name, signal })
      return oldFirstChild.promise
    },
    navigate: async crumbs => { committed.push(crumbs) },
    signal: oldController.signal,
  })
  await tick()
  assert.deepEqual(lookedUp.map(x => x.name), ['A'])
  assert.equal(lookedUp[0].signal, oldController.signal)
  oldController.abort()
  oldFirstChild.resolve({ id: 2, name: 'A', type: 'dir' })
  await assert.rejects(pathPromise, e => e?.name === 'AbortError')
  assert.deepEqual(lookedUp.map(x => x.name), ['A'])
  assert.deepEqual(committed, [])
})

test('typed-path successor succeeds with authoritative ordered crumbs; no extra child materialization', async () => {
  const signal = new AbortController()
  const calls = [], commits = [], pendingDurable = Array.from({ length: 4 }, () => new AbortController())
  const nodes = new Map([['1:A', { id: 2, name: 'A', type: 'dir' }], ['2:B', { id: 3, name: 'B', type: 'dir' }]])
  const result = await xDriveFileExplorerSubmitPath({
    rawPath: '我的文件/A/B', currentCrumbs: [rootNode],
    loadRoot: async received => {
      assert.equal(received, signal.signal)
      return rootNode
    },
    findChildDirectory: async (parent, name, received) => {
      calls.push([parent, name])
      assert.equal(received, signal.signal)
      return nodes.get(parent + ':' + name) ?? null
    },
    navigate: async chain => commits.push(chain),
    signal: signal.signal,
  })
  assert.deepEqual(calls, [[1, 'A'], [2, 'B']])
  assert.deepEqual(result, [{ id: 1, name: '我的文件' }, { id: 2, name: 'A' }, { id: 3, name: 'B' }])
  assert.deepEqual(commits, [result])
  assert.equal(signal.signal.aborted, false)
  for (const durable of pendingDurable) assert.equal(durable.signal.aborted, false)
})

test('missing and unauthorized path preserve true failures; legacy signal-free caller remains compatible', async () => {
  await assert.rejects(xDriveResolveFileExplorerPath({
    rawPath: 'Bad', rootID: 1, rootName: '我的文件',
    findChildDirectory: async () => ({ id: 5, name: 'Bad', type: 'file' }),
  }), /找不到文件夹：Bad/)
  await assert.rejects(xDriveFileExplorerSubmitPath({
    rawPath: 'Private', currentCrumbs: [rootNode],
    loadRoot: async () => rootNode,
    findChildDirectory: async () => { throw new Error('Owner denied') },
    navigate: async () => { throw new Error('must not navigate') },
  }), /Owner denied/)
  const answer = await xDriveFileExplorerSubmitPath({
    rawPath: '/', currentCrumbs: [rootNode],
    loadRoot: async () => rootNode,
    findChildDirectory: async () => { throw new Error('no child needed') },
    navigate: async () => {},
  })
  assert.deepEqual(answer, [rootNode], 'legacy callers without signal still navigate root')
})

test('actual HTTP child GET is closed by abort before delayed response body, without affecting successor', async () => {
  let active = 0, earlyClosed = 0, sentBytes = 0
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/root') {
      res.end(JSON.stringify(rootNode))
      return
    }
    if (req.url === '/child/A') {
      active++
      const timer = setTimeout(() => {
        if (!res.destroyed) { sentBytes += 25000; res.end(JSON.stringify({ id: 2, name: 'A', type: 'dir' })) }
      }, 450)
      res.on('close', () => {
        clearTimeout(timer)
        active--
        if (!res.writableEnded) earlyClosed++
      })
      return
    }
    res.end(JSON.stringify({ id: 3, name: 'B', type: 'dir' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const readJson = (url, signal) => fetch(url, { signal }).then(response => response.json())
  const oldController = new AbortController(), newController = new AbortController()
  const oldCommits = [], newCommits = []
  try {
    const old = xDriveFileExplorerSubmitPath({
      rawPath: '/A', currentCrumbs: [rootNode],
      loadRoot: signal => readJson(base + '/root', signal),
      findChildDirectory: (_parent, name, signal) => readJson(base + '/child/' + name, signal),
      navigate: async chain => oldCommits.push(chain),
      signal: oldController.signal,
    })
    // Attach a rejection handler before abort: the real network rejects
    // immediately, while the successor starts independently.
    const oldOutcome = old.then(() => ({ ok: true }), error => ({
      ok: false, name: error?.name,
    }))
    await until(() => active === 1, 'old /child/A HTTP GET')
    oldController.abort()
    const current = await xDriveFileExplorerSubmitPath({
      rawPath: '/B', currentCrumbs: [rootNode],
      loadRoot: signal => readJson(base + '/root', signal),
      findChildDirectory: (_parent, name, signal) => readJson(base + '/child/' + name, signal),
      navigate: async chain => newCommits.push(chain),
      signal: newController.signal,
    })
    assert.deepEqual(await oldOutcome, { ok: false, name: 'AbortError' })
    await until(() => active === 0, 'old TCP response closed')
    assert.equal(earlyClosed, 1)
    assert.equal(sentBytes, 0)
    assert.deepEqual(oldCommits, [])
    assert.deepEqual(newCommits, [current])
    assert.equal(current.at(-1).name, 'B')
    assert.equal(newController.signal.aborted, false)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('Web and Desktop pass only disposable path AbortSignal through existing Owner-scoped GET ports', () => {
  const shared = read('ui/shared/src/file-explorer-controller.ts')
  const workspace = read('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
  const web = read('web/src/WebFileExplorer.tsx')
  const api = read('web/src/api.ts')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const main = read('desktop/src/main/index.cts')
  assert.match(shared, /signal\?\.throwIfAborted\(\)/)
  assert.match(workspace, /const signal = navigation\.navigationReadSignalForIntent\(navigationIntentID\)/)
  assert.match(workspace, /await xDriveFileExplorerSubmitPath\(\{[\s\S]*?signal,[\s\S]*?navigate:/)
  assert.match(workspace, /!signal\.aborted && navigation\.isNavigationIntentCurrent\(navigationIntentID\)/)
  assert.match(web, /loadRoot: \(signal\?: AbortSignal\) => api\.root\(signal\)/)
  assert.match(web, /findChildDirectory: async \(parentID, name, signal\?: AbortSignal\)[\s\S]*?api\.listPageAbortable\([\s\S]*?signal,/)
  assert.match(api, /root\(signal\?: AbortSignal\) \{\s*return this\.request<Node>\('\/api\/v1\/nodes\/root', \{ signal \}\)/)
  assert.match(desktop, /findChildDirectory: async \(parentID, name, signal\?: AbortSignal\)[\s\S]*?hostPort\.requestViewport\(signal, requestID =>[\s\S]*?cloudChildrenPage\(parentID, options, requestID\)/)
  assert.match(main, /'agent:cloud-children-page'/)
  const scope = read('ui/shared/src/mui/FileExplorerDisposableNavigationReads.ts')
  assert.doesNotMatch(scope, /cancelTransfer|cancelBackup|cancelUpload|cancelDownload|terminateWorker|abortAll/)
})
