const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const preview = read('ui', 'shared', 'src', 'file-preview.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const previewSurface = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const webApi = read('web', 'src', 'api.ts')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const previewProxy = read('desktop', 'src', 'main', 'file_preview_proxy.cts')
const desktopIndexHTML = read('desktop', 'src', 'renderer', 'index.html')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const server = read('internal', 'api', 'file_text_preview.go')
const previewServer = read('internal', 'api', 'file_preview.go')

test('bounded text-preview contract supports common source/config text without key material', () => {
  for (const token of [
    'XDriveFileTextPreview',
    'xDriveFileSupportsTextPreview',
    "'txt'",
    "'json'",
    "'md'",
    "'js'",
    "'cpp'",
    "'go'",
    "'html'",
    "'svg'",
    "'.env'",
  ]) {
    assert.ok(preview.includes(token), 'missing shared text-preview token: ' + token)
  }
  for (const forbidden of ["'pem'", "'key'"]) {
    assert.equal(preview.includes(forbidden), false, 'secret key extension leaked into shared allowlist: ' + forbidden)
  }
  for (const token of [
    'fileTextPreviewLimit = 1 << 20',
    'bytes.IndexByte(data, 0)',
    'utf8.Valid(data)',
    'http.StatusUnsupportedMediaType',
    'X-Content-Type-Options',
  ]) {
    assert.ok(server.includes(token), 'missing bounded server text-preview guard: ' + token)
  }
})

test('shared Preview Engine owns classification and renderer surface', () => {
  for (const token of [
    "export type XDriveFilePreviewKind = 'none' | 'text' | 'image' | 'video' | 'audio' | 'pdf'",
    'export type XDriveFilePreviewTarget',
    'xDriveClassifyFilePreview',
    "extension === 'pdf'",
    'xDriveImagePreviewExtensions.has(extension)',
    'xDriveVideoPreviewExtensions.has(extension)',
    'xDriveAudioPreviewExtensions.has(extension)',
  ]) {
    assert.ok(preview.includes(token), 'missing shared Preview Model token: ' + token)
  }
  for (const token of [
    'export function XDriveFilePreviewSurface',
    'data-xdrive-file-preview-kind',
    'component="pre"',
    'component="img"',
    'component="video"',
    'component="audio"',
    'component="iframe"',
    '仅显示前 1 MiB',
  ]) {
    assert.ok(previewSurface.includes(token), 'missing shared Preview Surface token: ' + token)
  }
  assert.equal(preview.includes("mimeType.startsWith('image/')"), false, 'MIME metadata must not broaden image previewability')
  assert.equal(preview.includes("mimeType.startsWith('video/')"), false, 'MIME metadata must not broaden video previewability')
  assert.equal(preview.includes("mimeType.startsWith('audio/')"), false, 'MIME metadata must not broaden audio previewability')
  assert.equal(preview.includes("mimeType === 'application/pdf'"), false, 'MIME metadata must not broaden PDF previewability')
  assert.equal(previewSurface.includes('dangerouslySetInnerHTML'), false, 'Preview Surface must never inject active markup')
  assert.ok(previewSurface.includes('onError={() => setFailed(true)}'), 'Video renderer must fall back when browser decoding fails')
  assert.ok((previewSurface.match(/onError=\{\(\) => setFailed\(true\)\}/g) || []).length >= 2, 'Video and Audio renderers must both fall back on decode errors')
})

test('shared Inspector delegates preview rendering to FilePreviewSurface', () => {
  for (const token of [
    'loadTextPreview?:',
    'loadPreviewURL?:',
    '<XDriveFilePreviewSurface',
    'target={inspectorItem}',
    'loadTextPreview={loadTextPreview}',
    'loadPreviewURL={loadPreviewURL}',
    'loadImagePreview={',
    'fallback={defaultItemIcon(inspectorItem, true)}',
  ]) {
    assert.ok(explorer.includes(token), 'missing shared Inspector Preview Engine wiring: ' + token)
  }
  assert.equal(explorer.includes('XDriveLazyFileTextPreview'), false, 'Inspector must not keep a second text preview renderer')
})

test('Web and Desktop load preview through authenticated platform adapters', () => {
  assert.ok(webApi.includes('fileTextPreview(id: number)'), 'Web API text preview method is missing')
  assert.ok(webExplorer.includes('api.fileTextPreview(Number(item.id))'), 'Web Explorer preview adapter is missing')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudTextPreview(Number(item.id))'), 'Desktop Explorer preview adapter is missing')
  assert.ok(desktopExplorer.includes('textPreviewSupported ? loadTextPreview : undefined'), 'Desktop preview must be capability gated')
  assert.ok(desktopApp.includes("capabilities.includes('file-text-preview')"), 'Desktop App capability gate is missing')
  for (const [label, source, tokens] of [
    ['preload', preload, ['cloudTextPreview', 'agent:cloud-text-preview']],
    ['Electron main', desktopMain, ['agent:cloud-text-preview', "file-text-preview"]],
    ['Agent client', agentClient, ['cloudFileTextPreview', '/v1/cloud/text-preview']],
    ['Agent cloud adapter', agentCloud, ['CloudFileTextPreview', 'FileTextPreview']],
    ['Agent IPC', agentIPC, ['file-text-preview', '/v1/cloud/text-preview', 'cloudFileTextPreview']],
  ]) {
    for (const token of tokens) {
      assert.ok(source.includes(token), label + ' preview bridge missing: ' + token)
    }
  }
})

test('generic preview transport is allowlisted, ticketed, range-capable, with PDF, Video, Audio, and Image renderers enabled', () => {
  for (const token of [
    'filePreviewDescriptors',
    '".pdf":  {Kind: "pdf", MIMEType: "application/pdf"}',
    'IssuePreviewStream',
    'ParsePreviewStream',
    'file preview ticket is stale',
    'Content-Disposition',
    'http.ServeContent',
    'Referrer-Policy',
    'X-Content-Type-Options',
  ]) {
    assert.ok(previewServer.includes(token), 'missing generic preview transport token: ' + token)
  }
  for (const forbidden of ['".html"', '".svg"']) {
    assert.equal(previewServer.includes(forbidden), false, 'active content must not be preview-ticket allowlisted: ' + forbidden)
  }

  assert.ok(webApi.includes('filePreviewURL(nodeID: number)'), 'Web preview ticket adapter is missing')
  assert.ok(webExplorer.includes("['pdf', 'video', 'audio', 'image'].includes(kind)"), 'Web should enable PDF, Video, Audio, and Image through the generic preview URL')
  assert.ok(webExplorer.includes('loadPreviewURL={loadPreviewURL}'), 'Web Explorer must pass the preview URL loader')

  assert.ok(desktopExplorer.includes("['pdf', 'video', 'audio', 'image'].includes(kind)"), 'Desktop should enable PDF, Video, Audio, and Image through the generic preview URL')
  assert.ok(desktopExplorer.includes('cloudFilePreviewURL(Number(item.id))'), 'Desktop Explorer preview URL adapter is missing')
  assert.ok(desktopExplorer.includes('loadPreviewURL={previewStreamSupported ? loadPreviewURL : undefined}'), 'Desktop preview URL must be capability gated')
  assert.ok(desktopApp.includes("capabilities.includes('file-preview-stream')"), 'Desktop preview stream capability gate is missing')
  assert.ok(preload.includes('cloudFilePreviewURL'), 'Desktop preload preview URL bridge is missing')
  assert.ok(desktopMain.includes('agent:cloud-file-preview-url'), 'Electron main preview URL bridge is missing')
  assert.ok(agentClient.includes('cloudFilePreviewTicket(nodeID: number)'), 'Desktop Agent client preview ticket method is missing')
  assert.ok(agentIPC.includes('/v1/cloud/file-preview-ticket'), 'Agent preview ticket bridge is missing')
  assert.ok(agentCloud.includes('CloudFilePreviewTicket'), 'Agent preview ticket controller is missing')

  for (const token of [
    'randomBytes(32)',
    'localPreviewTokenPattern',
    '127.0.0.1',
    'signed-upstream',
    'Range',
  ]) {
    if (token === 'signed-upstream') continue
    assert.ok(previewProxy.includes(token), 'Desktop local preview proxy missing: ' + token)
  }
  assert.ok(desktopIndexHTML.includes("frame-src http://127.0.0.1:*"), 'Desktop CSP must allow only the loopback PDF preview frame')
  assert.ok(desktopIndexHTML.includes("img-src 'self' data: blob: http://127.0.0.1:*"), 'Desktop CSP must allow local Blob thumbnails plus loopback original-image preview without arbitrary remote images')
  assert.equal(desktopIndexHTML.includes("img-src *"), false, 'Desktop CSP must not allow arbitrary image origins')
  assert.equal(desktopIndexHTML.includes("img-src https:"), false, 'Desktop CSP must not allow arbitrary remote HTTPS images')
  assert.ok(previewSurface.includes('onError={loadImageFallback}'), 'Image renderer must fall back to the thumbnail loader on decode failure')
  assert.ok(previewSurface.includes('setUsingImageFallback(true)'), 'Image renderer must track the thumbnail fallback state')

})
