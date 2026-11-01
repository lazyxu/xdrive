'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../../ui/shared/src/synology-viewer-preview.ts')
const code = fs.readFileSync(sourcePath, 'utf8')
const js = ts.transpileModule(code, {
  fileName: sourcePath, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

const created = new Map()
const revoked = []
const registered = []
let nextURL = 0
let rejectWebP = false
const fakeURL = {
  createObjectURL: blob => {
    const url = 'blob:owner-hd-' + (++nextURL)
    created.set(url, blob)
    return url
  },
  revokeObjectURL: url => revoked.push(url),
}
class ViewerImage {
  set src(url) { this.url = url }
  async decode() {
    const blob = created.get(this.url)
    if (!blob || (rejectWebP && blob.type === 'image/webp')) {
      throw Error('native browser decoder rejected the image')
    }
    this.naturalWidth = 4000
    this.naturalHeight = 3000
  }
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', 'Image', 'URL', 'Blob', js.outputText)(
  mod, mod.exports, name => {
    if (name === './synology-backup-adapter') return {
      XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES: 256 << 10,
      XDRIVE_SYNOLOGY_VIEWER_PREVIEW_MAX_BYTES: 64 << 20,
    }
    if (name === './file-preview') return {
      xDriveFileNeedsBrowserCompatibleImagePreview: file => /\.(heic|heif|cr3)$/i.test(file),
    }
    if (name === './mui/ViewerImageSourceInfo') return {
      xDriveRegisterViewerImageSource: (url, meta) => registered.push({ url, ...meta }),
    }
    throw Error('unexpected Owner Viewer import ' + name)
  }, ViewerImage, fakeURL, Blob,
)
const { xDriveSynologyLoadViewerPreview: load, xDriveSynologyViewerNeedsDerived: needs } = mod.exports

function encodedWebP(length = 20) {
  const bytes = new Uint8Array(length)
  bytes.set(Buffer.from('RIFF'), 0)
  new DataView(bytes.buffer).setUint32(4, length - 8, true)
  bytes.set(Buffer.from('WEBPVP8 '), 8)
  return bytes
}
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 3, 2, 1, 0xff, 0xd9])
const original = { id: 17, name: 'photo.heic', kind: 'file', revision: 9 }
const signature = format => '"media-viewer:' + 'a'.repeat(64) + ':17:9:' + format + ':v1"'
function reader(formats = { webp: encodedWebP(), jpeg }) {
  const calls = []
  return {
    calls,
    ownerFileViewerPreviewRange: async (id, revision, format, offset, length, signal) => {
      calls.push({ id, revision, format, offset, length, signal })
      const data = formats[format]
      if (!data) throw Error('format unavailable')
      return { nodeID: id, revision, format, offset, total: data.length,
        etag: signature(format), data: data.slice(offset, Math.min(offset + length, data.length)) }
    },
  }
}
function reset() {
  created.clear()
  revoked.length = 0
  registered.length = 0
  nextURL = 0
  rejectWebP = false
}

test('DSM accepts a decoded WebP 4K still and retains exact format and byte size', async () => {
  reset()
  assert.equal(needs('photo.heic'), true)
  assert.equal(needs('movie.livp'), true)
  assert.equal(needs('plain.jpg'), false)
  const client = reader()
  const progress = []
  const url = await load(client, original, undefined, (...args) => progress.push(args))
  assert.equal(url, 'blob:owner-hd-1')
  assert.equal(created.get(url).type, 'image/webp')
  assert.deepEqual(client.calls.map(x => x.format), ['webp'])
  assert.deepEqual(registered, [{ url, format: 'WebP', quality: 90, byteSize: 20 }])
  assert.equal(progress.at(-1)[0], 20)
  assert.equal(progress.at(-1)[1], 20)
  assert.deepEqual(revoked, [])
})

test('a valid WebP RIFF header is not enough: a decode failure must request JPEG fallback', async () => {
  reset()
  rejectWebP = true
  const client = reader()
  const url = await load(client, original)
  assert.deepEqual(client.calls.map(x => x.format), ['webp', 'jpeg'])
  assert.deepEqual(revoked, ['blob:owner-hd-1'])
  assert.equal(created.get(url).type, 'image/jpeg')
  assert.deepEqual(registered, [{ url, format: 'JPEG', quality: 93, byteSize: jpeg.length }])
})

test('superseded ETag in later chunks cannot publish a combined old/new Owner image', async () => {
  reset()
  const client = reader({ webp: encodedWebP((256 << 10) + 12) })
  const originalRead = client.ownerFileViewerPreviewRange
  client.ownerFileViewerPreviewRange = async (...args) => {
    const part = await originalRead(...args)
    if (part.offset > 0) return { ...part, etag: signature('webp').replace('a'.repeat(64), 'b'.repeat(64)) }
    return part
  }
  await assert.rejects(load(client, original), /format unavailable/)
  assert.equal(created.size, 0)
  assert.equal(registered.length, 0)
  assert.deepEqual(client.calls.map(c => [c.format, c.offset]),
    [['webp', 0], ['webp', 256 << 10], ['jpeg', 0]])
})

test('aborted private media read cannot start a JPEG retry or publish a URL', async () => {
  reset()
  const controller = new AbortController()
  const client = reader()
  client.ownerFileViewerPreviewRange = async () => {
    controller.abort()
    return { nodeID: 17, revision: 9, format: 'webp', offset: 0,
      total: 20, etag: signature('webp'), data: encodedWebP() }
  }
  await assert.rejects(load(client, original, controller.signal), /abort/i)
  assert.equal(registered.length, 0)
  assert.equal(created.size, 0)
})
