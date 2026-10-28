'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const adapter = source('desktop/src/renderer/mediaGalleryAdapter.ts')
const preload = source('desktop/src/preload/index.cts')
const types = source('desktop/src/renderer/global.d.ts')
const main = source('desktop/src/main/index.cts')
const client = source('desktop/src/main/agent_client.cts')
const endpoints = [
  ['getMediaTrash', 'mediaTrash', 'agent:get-media-trash', 'listTrashItemRange'],
  ['getMediaMemoryItemRange', 'mediaMemoryItemRange', 'agent:get-media-memory-item-range', 'listMemoryItemRange'],
  ['getMediaDuplicateItemRange', 'mediaDuplicateItemRange', 'agent:get-media-duplicate-item-range', 'listDuplicateItemRange'],
  ['getMediaBurstReviewItemRange', 'mediaBurstReviewItemRange', 'agent:get-media-burst-item-range', 'listBurstReviewItemRange'],
  ['getMediaPetItemRange', 'mediaPetItemRange', 'agent:get-media-pet-item-range', 'listPetItemRange'],
  ['getMediaSuggestedPersonItemRange', 'mediaSuggestedPersonItemRange', 'agent:get-media-suggested-person-item-range', 'listSuggestedPersonItemRange'],
  ['getMediaPersonItemRange', 'mediaPersonItemRange', 'agent:get-media-person-item-range', 'listPersonItemRange'],
  ['getMediaAlbumItemRange', 'mediaAlbumItemRange', 'agent:get-media-album-item-range', 'listAlbumItemRange'],
]
function section(text, start, end) {
  const first = text.indexOf(start)
  assert.ok(first >= 0, 'missing ' + start)
  const last = end ? text.indexOf(end, first + start.length) : text.length
  assert.ok(last > first, 'missing boundary after ' + start)
  return text.slice(first, last)
}
test('all Desktop Gallery Range paths relay a sender-owned cancellable signal to Agent HTTP', () => {
  for (const [preloadName, agentMethod, ipc, sourceName] of endpoints) {
    const adapterStart = adapter.indexOf('    ' + sourceName + ':')
    assert.ok(adapterStart >= 0, 'missing Gallery source ' + sourceName)
    const mapped = adapter.slice(adapterStart, adapterStart + 370)
    // The implementation always uses the existing per-window viewport
    // cancellation bridge, not a durable sync/transfer cancellation API.
    assert.match(mapped, /xDriveDesktopViewportRequest\(/,
      sourceName + ' must register cancellable transport')
    // Explicit user actions may cancel persistent jobs elsewhere in the
    // adapter. The disposable Range callback must never do so.
    for (const action of ['cancelTransfer', 'cancelBackup', 'cancelSync',
      'cancelMediaSelectionJob', 'terminateWorker']) {
      assert.equal(mapped.includes('agent.' + action + '('), false,
        sourceName + ' must not cancel persistent work: ' + action)
    }
    assert.ok(adapter.includes('agent.' + preloadName + '('),
      'the renderer must invoke its bound IPC port: ' + preloadName)

    const preloadStart = preload.indexOf('  ' + preloadName + ':')
    assert.ok(preloadStart >= 0, 'preload method missing: ' + preloadName)
    const preloadSection = preload.slice(preloadStart, preloadStart + 1000)
    assert.ok(preloadSection.includes('requestID?: string'),
      'the preload method must accept request ID: ' + preloadName)
    assert.ok(preloadSection.includes("'" + ipc + "'"),
      'the preload method must forward to correct IPC route: ' + ipc)
    assert.ok(preloadSection.includes('requestID'),
      'the preload call must include the ID: ' + ipc)

    const typeSection = section(types, '        ' + preloadName + ':', ') => Promise<DesktopResult')
    assert.match(typeSection, /requestID\?: string/,
      'the renderer contract must expose optional requestID: ' + preloadName)

    const idx = main.indexOf("'" + ipc + "'")
    assert.ok(idx >= 0, 'Main IPC handler not found: ' + ipc)
    const mainStart = main.lastIndexOf('ipcMain.handle', idx)
    const mainEnd = main.indexOf('}), false)', idx)
    assert.ok(mainStart >= 0 && mainEnd > idx, 'Main handler terminator absent: ' + ipc)
    const handler = main.slice(mainStart, mainEnd + 10)
    assert.ok(handler.includes('viewportRequests.run(event.sender, requestID, async (signal) => {'),
      'Main must isolate the abort to the exact sender and requestID: ' + ipc)
    assert.ok(handler.includes('requireAgentClient().' + agentMethod + '('),
      'Main must invoke Agent transport: ' + agentMethod)
    assert.match(handler, /signal(?:,\s*|\s*\))/,
      'Main must pass AbortSignal into the Agent HTTP method: ' + ipc)

    const clientMethod = section(client, '  ' + agentMethod + '(', '\n  }\n')
    assert.ok(clientMethod.includes('signal?: AbortSignal'),
      'Agent method must accept AbortSignal: ' + agentMethod)
    assert.ok(clientMethod.includes('10_000,\n      signal,'),
      'Agent client must abort the actual HTTP transport: ' + agentMethod)
  }
  assert.match(main, /viewportRequests\.cancel\(event\.sender, requestID\)/,
    'only the initiating BrowserWindow can abort its own disposable Range')
})

test('request-scoped IPC abort cancels only the obsolete Range, never the new request', async () => {
  const js = ts.transpileModule(source('desktop/src/renderer/abortableViewportRequest.ts'), {
    fileName: 'abortableViewportRequest.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', js)(mod, mod.exports)
  const canceled = []
  const previousWindow = global.window
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => { canceled.push(id); return { ok: true, data: { cancelled: true } } },
  } } }
  const oldGate = {}
  const newGate = {}
  let resolveOld, resolveNew
  oldGate.promise = new Promise(resolve => { resolveOld = resolve })
  newGate.promise = new Promise(resolve => { resolveNew = resolve })
  const first = new AbortController()
  const second = new AbortController()
  let oldID, newID
  try {
    const oldRead = mod.exports.xDriveDesktopViewportRequest(first.signal, id => {
      oldID = id
      return oldGate.promise
    })
    const currentRead = mod.exports.xDriveDesktopViewportRequest(second.signal, id => {
      newID = id
      return newGate.promise
    })
    assert.ok(oldID?.startsWith('viewport-') && newID?.startsWith('viewport-'))
    assert.notEqual(oldID, newID)
    first.abort()
    assert.deepEqual(canceled, [oldID], 'only the old Range is cancelled')
    resolveOld({ ok: true, data: { total_count: 1 } })
    await assert.rejects(oldRead, error => error?.name === 'AbortError')
    resolveNew({ ok: true, data: { total_count: 2 } })
    assert.equal((await currentRead).data.total_count, 2)
    assert.equal(second.signal.aborted, false)
    assert.deepEqual(canceled, [oldID], 'current Range and persistent work remain untouched')
  } finally {
    resolveOld?.({ ok: true, data: null })
    resolveNew?.({ ok: true, data: null })
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})
