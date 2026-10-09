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
  assert.ok(image.includes('const requestController = new AbortController()'))
  assert.ok(image.includes('requestController.abort()'))
  assert.ok(image.includes('currentLoaders.target, kind, requestController.signal'))
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
    assert.ok(adapter.includes('xDriveFileUsesRawCompatibilityPreview'))
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
    assert.ok(component.includes('xDriveFileUsesRawCompatibilityPreview'))
    assert.ok(component.includes('xDriveDesktopViewportRequest('))
    assert.ok(component.includes('getMediaAnalysisPreview('))
  }
  const original = source('internal/api/file_preview.go')
  assert.equal(original.includes('".dng"'), false, 'RAW original preview-ticket allowlist must remain closed')
  assert.equal(original.includes('".cr3"'), false, 'RAW original preview-ticket allowlist must remain closed')
})
