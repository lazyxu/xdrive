const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = (p) => fs.readFileSync(path.join(root, p), 'utf8')
function importPreviewModel() {
  const filename = path.join(root, 'ui/shared/src/file-preview.ts')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

test('RAW derived JPEG whitelist is extension-scoped, never MIME-inferred', () => {
  const { xDriveFileUsesRawCompatibilityPreview, xDriveClassifyFilePreview } = importPreviewModel()
  for (const name of ['a.dng','b.NEF','c.arw','d.CR3']) {
    assert.equal(xDriveFileUsesRawCompatibilityPreview(name), true)
    assert.equal(xDriveClassifyFilePreview({ kind:'file', name }), 'image')
  }
  for (const name of ['a.jpg','b.heic','c.cr2','d.raf','e.bin']) {
    assert.equal(xDriveFileUsesRawCompatibilityPreview(name), false)
  }
  assert.equal(xDriveClassifyFilePreview({
    kind: 'file', name: 'fake.bin', mimeType: 'image/x-adobe-dng',
  }), 'none')
})

test('shared decoded Viewer owns derived-JPEG request lifetime and keeps thumbnail fallback', () => {
  const image = source('ui/shared/src/mui/FilePreviewImage.tsx')
  const ui = source('ui/shared/src/mui/FilePreviewSurface.tsx')
  const details = source('ui/shared/src/mui/MediaGalleryDetails.tsx')
  const viewer = source('ui/shared/src/mui/MediaViewerContent.tsx')
  // Original-only retry must abort just its request; a decoded thumbnail
  // remains mounted until the Viewer source closes or changes.
  assert.ok(image.includes('const controllers = new Map<ImageRole, AbortController>()'))
  assert.ok(image.includes('controllers.get(role)?.abort()'))
  assert.ok(image.includes('for (const controller of controllers.values()) controller.abort()'))
  assert.ok(image.includes('current.target, kind, signal,'))
  assert.ok(image.includes("start('thumbnail'"))
  assert.ok(ui.includes('signal?: AbortSignal'))
  assert.ok(details.includes('signal, item.node.name'))
  assert.ok(viewer.includes('signal, item.node.name'))
})

test('Web Gallery, FileExplorer and Quick Look fetch authenticated 1280px JPEG rather than RAW original tickets', () => {
  const api = source('web/src/api.ts')
  const gallery = source('web/src/mediaGalleryAdapter.ts')
  const explorer = source('web/src/WebFileExplorer.tsx')
  const viewers = source('web/src/WebFileViewerApps.tsx')
  assert.ok(api.includes('/analysis-preview'))
  assert.ok(api.includes("response.headers.get('Content-Type')"))
  for (const adapter of [gallery, explorer, viewers]) {
    assert.ok(adapter.includes('xDriveFileNeedsBrowserCompatibleImagePreview'))
    assert.ok(adapter.includes('mediaAnalysisPreviewURL('))
  }
  assert.ok(api.includes('signal?.throwIfAborted()'))
  assert.ok(api.includes('?revision=${revision}'), 'browser cache must be source-revision keyed')
})

test('Desktop Gallery and FileExplorer use the same request-scoped Agent analysis JPEG endpoint', () => {
  const agent = source('cmd/xdrive-agent/desktop_ipc.go')
  const go = source('cmd/xdrive-agent/cloud_files.go')
  const main = source('desktop/src/main/index.cts')
  const client = source('desktop/src/main/agent_client.cts')
  const preload = source('desktop/src/preload/index.cts')
  const desktop = source('desktop/src/renderer/DesktopFileExplorer.tsx')
  const gallery = source('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.ok(agent.includes('GET /v1/media/analysis-preview'))
  assert.ok(go.includes('cli.MediaAnalysisPreview(ctx, nodeID)'))
  assert.ok(main.includes("'agent:get-media-analysis-preview'"))
  assert.ok(client.includes('/v1/media/analysis-preview?'))
  assert.ok(preload.includes('getMediaAnalysisPreview:'))
  for (const component of [desktop, gallery]) {
    assert.ok(component.includes('xDriveFileNeedsBrowserCompatibleImagePreview'))
    assert.ok(component.includes('xDriveDesktopViewportRequest('))
    assert.ok(component.includes('getMediaAnalysisPreview('))
  }
  const original = source('internal/api/file_preview.go')
  assert.equal(original.includes('".dng"'), false, 'RAW original preview-ticket allowlist must remain closed')
  assert.equal(original.includes('".cr3"'), false, 'RAW original preview-ticket allowlist must remain closed')
})

test('HEIC and HEIF resolve to the existing browser-compatible JPEG while JPEG stays native', async () => {
  const {
    xDriveFileUsesRawCompatibilityPreview: raw,
    xDriveFileNeedsBrowserCompatibleImagePreview: compatible,
  } = importPreviewModel()
  for (const file of ['IMG.HEIC', 'IMG.heif', 'nested/path/a.HeIc', 'img.DNG', 'img.ARW']) {
    assert.equal(compatible(file), true, file)
  }
  for (const file of ['IMG.JPG', 'IMG.PNG', 'IMG.avif', 'IMG.MP4', 'IMG.LIVP']) {
    assert.equal(compatible(file), false, file)
  }
  assert.equal(raw('IMG.HEIC'), false, 'existing RAW-only semantics stay unchanged')

  // Execute the production Web Gallery port; verify actual dispatch with
  // a real abort signal and revision, not only a filename/source regex.
  const js = ts.transpileModule(source('web/src/mediaGalleryAdapter.ts'), {
    fileName: 'RealWebGalleryAdapter.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  const mocks = {
    '@xdrive/ui/mui': {
      createXDriveMediaGalleryDataSource: port => port,
      xDriveMediaGalleryTrashRoots: () => [],
    },
    '../../ui/shared/src': {
      ...importPreviewModel(),
      xDriveCompleteLivePhotoOriginalNodeIDs: () => [],
    },
  }
  new Function('exports', 'module', 'require', js)(mod.exports, mod, name => {
    assert.ok(name in mocks, 'unexpected Gallery adapter import: ' + name)
    return mocks[name]
  })
  const calls = []
  const port = mod.exports.createWebMediaGalleryDataSource({
    mediaAnalysisPreviewURL: async (...args) => {
      calls.push(['jpeg-derivative', ...args]); return 'blob:jpeg'
    },
    filePreviewURL: async (...args) => {
      calls.push(['original', ...args]); return 'blob:original'
    },
    mediaLivePhotoStillURL: async (...args) => {
      calls.push(['live-still', ...args]); return 'blob:still'
    },
  })
  const signal = new AbortController().signal
  const progress = () => {}
  assert.equal(await port.loadPreviewURL(42, 'image', signal, 'IMG_0042.HEIC', 7, progress), 'blob:jpeg')
  assert.deepEqual(calls.pop(), ['jpeg-derivative', 42, signal, 7, progress],
    'HEIC preview reuses the authenticated revision-fenced analysis-preview endpoint')
  assert.equal(await port.loadPreviewURL(43, 'image', signal, 'IMG_0043.HEIF', 8, progress), 'blob:jpeg')
  assert.equal(calls.pop()[0], 'jpeg-derivative')
  assert.equal(await port.loadPreviewURL(44, 'image', signal, 'IMG_0044.JPG', 9, progress), 'blob:original')
  assert.deepEqual(calls.pop(), ['original', 44, signal],
    'native JPEG is not needlessly rendered on the Server')
  assert.equal(await port.loadPreviewURL(45, 'live_photo', signal, 'IMG_0045.LIVP', 10), 'blob:still')
  assert.deepEqual(calls.pop(), ['live-still', 45, signal],
    'Live Photo semantics retain the dedicated still endpoint')
})
