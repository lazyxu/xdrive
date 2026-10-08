const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const api = read('web', 'src', 'api.ts')
const sink = read('web', 'src', 'downloadSink.ts')
const router = read('internal', 'api', 'router.go')
const ticket = read('internal', 'api', 'download_ticket.go')
const progress = read('internal', 'api', 'download_transfer.go')
const authTicket = read('internal', 'auth', 'download_stream.go')

test('authenticated browser downloads use native handoff plus server-send progress', () => {
  for (const token of [
    'xDriveStartBrowserDownload',
    "if (downloadSink.kind === 'blob')",
    'startNativeTrackedDownload',
    '/api/v1/files/${node.id}/download-ticket',
    '/api/v1/files/${node.id}/versions/${version.id}/download-ticket',
    '/api/v1/download/transfers/${encodeURIComponent(serverTransferID)}',
  ]) assert.ok(api.includes(token) || sink.includes(token), 'native browser download contract missing: ' + token)
  assert.ok(sink.includes("link.download = filename"))
  assert.ok(api.includes("error: '已交给浏览器下载；无法继续读取服务端进度。'"))
})

test('download tickets carry an optional durable transfer id without weakening auth fences', () => {
  for (const token of [
    'IssueTrackedDownloadStream',
    'ID:        transferID',
    'jwt.WithAudience("xdrive-download-stream")',
    'downloadStreamMaxTTL = 30 * time.Minute',
  ]) assert.ok(authTicket.includes(token), 'download auth contract missing: ' + token)
  for (const token of [
    'TransferID string',
    'BytesTotal int64',
    'createDownloadTransfer(',
    'serveTrackedDownloadContent',
    'claims.SessionVersion != user.SessionVersion',
    'metadata.Revision != claims.ResourceRevision',
  ]) assert.ok(ticket.includes(token), 'download ticket contract missing: ' + token)
  assert.ok(router.includes('authed.GET("/download/transfers/:id", s.getDownloadTransfer)'))
})

test('server-send progress is user-scoped, durable and throttled', () => {
  for (const token of [
    'Where("id = ? AND owner_id = ? AND expires_at > ?"',
    'bytes_sent = bytes_sent + ?',
    'downloadTransferFlushInterval = 500 * time.Millisecond',
    'downloadTransferFlushBytes    = 32 << 20',
    'downloadTransferReadSeeker',
    'Statistics must never backpressure the file stream.',
    'retryAfter = time.Now().Add(time.Second)',
  ]) assert.ok(progress.includes(token), 'durable download progress missing: ' + token)
})

test('ordinary file/version native entry points do not aggregate Blob payloads in renderer memory', () => {
  const versionStart = api.indexOf('async downloadVersion(node: Node, version: FileVersion)')
  const archiveStart = api.indexOf('async downloadArchive(ids: number[], filename: string)')
  assert.ok(versionStart >= 0 && archiveStart > versionStart)
  const ordinary = api.slice(versionStart, archiveStart)
  assert.equal(ordinary.includes('response.blob()'), false)
  assert.equal(ordinary.includes('const chunks: BlobPart[] = []'), false)
  assert.ok(ordinary.includes('startNativeTrackedDownload'))
})
