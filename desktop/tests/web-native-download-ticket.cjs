const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
const sink = fs.readFileSync(path.join(repo, 'web', 'src', 'downloadSink.ts'), 'utf8')
const router = fs.readFileSync(path.join(repo, 'internal', 'api', 'router.go'), 'utf8')
const ticket = fs.readFileSync(path.join(repo, 'internal', 'api', 'download_ticket.go'), 'utf8')
const authTicket = fs.readFileSync(path.join(repo, 'internal', 'auth', 'download_stream.go'), 'utf8')

test('authenticated file downloads use native browser handoff when direct-to-disk API is unavailable', () => {
  for (const token of [
    'xDriveStartBrowserDownload',
    "if (downloadSink.kind === 'blob')",
    '/api/v1/files/${node.id}/download-ticket',
    '/api/v1/files/${node.id}/versions/${version.id}/download-ticket',
    'this.nativeDownloadURL(ticket.url)',
  ]) {
    assert.ok(api.includes(token) || sink.includes(token), 'native browser download contract missing: ' + token)
  }
  assert.ok(sink.includes("link.download = filename"), 'browser handoff must preserve the filename hint')
  assert.ok(sink.includes("link.rel = 'noopener noreferrer'"), 'browser handoff should not leak opener/referrer state')
})

test('download tickets are short-lived, audience-isolated and stream without bearer auth', () => {
  for (const token of [
    'type DownloadStreamClaims struct',
    'TokenType:        "download_stream"',
    'Audience:  jwt.ClaimStrings{"xdrive-download-stream"}',
    'jwt.WithAudience("xdrive-download-stream")',
    'downloadStreamMaxTTL = 30 * time.Minute',
  ]) {
    assert.ok(authTicket.includes(token), 'download-stream auth contract missing: ' + token)
  }
  for (const token of [
    'authenticatedDownloadTicketTTL = 10 * time.Minute',
    'IssueDownloadStream(',
    'ParseDownloadStream(',
    'claims.SessionVersion != user.SessionVersion',
    'metadata.Revision != claims.ResourceRevision',
    'Referrer-Policy',
    'Content-Disposition',
    'http.ServeContent',
  ]) {
    assert.ok(ticket.includes(token), 'download ticket API contract missing: ' + token)
  }
  for (const route of [
    'v1.GET("/file-download/:id", s.fileDownloadTicketStream)',
    'v1.GET("/file-version-download/:id/:versionID", s.fileVersionDownloadTicketStream)',
    'authed.POST("/files/:id/download-ticket", s.fileDownloadTicket)',
    'authed.POST("/files/:id/versions/:versionID/download-ticket", s.fileVersionDownloadTicket)',
  ]) {
    assert.ok(router.includes(route), 'download ticket route missing: ' + route)
  }
})

test('legacy aggregate Blob buffering is no longer used by ordinary file/version download entry points', () => {
  const versionStart = api.indexOf('async downloadVersion(node: Node, version: FileVersion)')
  const archiveStart = api.indexOf('async downloadArchive(ids: number[], filename: string)')
  assert.ok(versionStart >= 0 && archiveStart > versionStart)
  const ordinary = api.slice(versionStart, archiveStart)
  assert.equal(ordinary.includes('response.blob()'), false)
  assert.equal(ordinary.includes('const chunks: BlobPart[] = []'), false)
  assert.ok(ordinary.includes('xDriveStartBrowserDownload('))
})
