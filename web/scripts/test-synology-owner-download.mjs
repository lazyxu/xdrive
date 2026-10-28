#!/usr/bin/env node
// The DSM FileExplorer download action must verify an entire immutable Owner
// file BEFORE providing a browser-save Blob; never expose partial bytes,
// native Server bearer or an arbitrary source/download URL.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { webcrypto, createHash } from 'node:crypto'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const pathToModule = path.join(repo, 'ui/shared/src/synology-owner-download.ts')
const source = fs.readFileSync(pathToModule, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: pathToModule,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error).length, 0)
const exports = {}, module = { exports }
const context = vm.createContext({
  exports, module, crypto: webcrypto, Blob, Uint8Array, Promise,
  require(name) {
    assert.equal(name, './synology-backup-adapter')
    return { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES: 256 << 10 }
  },
})
vm.runInContext(compiled.outputText, context, { filename: pathToModule, timeout: 1000 })
const { xDriveSynologyFetchVerifiedDownload, xDriveSynologySafeDownloadFilename,
  XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES } = module.exports
assert.equal(XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES, 32 << 20)
assert.equal(xDriveSynologySafeDownloadFilename('archive.zip'), 'archive.zip')
assert.equal(xDriveSynologySafeDownloadFilename('.bashrc'), '.bashrc')
assert.equal(xDriveSynologySafeDownloadFilename('a/b\\c\n.zip'), 'a_b_c_.zip')
assert.equal(xDriveSynologySafeDownloadFilename('file...   '), 'file')
assert.equal(xDriveSynologySafeDownloadFilename('CON.txt'), '_CON.txt')
assert.equal(xDriveSynologySafeDownloadFilename('aux'), '_aux')
assert.equal(xDriveSynologySafeDownloadFilename('invoice' + String.fromCharCode(0x202E) + 'fdp.exe'), 'invoice_fdp.exe')
assert.equal(xDriveSynologySafeDownloadFilename('photo' + String.fromCharCode(0x2066) + '.jpg'), 'photo_.jpg')
for (const name of ['.', '..', '', '    ', 'x'.repeat(513)]) {
  assert.throws(() => xDriveSynologySafeDownloadFilename(name), /Invalid/)
}

const payload = Buffer.alloc((256 << 10) + 13)
for (let index = 0; index < payload.length; index++) payload[index] = (index * 131 + 7) % 256
const sha = createHash('sha256').update(payload).digest('hex')
const file = { kind: 'file', id: 42, revision: 7, name: 'report.zip', size: payload.length }
const requests = []
const good = {
  async ownerFileMediaRange(id, revision, offset, length, signal) {
    assert.equal(id, 42)
    assert.equal(revision, 7)
    assert.equal(signal?.aborted, false)
    requests.push([offset, length])
    return {
      offset, revision, total: payload.length, sha256: sha,
      data: Uint8Array.from(payload.subarray(offset, offset + length)),
    }
  },
}
const progress = []
const done = await xDriveSynologyFetchVerifiedDownload(good, file,
  new AbortController().signal,
  (loaded, total) => progress.push([loaded, total]))
assert.equal(done.filename, file.name)
assert.equal(done.blob.type, 'application/octet-stream')
assert.equal(done.blob.size, payload.length)
assert.deepEqual(Buffer.from(await done.blob.arrayBuffer()), payload)
assert.deepEqual(requests, [[0, 256 << 10], [256 << 10, 13]])
assert.deepEqual(progress, [[0, payload.length], [256 << 10, payload.length],
  [payload.length, payload.length]])
const fail = async (client, item = file, signal) =>
  assert.rejects(xDriveSynologyFetchVerifiedDownload(client, item, signal))
for (const invalid of [
  {...file, kind:'dir'}, {...file, id:0}, {...file, revision:0},
  {...file, id:Number.MAX_SAFE_INTEGER+1}, {...file, size:0},
  {...file, size:XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES+1},
  {...file, name:'..'},
]) {
  await fail({ async ownerFileMediaRange() { throw new Error('Agent must not be contacted') } }, invalid)
}
const abort = new AbortController()
abort.abort()
await fail({ async ownerFileMediaRange() { throw Error('Agent must not be contacted') } },
  file, abort.signal)
for (const variation of ['wrong offset', 'changed revision', 'wrong total',
  'changed digest', 'short bytes', 'corrupted content']) {
  let n = 0
  const broken = {
    async ownerFileMediaRange(id, revision, offset, length) {
      n++
      const data = Uint8Array.from(payload.subarray(offset, offset + length))
      if (variation === 'corrupted content' && n === 2) data[0] ^= 0xff
      return {
        offset: variation === 'wrong offset' && n === 2 ? offset - 1 : offset,
        revision: variation === 'changed revision' && n === 2 ? revision + 1 : revision,
        total: variation === 'wrong total' && n === 2 ? payload.length + 1 : payload.length,
        sha256: variation === 'changed digest' && n === 2 ? '0'.repeat(64) : sha,
        data: variation === 'short bytes' && n === 2 ? data.subarray(0, length - 1) : data,
      }
    },
  }
  await fail(broken)
  assert.equal(n, 2, 'invalid Owner range escaped without checking second slice')
}
const cancel = new AbortController()
let observed = 0
await fail({ async ownerFileMediaRange(id, revision, offset, length) {
  observed++
  cancel.abort()
  return { offset, revision, total: file.size, sha256: sha,
    data: Uint8Array.from(payload.subarray(offset, offset + length)) }
}}, file, cancel.signal)
assert.equal(observed, 1)
const page = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
for (const contract of [
  'onDownloadItems={downloadSelectedFiles}',
  'getSelectionActionDisabledReason={(action, selected, count)',
  'item.size > XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES',
  'xDriveSynologyFetchVerifiedDownload(client, item, controller.signal,',
  'download={readyDownload.filename}',
  'href={readyDownload.url}',
  'setVerifiedDownload({ filename, url, scopeKey: currentScopeKey, client, rootRevision })',
  'URL.revokeObjectURL(url)',
  'downloadAbort.current?.abort()',
  'setDownload({ name: item.name, loaded',
  'window.setTimeout(() => {',
  'downloadAbort.current?.abort()',
  "itemsRef.current.some(node =>",
  "node.revision === item.revision && node.name === item.name",
]) assert.ok(page.includes(contract), 'missing secure DSM download boundary: ' + contract)

// Renderer contract: a user-initiated Owner download is not a disposable
// thumbnail/first-page read. Folder/sort must not abort its controller;
// account/client replacement, root revalidation and explicit Cancel still do.
// The final save link must remain accessible only to that same verified Owner.
assert.match(page, /const readyDownload = verifiedDownload\?\.client === client &&\s*verifiedDownload\.rootRevision === rootRevision/)
assert.match(page, /interactionLifecycleKey=\{rootRevision \+ ':' \+ currentScopeKey\}/,
  'folder/sort changes still retire obsolete disposable thumbnails')
const cursorController = fs.readFileSync(
  path.join(repo, 'ui/shared/src/mui/FileExplorerCursorDirectoryController.ts'), 'utf8')
assert.match(page, /useXDriveFileExplorerCursorDirectory\(/,
  'DSM page uses the one Owner-scoped shared cursor reader')
assert.match(cursorController, /pendingPage\.current\?\.abort\(\)/,
  'directory page requests remain separately cancelable by the shared Controller')
const ownerDownloadEffect = page.split('// An explicit verified Owner download continues')[1]
  ?.split('  const navigateUp =')[0]
assert.ok(ownerDownloadEffect, 'download lifecycle guard must remain explicit')
assert.match(ownerDownloadEffect, /\}, \[client, rootRevision\]\)/,
  'same Owner folder/sort changes must not cancel user-initiated downloads')
assert.doesNotMatch(ownerDownloadEffect, /\[client, rootRevision, currentScopeKey\]/)
assert.match(ownerDownloadEffect, /downloadAbort\.current\?\.abort\(\)/,
  'account/client/root replacement must still abort unverified downloads')
assert.match(page, /const cancelDownload = useCallback\(/,
  'explicit user cancellation stays available')

const explorer = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
assert.ok(explorer.includes('onDownloadItems?: (items: XDriveFileExplorerItem[]) => void'))
assert.ok(!source.includes('cloud/file-preview-ticket'), 'must not use privileged ticket downloads')
console.log('DSM Owner file download: strict 32 MiB, full SHA-256, real progress, cancellation and shared Explorer')
