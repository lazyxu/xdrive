#!/usr/bin/env node
// DSM native video/audio must remain an authenticated same-origin media
// resource for the ORIGINAL shared Viewer, never a 32 MiB Blob or bearer URL.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
function transpile(relative, requires = {}, context = {}) {
  const filename = path.join(repo, relative)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.equal((compiled.diagnostics ?? []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0)
  const exports = {}
  const module = { exports }
  const ctx = vm.createContext({
    module, exports, URL, Uint8Array, TextEncoder, Promise,
    ...context,
    require(name) {
      assert.ok(name in requires, 'unapproved DSM import ' + name)
      return requires[name]
    },
  })
  vm.runInContext(compiled.outputText, ctx, { filename, timeout: 1000 })
  return module.exports
}
const location = {
  href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
  origin: 'https://nas.example',
}
const adapter = transpile('ui/shared/src/synology-backup-adapter.ts', {}, {
  window: { location },
})
const cgi = 'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi'
const local = adapter.createXDriveSynologyBackupLocalClient(cgi)
assert.throws(() => adapter.createXDriveSynologyBackupLocalClient(
  'https://other.example/webman/3rdparty/xdrivenas/backup.cgi'), /same-origin/)
// Deterministic DSM HEAD stub: no remote network call in fixture tests.
const mediaHEADCalls = []
let mediaHEADStatus = 200
let mediaHEADHeaders = {}
const source = transpile('ui/shared/src/synology-media-stream.ts', {
  './synology-backup-adapter': adapter,
}, {
  fetch: async (url, options) => {
    mediaHEADCalls.push({url, options})
    return {status: mediaHEADStatus, headers: {
      get: name => mediaHEADHeaders[name.toLowerCase()] ?? null,
    }}
  },
})
const { xDriveSynologyLoadNativeMediaStream, xDriveSynologyPlaybackMIME,
  xDriveSynologyNativeStreamMIME, xDriveSynologyPlaybackMagic } = source
for (const [name, mime] of [
  ['clip.MP4', 'video/mp4'], ['clip.m4v', 'video/mp4'],
  ['clip.webm', 'video/webm'], ['audio.mp3', 'audio/mpeg'],
  ['audio.m4a', 'audio/mp4'], ['audio.ogg', 'audio/ogg'],
  ['audio.wav', 'audio/wav'], ['audio.flac', 'audio/flac'],
]) assert.equal(xDriveSynologyPlaybackMIME(name), mime)
for (const name of ['clip.avi', 'clip.mkv', 'clip.mov', 'script.html', 'live.livp']) {
  assert.equal(xDriveSynologyPlaybackMIME(name), null)
}
const data = Uint8Array.from(Buffer.from('\x00\x00\x00\x18ftypisom' + 'x'.repeat(64), 'latin1'))
const file = { id: 42, revision: 7, name: 'clip.mp4',
  size: data.length, kind: 'file' }
const sha = 'a'.repeat(64)
let calls = 0
const checked = {
  ownerFileMediaStreamURL: local.ownerFileMediaStreamURL,
  async ownerFileMediaRange(id, revision, offset, size, signal) {
    calls++
    assert.equal(id, file.id)
    assert.equal(revision, file.revision)
    assert.equal(offset, 0)
    assert.equal(size, file.size)
    assert.equal(signal?.aborted, false)
    return { offset, total: file.size, revision, sha256: sha, data }
  },
}
const signal = new AbortController().signal
mediaHEADHeaders = {
  'content-type': 'video/mp4',
  'accept-ranges': 'bytes',
  'content-length': String(file.size),
  'etag': '"' + sha + '"',
}
const streamURL = await xDriveSynologyLoadNativeMediaStream(checked, file, signal)
assert.equal(mediaHEADCalls.length, 1, 'native video requires an authenticated HEAD')
assert.equal(mediaHEADCalls[0].options.method, 'HEAD')
assert.equal(mediaHEADCalls[0].options.credentials, 'same-origin')
assert.equal(mediaHEADCalls[0].options.mode, 'same-origin')
assert.equal(mediaHEADCalls[0].options.cache, 'no-store')
assert.equal(mediaHEADCalls[0].options.redirect, 'error')
assert.equal(mediaHEADCalls[0].options.referrerPolicy, 'no-referrer')
const parsed = new URL(streamURL)
assert.equal(parsed.origin, location.origin)
assert.equal(parsed.pathname, '/webman/3rdparty/xdrivenas/backup.cgi')
assert.equal(parsed.searchParams.get('op'), 'cloud-media-stream')
assert.equal(parsed.searchParams.get('node_id'), '42')
assert.equal(parsed.searchParams.get('revision'), '7')
assert.equal(parsed.searchParams.get('total'), String(data.length))
assert.equal(parsed.searchParams.get('sha256'), sha)
assert.equal(parsed.searchParams.get('mime'), 'video/mp4')
assert.equal(parsed.searchParams.size, 6)
assert.ok(!/token|bearer|ticket|http%3a|private/i.test(parsed.search))
assert.equal(calls, 1, 'only one tiny Owner byte proof; bytes stream via native media element')

// Missing Owner permission, stale revision or HTML masquerading as a video must
// enter shared Viewer Retry *before* mounting the native playback element.
const videoHEADHeaders = { ...mediaHEADHeaders }
for (const variation of [
  { status: 401 }, { status: 403 },
  { headers: { ...videoHEADHeaders, 'content-type': 'text/html' } },
  { headers: { ...videoHEADHeaders, 'accept-ranges': 'none' } },
  { headers: { ...videoHEADHeaders, 'content-length': '1' } },
  { headers: { ...videoHEADHeaders, 'etag': '"stale-version"' } },
]) {
  mediaHEADStatus = variation.status ?? 200
  mediaHEADHeaders = variation.headers ?? videoHEADHeaders
  await assert.rejects(xDriveSynologyLoadNativeMediaStream(checked, file, signal),
    /Authenticated DSM media Range preflight unavailable/)
}
mediaHEADStatus = 200
mediaHEADHeaders = videoHEADHeaders

// Audio uses the same Owner HTTP contract, without loading the entire file.
const audioBytes = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3])
const audio = { ...file, id: 43, name: 'sound.mp3', size: audioBytes.length }
const audioClient = {
  ownerFileMediaStreamURL: local.ownerFileMediaStreamURL,
  async ownerFileMediaRange(id, revision, offset, length) {
    assert.equal(id, audio.id)
    assert.equal(revision, audio.revision)
    assert.equal(offset, 0)
    assert.equal(length, audioBytes.length)
    return { offset, revision, total: audio.size, sha256: sha, data: audioBytes }
  },
}
mediaHEADHeaders = {
  'content-type': 'audio/mpeg',
  'accept-ranges': 'bytes',
  'content-length': String(audio.size),
  'etag': '"' + sha + '"',
}
const audioURL = await xDriveSynologyLoadNativeMediaStream(audioClient, audio, signal)
assert.equal(new URL(audioURL).searchParams.get('mime'), 'audio/mpeg')
assert.equal(mediaHEADCalls.at(-1).options.method, 'HEAD')

// Large PDFs use the identical bounded, authenticated Owner Range CGI, not
// a 33 MiB renderer Blob. Small PDFs keep the complete SHA-verified path.
assert.equal(xDriveSynologyNativeStreamMIME('scan.PDF'), 'application/pdf')
assert.equal(xDriveSynologyPlaybackMIME('scan.pdf'), null)
const pdfBytes = new Uint8Array(256 << 10)
pdfBytes.set(new TextEncoder().encode('%PDF-1.7\n'), 0)
const pdf = { id: 42, revision: 7, name: 'scan.pdf', size: (32 << 20) + 1, kind: 'file' }
let pdfReads = 0
const pdfClient = {
  ownerFileMediaStreamURL: local.ownerFileMediaStreamURL,
  async ownerFileMediaRange(nodeID, revision, offset, length) {
    pdfReads++
    assert.equal(nodeID, pdf.id)
    assert.equal(revision, pdf.revision)
    assert.equal(offset, 0)
    assert.equal(length, pdfBytes.length)
    return { offset, revision, total: pdf.size, sha256: sha, data: pdfBytes }
  },
}
mediaHEADHeaders = {
  'content-type': 'application/pdf',
  'accept-ranges': 'bytes',
  'content-length': String(pdf.size),
  'etag': '"' + sha + '"',
}
const pdfHEADStart = mediaHEADCalls.length
const pdfURL = new URL(await xDriveSynologyLoadNativeMediaStream(pdfClient, pdf))
assert.equal(pdfURL.origin, location.origin)
assert.equal(pdfURL.searchParams.get('op'), 'cloud-media-stream')
assert.equal(pdfURL.searchParams.get('mime'), 'application/pdf')
assert.equal(pdfURL.searchParams.get('total'), String(pdf.size))
assert.equal(pdfURL.searchParams.size, 6)
assert.equal(pdfReads, 1)
assert.equal(mediaHEADCalls.length, pdfHEADStart + 1, 'exactly one initial PDF HEAD')
assert.equal(mediaHEADCalls[pdfHEADStart].options.method, 'HEAD')
assert.equal(mediaHEADCalls[pdfHEADStart].options.credentials, 'same-origin')
assert.equal(mediaHEADCalls[pdfHEADStart].options.mode, 'same-origin')
assert.equal(mediaHEADCalls[pdfHEADStart].options.cache, 'no-store')
assert.equal(mediaHEADCalls[pdfHEADStart].options.redirect, 'error')
assert.equal(mediaHEADCalls[pdfHEADStart].options.referrerPolicy, 'no-referrer')
for (const variation of [
  {status: 401}, {status: 403}, {status: 404}, {status: 410},
  {headers: {...mediaHEADHeaders, 'content-type': 'text/html'}},
  {headers: {...mediaHEADHeaders, 'accept-ranges': 'none'}},
  {headers: {...mediaHEADHeaders, 'content-length': '1'}},
  {headers: {...mediaHEADHeaders, 'etag': '"stale-version"'}},
]) {
  mediaHEADStatus = variation.status ?? 200
  const valid = mediaHEADHeaders
  mediaHEADHeaders = variation.headers ?? valid
  await assert.rejects(xDriveSynologyLoadNativeMediaStream(pdfClient, pdf, signal),
    /Authenticated DSM PDF Range preflight unavailable/)
  mediaHEADStatus = 200
  mediaHEADHeaders = valid
}
assert.equal(mediaHEADCalls.length, pdfHEADStart + 9, 'every rejected PDF HEAD checked exactly once')
assert.equal(xDriveSynologyPlaybackMagic(pdfBytes, 'application/pdf'), true)
assert.equal(xDriveSynologyPlaybackMagic(
  Uint8Array.from(Buffer.from('<html>unauthorized</html>')), 'application/pdf'), false)
await assert.rejects(xDriveSynologyLoadNativeMediaStream({
  ...pdfClient, async ownerFileMediaRange() { return {
    offset: 0, revision: pdf.revision, total: pdf.size, sha256: sha,
    data: Uint8Array.from(Buffer.from('<html>unauthorized</html>')),
  } },
}, pdf), /trusted/)

const byteProofsBeforeInvalid = calls
for (const invalid of [
  {...file, id: 0}, {...file, revision: 0}, {...file, kind: 'dir'},
  {...file, size: 0}, {...file, size: Number.MAX_SAFE_INTEGER+1},
  {...file, name: 'script.html'},
]) {
  await assert.rejects(xDriveSynologyLoadNativeMediaStream(checked, invalid), /Only Owner/)
}
assert.equal(calls, byteProofsBeforeInvalid, 'invalid media identities reached Agent')
const aborted = new AbortController()
aborted.abort()
await assert.rejects(xDriveSynologyLoadNativeMediaStream(checked, file, aborted.signal), /cancelled/)
assert.equal(calls, byteProofsBeforeInvalid)
for (const corrupt of ['revision', 'total', 'sha256', 'magic']) {
  const wrong = {
    ...checked,
    async ownerFileMediaRange(id, rev, offset, size) {
      const changed = Uint8Array.from(data)
      if (corrupt === 'magic') changed[4] = 0
      return {
        offset, revision: corrupt === 'revision' ? 8 : rev,
        total: corrupt === 'total' ? size+1 : size,
        sha256: corrupt === 'sha256' ? 'unsafe' : sha,
        data: changed,
      }
    },
  }
  await assert.rejects(xDriveSynologyLoadNativeMediaStream(wrong, file), /trusted/)
}
await assert.rejects(xDriveSynologyLoadNativeMediaStream({
  ...checked, async ownerFileMediaRange() { throw Error('old Agent missing read') },
}, file), /old Agent/)
assert.equal(xDriveSynologyPlaybackMagic(
  Uint8Array.from(Buffer.from('ID3\x04\x00\x00', 'latin1')), 'audio/mpeg'), true)
assert.equal(xDriveSynologyPlaybackMagic(Uint8Array.from([0x1a,0x45,0xdf,0xa3]), 'video/webm'), true)
assert.equal(xDriveSynologyPlaybackMagic(Uint8Array.from([0x3c,0x68,0x74,0x6d,0x6c]), 'video/mp4'), false)

const filesUI = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
assert.match(filesUI, /xDriveSynologyLoadNativeMediaStream\(client, item, signal\)/)
assert.match(filesUI, /kind === 'pdf' && typeof item\.size === 'number'/)
assert.match(filesUI, /item\.size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES/)
assert.match(filesUI, /mime === 'application\/pdf'/)
assert.match(filesUI, /<XDriveFileQuickLookDialog/)
assert.match(filesUI, /loadPreviewURL=\{quickLookPreviewURLLoader\}/)
assert.match(filesUI, /quickLookPreviewURLLoader\s*=\s*thumbnailOnlyPreview && !ownerDerivedPreview/)
assert.match(filesUI, /thumbnailOnlyPreview && !ownerDerivedPreview \? undefined : loadMediaPreview/)
const viewer = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'), 'utf8')
assert.match(viewer, /data-xdrive-preview-media-state="video"/)
assert.match(viewer, /data-xdrive-preview-media-state="audio"/)
assert.match(viewer, /xDriveAbortHTMLMediaElement/)
assert.ok(fs.readFileSync(path.join(repo, 'internal/synologyui/media_stream.go'), 'utf8')
  .includes('ownerStreamMaxResponseBytes = 1 << 20'))
console.log('DSM native audio/video Range: shared Viewer, fixed same-origin Owner URL, magic and abort')
