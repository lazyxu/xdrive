const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractLoadLivePhotoMotion() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'loadLivePhotoMotion' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sourceFile) === 'useCallback'
    ) {
      callback = node.initializer.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop FileExplorer loadLivePhotoMotion callback')
  return { filename, callback }
}

function compileCallback(filename, callback, dependencies) {
  const output = ts.transpileModule(
    'const loadLivePhotoMotion = ' + callback + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    },
  ).outputText

  const names = Object.keys(dependencies)
  const values = names.map((name) => dependencies[name])
  return new Function(...names, output + '\nreturn loadLivePhotoMotion')(...values)
}

test('Desktop FileExplorer stale Live Photo dispose cannot release through the new account Agent', async () => {
  const { filename, callback } = extractLoadLivePhotoMotion()

  const releasesA = []
  const releasesB = []
  const agentA = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-a/7',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesA.push(value)
      return { ok: true, data: null }
    },
  }
  const agentB = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-b/7',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesB.push(value)
      return { ok: true, data: null }
    },
  }

  const window = {
    xdriveDesktop: {
      agent: agentA,
    },
  }
  const actionGenerationRef = { current: 1 }

  const loadLivePhotoMotion = compileCallback(filename, callback, {
    hostPort: { media: agentA },
    actionGenerationRef,
  })

  const source = await loadLivePhotoMotion({
    id: 7,
    name: 'photo.livp',
    kind: 'file',
    revision: 3,
  })

  assert.ok(source)

  // The FileExplorer account/Server lifecycle changes before Preview cleanup runs.
  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = agentB
  source.dispose()
  source.dispose()

  await Promise.resolve()

  assert.deepEqual(releasesA, ['motion://account-a/7'],
    'stale Viewer dispose releases its original local proxy token exactly once')
  assert.deepEqual(releasesB, [],
    'cleanup for an account-A Live Photo source must never release through account B')
})


test('Desktop FileExplorer Live Photo load finishing after account switch is discarded', async () => {
  const { filename, callback } = extractLoadLivePhotoMotion()

  let resolveMotion
  const releasesA = [], releasesB = []
  const agentA = {
    getMediaLivePhotoMotion: () => new Promise((resolve) => {
      resolveMotion = () => resolve({
        ok: true,
        data: 'motion://account-a/late',
      })
    }),
    releaseMediaLivePhotoMotion: async value => {
      releasesA.push(value)
      return { ok: true, data: null }
    },
  }
  const agentB = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-b/late',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesB.push(value)
      return { ok: true, data: null }
    },
  }
  const window = {
    xdriveDesktop: {
      agent: agentA,
    },
  }
  const actionGenerationRef = { current: 4 }

  const loadLivePhotoMotion = compileCallback(filename, callback, {
    hostPort: { media: agentA },
    actionGenerationRef,
  })

  const pending = loadLivePhotoMotion({
    id: 9,
    name: 'late.livp',
    kind: 'file',
    revision: 1,
  })

  await Promise.resolve()
  assert.equal(typeof resolveMotion, 'function')

  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = agentB
  resolveMotion()

  const source = await pending

  assert.equal(
    source,
    null,
    'an account-A Live Photo request that finishes after switching to B must be discarded',
  )
  assert.deepEqual(releasesA, ['motion://account-a/late'],
    'stale Owner result must release its actual proxy token rather than leak')
  assert.deepEqual(releasesB, [],
    'new account Agent may not release a prior account proxy')
})


test('Desktop Live motion cancellable IPC reuses sender-bound viewport and local proxy cleanup', () => {
  const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
  const preload = read('desktop/src/preload/index.cts')
  const main = read('desktop/src/main/index.cts')
  const client = read('desktop/src/main/agent_client.cts')
  const renderer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const filesHost = read('desktop/src/renderer/DesktopFileExplorerHostPort.ts')
  const gallery = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const types = read('desktop/src/renderer/global.d.ts')
  for (const [name, source, part] of [
    ['Renderer declaration', types, 'viewportRequestID?: string'],
    ['Preload relay', preload, "ipcRenderer.invoke('agent:get-media-live-photo-motion', nodeID, requestID, viewportRequestID)"],
    ['Main Owner scope', main, 'viewportRequests.run(event.sender, viewportRequestID, async (signal)'],
    ['Main Agent fetch', main, 'mediaLivePhotoMotionTicket(nodeID, signal)'],
    ['Main proxy await', main, 'const url = await proxy.createURLFromTicket('],
    ['Main proxy cleanup', main, 'signal?.addEventListener(\'abort\', releaseOnAbort, { once: true })'],
    ['Agent HTTP', client, 'mediaLivePhotoMotionTicket(nodeID: number, signal?: AbortSignal)'],
    ['Desktop Gallery', gallery, 'xDriveDesktopViewportRequest(signal, async (requestID)'],
    ['Desktop Files', renderer, 'hostPort.requestViewport(signal, fetchMotion)'],
  ]) assert.ok(source.includes(part), name + ' must preserve request cancellation')
  assert.ok(filesHost.includes('requestViewport: xDriveDesktopViewportRequest'),
    'Sender-scoped cancellation must remain in the owning Desktop Host Adapter')
})

test('Desktop FileExplorer late aborted Live Photo proxy is released through its original Agent only', async () => {
  const { filename, callback } = extractLoadLivePhotoMotion()
  const oldReleases = [], newReleases = []
  let finishTicket
  const oldAgent = {
    getMediaLivePhotoMotion: (_nodeID, _progress, requestID) => {
      assert.equal(requestID, 'viewport-live-1')
      return new Promise(resolve => { finishTicket = () => resolve({
        ok: true,
        data: 'motion://old-owner/pending',
      }) })
    },
    releaseMediaLivePhotoMotion: async url => { oldReleases.push(url); return { ok: true, data: null } },
  }
  const newAgent = {
    releaseMediaLivePhotoMotion: async url => { newReleases.push(url); return { ok: true, data: null } },
  }
  const window = { xdriveDesktop: { agent: oldAgent } }
  const actionGenerationRef = { current: 4 }
  const xDriveDesktopViewportRequest = async (signal, invoke) => {
    const result = await invoke('viewport-live-1')
    signal.throwIfAborted()
    return result
  }
  const loader = compileCallback(filename, callback, {
    hostPort: { media: oldAgent, requestViewport: xDriveDesktopViewportRequest },
    actionGenerationRef,
  })
  const controller = new AbortController()
  const pending = loader({ id: 9, name: 'photo.livp', kind: 'file', revision: 2 }, undefined, controller.signal)
  await Promise.resolve()
  assert.equal(typeof finishTicket, 'function')
  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = newAgent
  controller.abort()
  finishTicket()
  await assert.rejects(pending, /abort/i)
  await Promise.resolve()
  assert.deepEqual(oldReleases, ['motion://old-owner/pending'], 'release only through captured original Agent')
  assert.deepEqual(newReleases, [], 'new Owner Agent may not touch prior Owner URL')
})


test('Desktop Main async proxy creation is aborted before the real URL is ready', async () => {
  const filename = path.join(repo, 'desktop/src/main/index.cts')
  const source = fs.readFileSync(filename, 'utf8')
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  let body
  const visit = node => {
    if (ts.isCallExpression(node) &&
      node.expression.getText(file) === 'ipcMain.handle' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'agent:get-media-live-photo-motion') {
      assert.equal(body, undefined, 'there must be only one production Live motion IPC handler')
      body = node.arguments[1].getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(body, 'production motion IPC handler must be found in Electron Main')

  const js = ts.transpileModule('const handler = ' + body + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const abort = new AbortController()
  const released = []
  let resolveProxyURL
  const proxy = {
    createURLFromTicket: async () => new Promise(resolve => { resolveProxyURL = resolve }),
    releaseURL: url => { released.push(url); return true },
  }
  const dependencies = {
    // The isolated .cts TypeScript transpile emits a CommonJS exports marker.
    exports: {},
    runAgentAction: action => action(),
    viewportRequests: { run: (_sender, _requestID, action) => action(abort.signal) },
    requireAgentLifecycle: () => ({ ensureRunning: async () => ({}) }),
    requireAgentCapability: () => {},
    requireAgentClient: () => ({
      mediaLivePhotoMotionTicket: async (_id, signal) => {
        assert.strictEqual(signal, abort.signal)
        return { url: 'ticket://fixture', expiresAt: Date.now() + 10000 }
      },
    }),
    filePreviewProxy: proxy,
    AgentIPCError: class extends Error {
      constructor(_code, _status, message) { super(message) }
    },
  }
  const names = Object.keys(dependencies)
  const handler = new Function(...names, js + '\nreturn handler')(
    ...names.map(name => dependencies[name]))
  const event = { sender: { isDestroyed: () => false, send: () => {} } }
  const pending = handler(event, 71, 'progress-71', 'viewport-71')
  for (let i = 0; i < 20 && !resolveProxyURL; i++) await Promise.resolve()
  assert.equal(typeof resolveProxyURL, 'function',
    'actual Main IPC must await the asynchronous local preview proxy')
  assert.deepEqual(released, [])
  abort.abort()
  const url = 'http://127.0.0.1:18888/file-preview/fixture-71'
  resolveProxyURL(url)
  await assert.rejects(pending, /cancelled/i)
  assert.deepEqual(released, [url],
    'late AbortSignal after proxy startup must dispose the actual URL, never a Promise')
})
