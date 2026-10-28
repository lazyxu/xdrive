const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8')
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request)
    const prefix = path.resolve(path.dirname(filename), request)
    const location = [prefix + '.ts', prefix + '.tsx'].find(fs.existsSync)
    return location ? load(location, cache) : require(prefix)
  }
  new Function('exports', 'module', 'require', output)(module.exports, module, localRequire)
  return module.exports
}
const { xDriveDesktopViewportRequest } = load(path.join(root, 'desktop/src/renderer/abortableViewportRequest.ts'))
const {
  xDriveLeaseDesktopPreviewURL,
  xDriveReleaseDiscardedDesktopPreviewURL,
} = load(path.join(root, 'desktop/src/renderer/desktopPreviewURLLease.ts'))
const proxyURL = c => `http://127.0.0.1:48761/preview/${c.repeat(64)}`
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('P0 late IPC result after cancel releases the original native proxy ticket', async () => {
  const oldWindow = global.window
  const cancels = [], releases = []
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => { cancels.push(id); return { ok: true } },
  } } }
  try {
    const ctrl = new AbortController()
    const pending = deferred()
    let admitted = ''
    const request = xDriveDesktopViewportRequest(
      ctrl.signal,
      id => { admitted = id; return pending.promise },
      late => {
        if (late.ok) xDriveReleaseDiscardedDesktopPreviewURL(late.data,
          async url => { releases.push(url) })
      },
    )
    assert.match(admitted, /^viewport-/)
    ctrl.abort()
    pending.resolve({ ok: true, data: proxyURL('a') })
    await assert.rejects(() => request, /abort/i)
    assert.deepEqual(releases, [proxyURL('a')])
    assert.deepEqual(cancels, [admitted],
      'the originating Renderer sends an actual native viewport cancellation')
  } finally {
    global.window = oldWindow
  }
})

test('P0 an aborted response cannot release through a replacement Agent', async () => {
  const oldWindow = global.window
  const ownerA = [], ownerB = []
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async () => ({ ok: true }),
  } } }
  try {
    const ctrl = new AbortController(), pending = deferred()
    const ownerRelease = url => { ownerA.push(url); return Promise.resolve() }
    const task = xDriveDesktopViewportRequest(ctrl.signal,
      () => pending.promise,
      late => { if (late.ok) xDriveReleaseDiscardedDesktopPreviewURL(late.data, ownerRelease) })
    ctrl.abort()
    // A user may change the active account/Agent between cancellation and reply.
    global.window.xdriveDesktop.agent.releaseCloudFilePreviewURL = url => {
      ownerB.push(url)
      return Promise.resolve()
    }
    pending.resolve({ ok: true, data: proxyURL('b') })
    await assert.rejects(task, /abort/i)
    assert.deepEqual(ownerA, [proxyURL('b')])
    assert.deepEqual(ownerB, [])
  } finally {
    global.window = oldWindow
  }
})

test('P0 expired or unrelated URLs never enter privileged native-release IPC', async () => {
  const released = []
  const release = async url => { released.push(url) }
  for (const url of [
    'blob:local-preview', 'https://example.com/api/v1/file-preview/1?ticket=secret',
    'http://localhost:48761/preview/' + 'c'.repeat(64),
    'http://127.0.0.1:48761/preview/' + 'd'.repeat(63),
    proxyURL('e') + '?ticket=foreign',
  ]) xDriveReleaseDiscardedDesktopPreviewURL(url, release)
  xDriveReleaseDiscardedDesktopPreviewURL(proxyURL('f'), release)
  assert.deepEqual(released, [proxyURL('f')])
  const ctrl = new AbortController()
  ctrl.abort()
  assert.throws(() => xDriveLeaseDesktopPreviewURL(proxyURL('a'), ctrl.signal, release), /abort/i)
  assert.deepEqual(released, [proxyURL('f'), proxyURL('a')])
})

test('Desktop Live Photo still ticket follows the Owner-scoped native viewport cancellation path', () => {
  const main = source('desktop/src/main/index.cts')
  const client = source('desktop/src/main/agent_client.cts')
  const preload = source('desktop/src/preload/index.cts')
  const types = source('desktop/src/renderer/global.d.ts')
  const explorer = source('desktop/src/renderer/DesktopFileExplorer.tsx')
  const gallery = source('desktop/src/renderer/mediaGalleryAdapter.ts')
  const checks = [
    [main, "ipcMain.handle('agent:get-media-live-photo-still'"],
    [main, "viewportRequests.run(event.sender, requestID, async (signal)"],
    [main, "mediaLivePhotoStillTicket(nodeID, signal)"],
    [main, "proxy.createURLFromTicket(ticket, undefined, signal)"],
    [client, "mediaLivePhotoStillTicket(nodeID: number, signal?: AbortSignal)"],
    [preload, "ipcRenderer.invoke('agent:get-media-live-photo-still', nodeID, requestID)"],
    [types, "getMediaLivePhotoStill: (nodeID: number, requestID?: string)"],
    [explorer, "agent.getMediaLivePhotoStill(Number(item.id), requestID)"],
    [explorer, "const agent = hostPort.media"],
    [gallery, "agent.getMediaLivePhotoStill(nodeID, requestID)"],
    [explorer, "hostPort.releaseDiscardedPreviewURL(late.data"],
    [gallery, "xDriveReleaseDiscardedDesktopPreviewURL(late.data"],
  ]
  for (const [file, token] of checks) {
    assert.ok(file.includes(token), 'Live still/late token path missing: ' + token)
  }
  assert.equal(main.includes("ipcMain.handle('agent:get-media-live-photo-still', (_event"), false,
    'the old cancellation-free still handler must be retired')
})
