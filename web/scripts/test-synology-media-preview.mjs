#!/usr/bin/env node
// Browser-only Owner binary preview: strict byte paging, genuine SHA-256
// integrity, file magic, revocation lifecycle, and resource cancellation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, webcrypto } from 'node:crypto'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(repo, 'ui/shared/src/synology-media-preview.ts')
const source = fs.readFileSync(filename, 'utf8')
const code = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((code.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
let created = []
const exports = {}
const module = { exports }
const mockURL = {
  createObjectURL(blob) {
    created.push(blob)
    return 'blob:https://nas.example/' + created.length
  },
}
const context = vm.createContext({
  module, exports, crypto: webcrypto, Blob, Uint8Array,
  URL: mockURL, Buffer, Promise, AbortController,
  require(name) {
    assert.equal(name, './synology-backup-adapter')
    return { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES: 256 << 10 }
  },
})
vm.runInContext(code.outputText, context, { filename, timeout: 1000 })
const { xDriveSynologyPreviewMIME, xDriveSynologyLoadBoundedMediaPreview,
  XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES } = module.exports
assert.equal(xDriveSynologyPreviewMIME('photo.JPG'), 'image/jpeg')
assert.equal(xDriveSynologyPreviewMIME('scan.PDF'), 'application/pdf')
for (const name of ['file.svg', 'video.mp4', 'movie.mov', 'test.html', 'unknown.bin']) {
  assert.equal(xDriveSynologyPreviewMIME(name), null)
}
const png = Buffer.alloc((256 << 10) + 13, 0)
Buffer.from([137,80,78,71,13,10,26,10]).copy(png, 0)
const originalSHA = createHash('sha256').update(png).digest('hex')
const item = { id: 42, name: 'image.png', kind: 'file',
  size: png.length, revision: 7 }
const progress = []
let requestCount = 0
const validClient = {
  async ownerFileMediaRange(id, revision, offset, length, signal) {
    assert.equal(id, item.id)
    assert.equal(revision, item.revision)
    assert.equal(signal?.aborted, false)
    assert.equal(offset, requestCount === 0 ? 0 : 256 << 10)
    requestCount++
    const data = Uint8Array.from(png.subarray(offset, offset + length))
    return {offset, revision, total: png.length, sha256: originalSHA, data}
  },
}
const signal = new AbortController().signal
const result = await xDriveSynologyLoadBoundedMediaPreview(validClient, item, signal,
  (done, total) => progress.push([done, total]))
assert.equal(result, 'blob:https://nas.example/1')
assert.equal(created.length, 1)
assert.equal(created[0].type, 'image/png')
assert.equal(created[0].size, png.length)
assert.equal(requestCount, 2)
assert.deepEqual(progress, [[0, png.length], [256 << 10, png.length], [png.length, png.length]])
const countAfterSuccess = created.length
const fail = async (client, payload = item, signal = undefined) => {
  await assert.rejects(xDriveSynologyLoadBoundedMediaPreview(client, payload, signal))
  assert.equal(created.length, countAfterSuccess, 'invalid preview escaped to a Blob URL')
}
await fail({ ownerFileMediaRange: async () => {
  throw new Error('should not call unsafe file')
}}, { ...item, name: 'movie.mp4' })
await fail({ ownerFileMediaRange: async () => {
  throw new Error('should not call oversized media')
}}, {...item, size: XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES + 1})
await fail({ ownerFileMediaRange: async () => {
  throw new Error('abort should be local')
}}, item, AbortSignal.abort())

// A changed Owner or file revision across two chunks must never be assembled.
for (const variation of ['second hash', 'wrong total', 'wrong offset', 'corrupt bytes']) {
  let index = 0
  const client = {
    async ownerFileMediaRange(id, revision, offset, length) {
      index++
      const data = Uint8Array.from(png.subarray(offset, offset + length))
      if (variation === 'corrupt bytes' && index === 2) data[0] ^= 0xff
      return {
        offset: variation === 'wrong offset' && index === 2 ? offset - 1 : offset,
        total: variation === 'wrong total' && index === 2 ? png.length + 1 : png.length,
        revision, data,
        sha256: variation === 'second hash' && index === 2 ? 'b'.repeat(64) : originalSHA,
      }
    },
  }
  await fail(client)
}
const wrongMagic = Buffer.from('%PDF-1.7\n')
await fail({
  async ownerFileMediaRange(id, revision, offset, length) {
    return { offset, revision, total: wrongMagic.length, sha256: createHash('sha256').update(wrongMagic).digest('hex'),
      data: Uint8Array.from(wrongMagic) }
  },
}, {...item, size: wrongMagic.length})
const page = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
assert.match(page, /loadPreviewURL=\{loadMediaPreview\}/)
assert.match(page, /<XDriveFileQuickLookDialog/)
assert.match(page, /xDriveSynologyLoadBoundedMediaPreview/)
const previewSurface = fs.readFileSync(
  path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'), 'utf8')
assert.match(previewSurface, /setURLDownloadProgress/)
assert.match(previewSurface, /loaders\.url\(currentTarget, previewKind, controller\.signal,/)
assert.match(previewSurface, /loading && previewKind === 'pdf'/)
assert.match(previewSurface, /totalBytes=\{urlDownloadProgress\?\.totalBytes\}/)
console.log('DSM Owner safe media Blob: canonical common Viewer, 256 KiB ranges, true SHA-256, magic and cancellation')
