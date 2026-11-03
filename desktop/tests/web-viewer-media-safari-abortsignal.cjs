'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const apiAST = ts.createSourceFile('api.ts', read('web/src/api.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const apiClass = apiAST.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'XDriveApi')
assert.ok(apiClass, 'extract methods from the real production XDriveApi')

function method(name) {
  const found = apiClass.members.find(node => ts.isMethodDeclaration(node) && node.name?.getText(apiAST) === name)
  assert.ok(found, 'production XDriveApi.' + name + ' must exist')
  return found.getText(apiAST)
}
function helper(name) {
  const found = apiAST.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(found, 'production helper ' + name + ' must exist')
  return found.getText(apiAST)
}

const mediaSource = read('web/src/mediaBinaryProgress.ts')
const mediaJS = ts.transpileModule(mediaSource, {
  fileName: 'mediaBinaryProgress.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mediaModule = { exports: {} }
new Function('exports', 'module', 'require', mediaJS)(mediaModule.exports, mediaModule, require)
const requireMedia = mediaModule.exports
assert.equal(typeof requireMedia.xDriveAssertMediaReadActive, 'function',
  'Viewer API must share the production WebKit-compatible cancellation gate')

for (const name of [
  'mediaThumbnail', 'mediaAnalysisPreview', 'mediaAnalysisPreviewURL',
  'mediaViewerPreviewURL', 'mediaLivePhotoMotionURL',
  'mediaLivePhotoStillURL', 'filePreviewURL',
]) {
  const source = apiClass.members.find(node =>
    ts.isMethodDeclaration(node) && node.name?.getText(apiAST) === name).getText(apiAST)
  assert.doesNotMatch(source, /throwIfAborted/,
    name + ' must not call an optional WebKit AbortSignal method')
}

const harness = [
  "const API_BASE = 'https://xdrive.test'",
  "class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }",
  "const registered = []",
  "function xDriveRegisterViewerImageSource(url, details) { registered.push({ url, details }) }",
  "const xDriveAssertMediaReadActive = requireMedia.xDriveAssertMediaReadActive",
  "const xDriveMediaResponseBlob = requireMedia.xDriveMediaResponseBlob",
  "function appendFileExplorerGrouping() {}",
  helper('xDriveThumbnailRetryAfter503'),
  helper('xDriveThumbnailHasSafeImageEnvelope'),
  "class OwnerApi {",
  "  constructor(request) { this.request = request; this.session = { accessToken: '', refreshToken: '' } }",
  "  async ensureFresh(signal) { if (signal?.aborted) throw new DOMException('aborted', 'AbortError') }",
  "  async refresh() {}",
  method('mediaThumbnail'),
  method('mediaAnalysisPreview'),
  method('mediaAnalysisPreviewURL'),
  method('mediaViewerPreviewURL'),
  method('mediaLivePhotoMotionURL'),
  method('mediaLivePhotoStillURL'),
  method('filePreviewURL'),
  method('listRange'),
  "}",
  "exports.OwnerApi = OwnerApi",
  "exports.registered = registered",
].join('\n')
const compiled = ts.transpileModule(harness, {
  fileName: 'ViewerMediaApi.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiledModule = { exports: {} }
new Function('exports', 'module', 'requireMedia', compiled)(
  compiledModule.exports, compiledModule, requireMedia)
const { OwnerApi } = compiledModule.exports

function legacyController(abort = false) {
  const controller = new AbortController()
  Object.defineProperty(controller.signal, 'throwIfAborted', { configurable: true, value: undefined })
  if (abort) controller.abort()
  return controller
}
function jpegResponse() {
  const bytes = new Uint8Array(80)
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff
  bytes[78] = 0xff; bytes[79] = 0xd9
  return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
}

test('Viewer media API methods work on legacy WebKit without AbortSignal.throwIfAborted', async () => {
  const oldFetch = global.fetch
  const oldCreate = URL.createObjectURL
  const fetchCalls = []
  const requestCalls = []
  let objectURL = 0
  URL.createObjectURL = () => 'blob:viewer-media-' + (++objectURL)
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    if (String(url).includes('/thumbnail')) return jpegResponse()
    if (String(url).includes('/analysis-preview')) return jpegResponse()
    if (String(url).includes('/viewer-preview')) {
      return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), {
        status: 200, headers: { 'Content-Type': 'image/webp' },
      })
    }
    throw new Error('unexpected Viewer media fetch: ' + url)
  }
  const api = new OwnerApi(async (url, init) => {
    requestCalls.push({ url, init })
    if (url.endsWith('/live-photo-motion-ticket')) {
      return { url: '/api/v1/media-live-photo-motion/7?ticket=motion', kind: 'video', mime_type: 'video/mp4' }
    }
    if (url.endsWith('/live-photo-still-ticket')) {
      return { url: '/api/v1/media-live-photo-still/7?ticket=still', kind: 'image', mime_type: 'image/jpeg' }
    }
    if (url.endsWith('/preview-ticket')) {
      return { url: '/api/v1/file-preview/7?ticket=pdf', kind: 'pdf', mime_type: 'application/pdf' }
    }
    throw new Error('unexpected Viewer ticket request: ' + url)
  })
  const controller = legacyController()
  const signal = controller.signal
  try {
    assert.equal(typeof signal.throwIfAborted, 'undefined')
    assert.equal((await api.mediaThumbnail(7, signal, 3)).size, 80)
    assert.equal((await api.mediaAnalysisPreview(7, signal, 3)).size, 80)
    assert.match(await api.mediaAnalysisPreviewURL(7, signal, 3), /^blob:viewer-media-/)
    assert.match(await api.mediaViewerPreviewURL(7, signal, 3), /^blob:viewer-media-/)
    assert.equal(await api.mediaLivePhotoMotionURL(7, signal),
      'https://xdrive.test/api/v1/media-live-photo-motion/7?ticket=motion')
    assert.equal(await api.mediaLivePhotoStillURL(7, signal),
      'https://xdrive.test/api/v1/media-live-photo-still/7?ticket=still')
    assert.equal(await api.filePreviewURL(7, signal),
      'https://xdrive.test/api/v1/file-preview/7?ticket=pdf')
    assert.equal(fetchCalls.length, 4)
    assert.ok(fetchCalls.every(call => call.init.signal === signal),
      'all binary derivative requests must retain the exact Viewer AbortSignal')
    assert.equal(requestCalls.length, 3)
    assert.ok(requestCalls.every(call => call.init.signal === signal),
      'all signed ticket requests must retain the exact Viewer AbortSignal')
    assert.ok(compiledModule.exports.registered.some(value => value.details.format === 'WebP'))
    assert.ok(compiledModule.exports.registered.some(value => value.details.format === 'JPEG'))
  } finally {
    global.fetch = oldFetch
    URL.createObjectURL = oldCreate
  }
})

test('Files directory Viewer range works on legacy WebKit and refuses an aborted range', async () => {
  const calls = []
  const api = new OwnerApi(async (url, init) => {
    calls.push({ url, init })
    return { items: [], total_count: 0, offset: 0, limit: 128, sort: 'name', order: 'asc' }
  })
  const active = legacyController()
  assert.equal(typeof active.signal.throwIfAborted, 'undefined')
  const page = await api.listRange(7, 0, 128, 'name', 'asc', true, undefined, active.signal)
  assert.equal(page.total_count, 0)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^\/api\/v1\/nodes\/7\/children\?/)
  assert.strictEqual(calls[0].init.signal, active.signal,
    'Files directory browsing keeps the exact Viewer cancellation signal')

  const cancelled = legacyController(true)
  assert.throws(
    () => api.listRange(7, 0, 128, 'name', 'asc', true, undefined, cancelled.signal),
    error => error?.name === 'AbortError',
    'the synchronous range admission must reject a cancelled legacy-WebKit signal',
  )
  assert.equal(calls.length, 1,
    'an already-aborted legacy WebKit Viewer must not issue another directory range')
})

test('pre-aborted legacy WebKit Viewer signals fail closed before ticket or media HTTP', async () => {
  const fetchCalls = []
  const requestCalls = []
  const oldFetch = global.fetch
  global.fetch = async (...args) => { fetchCalls.push(args); return jpegResponse() }
  const api = new OwnerApi(async (...args) => {
    requestCalls.push(args)
    return { url: '/api/v1/file-preview/7?ticket=unexpected', kind: 'pdf', mime_type: 'application/pdf' }
  })
  const methods = [
    signal => api.mediaThumbnail(7, signal, 3),
    signal => api.mediaAnalysisPreview(7, signal, 3),
    signal => api.mediaAnalysisPreviewURL(7, signal, 3),
    signal => api.mediaViewerPreviewURL(7, signal, 3),
    signal => api.mediaLivePhotoMotionURL(7, signal),
    signal => api.mediaLivePhotoStillURL(7, signal),
    signal => api.filePreviewURL(7, signal),
  ]
  try {
    for (const run of methods) {
      const controller = legacyController(true)
      await assert.rejects(run(controller.signal), error => error?.name === 'AbortError')
    }
    assert.deepEqual(fetchCalls, [], 'a cancelled Viewer cannot start a derivative GET')
    assert.deepEqual(requestCalls, [], 'a cancelled Viewer cannot issue another signed ticket POST')
  } finally {
    global.fetch = oldFetch
  }
})

test('Viewer fallback adapters use the same gate instead of optional WebKit methods', () => {
  const gallery = read('web/src/mediaGalleryAdapter.ts')
  const routed = read('web/src/WebFileViewerApps.tsx')
  assert.match(gallery, /xDriveAssertMediaReadActive\(signal\)/)
  assert.match(routed, /xDriveAssertMediaReadActive\(signal\)/)
  assert.match(gallery, /import \{ xDriveAssertMediaReadActive \} from '\.\/mediaBinaryProgress'/)
  assert.match(routed, /import \{ xDriveAssertMediaReadActive \} from '\.\/mediaBinaryProgress'/)
})
