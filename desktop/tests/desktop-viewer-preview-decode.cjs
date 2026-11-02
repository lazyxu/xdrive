'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const helperPath = path.join(root, 'desktop/src/renderer/desktopViewerPreviewDecode.ts')
const helperSource = fs.readFileSync(helperPath, 'utf8')
const js = ts.transpileModule(helperSource, {
  fileName: helperPath, reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
})
assert.deepEqual((js.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])

const created = new Map()
const revoked = []
const registered = []
let number = 0
let rejectWebP = false
let stallWebP = false
let resolveStalled

const fakeURL = {
  createObjectURL(blob) {
    const url = 'blob:xdrive-desktop-preview-' + ++number
    created.set(url, blob)
    return url
  },
  revokeObjectURL(url) { revoked.push(url) },
}
class ViewerImage {
  set src(url) { this.url = url }
  decode() {
    const blob = created.get(this.url)
    if (!blob) return Promise.reject(new Error('missing image bytes'))
    if (rejectWebP && blob.type === 'image/webp') {
      return Promise.reject(new Error('Chromium rejected WebP decoder'))
    }
    if (stallWebP && blob.type === 'image/webp') {
      return new Promise(resolve => {
        resolveStalled = () => {
          this.naturalWidth = 4096
          this.naturalHeight = 3072
          resolve()
        }
      })
    }
    this.naturalWidth = 4096
    this.naturalHeight = 3072
    return Promise.resolve()
  }
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', 'URL', 'Image', js.outputText)(
  mod, mod.exports, name => {
    if (name === '@xdrive/shared') {
      return { xDriveRegisterViewerImageSource: (url, meta) => registered.push({ url, ...meta }) }
    }
    throw Error('Unexpected viewer preview import ' + name)
  }, fakeURL, ViewerImage,
)
const {
  xDriveDesktopDecodeViewerPreviewURL: decode,
  xDriveDesktopRegisterLegacyJPEGViewerPreviewURL: registerLegacyJPEG,
} = mod.exports
const raw = format => new Blob([new Uint8Array(24)], { type: 'image/' + format })

function reset() {
  created.clear()
  revoked.length = 0
  registered.length = 0
  number = 0
  rejectWebP = false
  stallWebP = false
  resolveStalled = undefined
}

test('Desktop Gallery and FileExplorer both use the same decode gate for WebP/JPEG', () => {
  for (const file of ['mediaGalleryAdapter.ts', 'DesktopFileExplorer.tsx']) {
    const source = fs.readFileSync(path.join(root, 'desktop/src/renderer', file), 'utf8')
    assert.match(source, /import \{ xDriveDesktopDecodeViewerPreviewURL \}/)
    assert.match(source, /for \(const format of \['webp', 'jpeg'\] as const\)/)
    assert.match(source, /await xDriveDesktopDecodeViewerPreviewURL\(blob, format, signal\)/)
    assert.match(source, /xDriveDesktopRegisterLegacyJPEGViewerPreviewURL\(blob\)/,
      'both entry points must report the shared legacy JPEG Q84 metadata')
  }
})

test('a decoded WebP is admitted with exact quality/bytes', async () => {
  reset()
  const url = await decode(raw('webp'), 'webp')
  assert.equal(url, 'blob:xdrive-desktop-preview-1')
  assert.deepEqual(revoked, [])
  assert.deepEqual(registered, [{
    url, format: 'WebP', quality: 90, byteSize: 24,
  }])
})

test('legacy analysis JPEG fallback records its actual Q84 format and byte count', () => {
  reset()
  const blob = raw('jpeg')
  const url = registerLegacyJPEG(blob)
  assert.equal(url, 'blob:xdrive-desktop-preview-1')
  assert.equal(created.get(url), blob)
  assert.deepEqual(registered, [{
    url, format: 'JPEG', quality: 84, byteSize: 24,
  }])
  assert.deepEqual(revoked, [])
})

test('empty legacy JPEG fallback is rejected without publishing an image source', () => {
  reset()
  assert.throws(() => registerLegacyJPEG(new Blob([], { type: 'image/jpeg' })),
    /Empty Desktop legacy JPEG/)
  assert.equal(number, 0)
  assert.deepEqual(registered, [])
  assert.deepEqual(revoked, [])
})

test('decoder rejected WebP revokes its Blob and permits JPEG fallback', async () => {
  reset()
  rejectWebP = true
  await assert.rejects(decode(raw('webp'), 'webp'), /WebP decoder/)
  assert.deepEqual(revoked, ['blob:xdrive-desktop-preview-1'])
  assert.deepEqual(registered, [])
  const url = await decode(raw('jpeg'), 'jpeg')
  assert.equal(url, 'blob:xdrive-desktop-preview-2')
  assert.deepEqual(registered, [{
    url, format: 'JPEG', quality: 93, byteSize: 24,
  }])
})

test('abort during an unfinished Chromium image decode revokes the original URL', async () => {
  reset()
  stallWebP = true
  const controller = new AbortController()
  const pending = decode(raw('webp'), 'webp', controller.signal)
  await Promise.resolve()
  assert.equal(typeof resolveStalled, 'function')
  controller.abort()
  await assert.rejects(pending, /abort/i)
  assert.deepEqual(revoked, ['blob:xdrive-desktop-preview-1'])
  resolveStalled()
  await Promise.resolve()
  assert.deepEqual(registered, [], 'a retired request cannot publish a decoded URL')
})

test('oversized decoded dimensions never masquerade as 4K', async () => {
  reset()
  const original = ViewerImage.prototype.decode
  ViewerImage.prototype.decode = async function () {
    this.naturalWidth = 6000
    this.naturalHeight = 4000
  }
  try {
    await assert.rejects(decode(raw('jpeg'), 'jpeg'), /dimensions/)
    assert.deepEqual(revoked, ['blob:xdrive-desktop-preview-1'])
    assert.equal(registered.length, 0)
  } finally {
    ViewerImage.prototype.decode = original
  }
})
