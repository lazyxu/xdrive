'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')

test('Desktop Album A -> B abort reaches the scoped Agent HTTP GET, not mutations', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const renderer = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const typings = read('desktop/src/renderer/global.d.ts')
  const preload = read('desktop/src/preload/index.cts')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')

  assert.match(gallery, /firstContentRangeAbort\.current\?\.abort\(\)/,
    'new Album must abort prior first Range at navigation intent')
  assert.match(gallery, /loadTargetRange\(\s*target,\s*0,\s*pageSize,\s*firstRangeController\.signal/,
    'the Album read must receive its own AbortSignal')
  assert.match(gallery, /source\.listAlbumItemRange\(target\.id,\s*limit,\s*offset,\s*rangedQuery,\s*signal\)/)
  assert.match(renderer, /listAlbumItemRange:\s*\(albumID,\s*limit,\s*offset,\s*query,\s*signal\)\s*=>\s*xDriveDesktopViewportRequest\(\s*signal,/)
  assert.match(renderer, /agent\.getMediaAlbumItemRange\(albumID,\s*limit,\s*offset,\s*query,\s*requestID\)/)
  assert.match(typings, /getMediaAlbumItemRange:[\s\S]{0,180}?requestID\?: string/)
  assert.match(preload, /ipcRenderer\.invoke\('agent:get-media-album-item-range', albumID, limit, offset, query, requestID\)/)
  const handler = main.split("ipcMain.handle('agent:get-media-album-item-range'")[1]
    ?.split("ipcMain.handle('agent:set-media-favorite'")[0]
  assert.ok(handler, 'Album Range handler must exist')
  assert.match(handler, /viewportRequests\.run\(event\.sender,\s*requestID,\s*async\s*\(?signal\)?\s*=>/,
    'main process must bind cancellation to the invoking window')
  assert.match(handler, /requireAgentClient\(\)\.mediaAlbumItemRange\([\s\S]*?signal,/)
  const clientMethod = agent.split('  mediaAlbumItemRange(')[1]?.split('  setMediaFavorite(')[0]
  assert.ok(clientMethod, 'Agent client must expose album Range')
  assert.match(clientMethod, /signal\?: AbortSignal/)
  assert.match(clientMethod, /this\.request<AgentMediaItemRange>\([\s\S]*?'GET'[\s\S]*?10_000,\s*signal,/,
    'actual HTTP GET must receive AbortSignal, not just UI stale-response fencing')
  assert.doesNotMatch(handler, /setMediaFavorite|renameMediaAlbum|deleteMediaAlbum|addMediaAlbumItems/,
    'durable mutations may never be cancelled by Album browsing')
})

test('Desktop viewport cancellation sends one scoped request ID and rejects late read-only result', async () => {
  const file = 'desktop/src/renderer/abortableViewportRequest.ts'
  const transpiled = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', transpiled)(mod.exports, mod)
  let finish
  const reading = new Promise(resolve => { finish = resolve })
  const aborted = []
  const originalWindow = global.window
  global.window = {
    xdriveDesktop: {
      agent: { cancelViewportRequest: async requestID => {
        aborted.push(requestID)
        return { ok: true, data: { cancelled: true } }
      } },
    },
  }
  try {
    const controller = new AbortController()
    let requestID
    const pending = mod.exports.xDriveDesktopViewportRequest(
      controller.signal,
      id => { requestID = id; return reading },
    )
    assert.match(requestID, /^viewport-/)
    controller.abort()
    assert.deepEqual(aborted, [requestID], 'only this renderer request was cancelled')
    finish({ items: [{ id: 99, name: 'stale' }] })
    await assert.rejects(pending, error => error?.name === 'AbortError')
  } finally {
    finish(null)
    if (originalWindow === undefined) delete global.window
    else global.window = originalWindow
  }
})
