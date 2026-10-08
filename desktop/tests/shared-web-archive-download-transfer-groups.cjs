const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const api = read('web', 'src', 'api.ts')
const webTransfers = read('web', 'src', 'transfers.ts')
const server = read('internal', 'api', 'archive_download.go')
const progress = read('internal', 'api', 'archive_download_progress.go')
const router = read('internal', 'api', 'router.go')

test('Web archive download creates one download group and one child per prepared leaf file', () => {
  for (const token of [
    "kind?: 'upload' | 'download'",
    "direction?: 'upload' | 'download'",
    "kind: input.kind ?? 'upload'",
    "direction: input.direction ?? input.kind ?? 'upload'",
  ]) {
    assert.ok(webTransfers.includes(token), 'Web transfer group contract missing: ' + token)
  }

  for (const token of [
    "kind: 'download'",
    "direction: 'download'",
    "'/api/v1/download/archive/prepare'",
    '/api/v1/download/archive/prepare/',
    "prepared.state === 'queued'",
    "prepared.state !== 'completed'",
    'this.startTransferChildren(',
    '/api/v1/download/archive/progress/',
    'applyProgress(await this.request<ArchiveDownloadProgress>',
    'this.progressTransfer(childID, file.done, file.size)',
    'this.updateTransferGroup(groupID',
    'JSON.stringify({ ids, transfer_id: prepared.transfer_id })',
    '}, false, downloadSink)',
    "this.finishTransfer(groupID, { state: 'completed' })",
  ]) {
    assert.ok(api.includes(token), 'Web archive hierarchy missing: ' + token)
  }
})

test('archive progress is server-side entry progress rather than synthetic child interpolation', () => {
  for (const token of [
    'archiveDownloadPrepareResponse',
    'archiveDownloadProgressResponse',
    'seedArchiveDownloadProgress',
    'beginArchiveDownloadProgress',
    'updateArchiveDownloadProgress',
    'archiveProgressReader',
    'sameArchivePreparedFiles',
    'errArchiveProgressMismatch',
  ]) {
    assert.ok(progress.includes(token), 'Server archive progress side-channel missing: ' + token)
  }

  assert.ok(server.includes('onProgress func(int64)'), 'archive entry writer must accept real byte progress')
  assert.ok(server.includes('&archiveProgressReader{reader: f, onRead: onProgress}'), 'archive progress must measure Store reads')
  assert.ok(server.includes('s.updateArchiveDownloadProgress(transferID, entry.Path, "transferring"'), 'archive download must update active child')
  assert.ok(server.includes('s.updateArchiveDownloadProgress(transferID, entry.Path, "completed"'), 'archive download must complete each child')
  assert.equal(api.includes('file.size * normalized'), false, 'Web archive children must not synthesize per-file byte progress')
})

test('archive prepare/progress routes are optional and legacy archive downloads remain compatible', () => {
  assert.ok(router.includes('POST("/download/archive/prepare", s.prepareArchiveDownload)'), 'archive prepare route missing')
  assert.ok(router.includes('GET("/download/archive/prepare/:id", s.getArchiveDownloadPrepare)'), 'archive prepare status route missing')
  assert.ok(router.includes('GET("/download/archive/progress/:id", s.getArchiveDownloadProgress)'), 'archive progress route missing')
  assert.ok(router.includes('POST("/download/archive", s.downloadArchive)'), 'legacy archive route missing')
  assert.ok(server.includes('TransferID string   `json:"transfer_id,omitempty"`'), 'archive transfer ticket must remain optional')
  assert.ok(api.includes('async download(node: Node)'), 'single-file Web download compatibility was removed')
  assert.ok(api.includes('xDriveOpenWebDownloadSink(node.name)'), 'single-file download must select the direct-to-disk sink before transport')
})

test('archive transport does not create a second leaf transfer when externally managed by the group', () => {
  assert.ok(api.includes('trackTransfer = true'), 'downloadAuthenticated external tracking switch missing')
  assert.ok(api.includes('const transferID = trackTransfer ? webTransferStore.create({'), 'ordinary downloads must still create leaf transfers')
  assert.ok(api.includes('if (trackTransfer) webTransferStore.complete('), 'ordinary download completion tracking missing')
  assert.ok(api.includes("await this.downloadAuthenticated('/api/v1/download/archive'"), 'archive transport call missing')
})

test('Web archive download batches prepared child registration', () => {
  const start = api.indexOf('  async downloadArchive(')
  const end = api.indexOf('  private async downloadAuthenticated(', start)
  assert.ok(start >= 0 && end > start, 'downloadArchive source is missing')
  const source = api.slice(start, end)

  for (const token of [
    'const registeredChildIDs = this.startTransferChildren(',
    'preparedFiles.map((file) => ({',
    'registeredChildIDs.length !== preparedFiles.length',
    'const childID = registeredChildIDs[index]',
  ]) {
    assert.ok(source.includes(token), 'archive batch child registration missing: ' + token)
  }
  assert.equal(
    source.includes('this.startTransferChild(groupID'),
    false,
    'archive prepare must not persist one child transfer at a time',
  )
  const registrationIndex = source.indexOf(
    'const registeredChildIDs = this.startTransferChildren(',
  )
  const firstGroupUpdateAfterRegistration = source.indexOf(
    'this.updateTransferGroup(groupID',
    registrationIndex,
  )
  assert.ok(
    registrationIndex >= 0 && firstGroupUpdateAfterRegistration > registrationIndex,
    'all prepared child transfers must still exist before group progress begins',
  )
})

