const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
const router = fs.readFileSync(path.join(repo, 'internal', 'api', 'router.go'), 'utf8')
const ticket = fs.readFileSync(path.join(repo, 'internal', 'api', 'download_ticket.go'), 'utf8')
const archive = fs.readFileSync(path.join(repo, 'internal', 'api', 'archive_download.go'), 'utf8')

test('archive native download ticket is bound to the durable prepare run', () => {
  for (const token of [
    'archiveDownloadTicket',
    '"archive"',
    'run.ExpiresAt.Sub(now)',
    'run.Status != meta.ArchivePrepareStatusCompleted',
    'archivePrepareIDs(run)',
    's.serveArchiveDownload(c, claims.UserID, ids, run.ID)',
  ]) {
    assert.ok(ticket.includes(token), 'archive ticket contract missing: ' + token)
  }
  assert.ok(router.includes('v1.GET("/archive-download/:id", s.archiveDownloadTicketStream)'))
  assert.ok(router.includes('authed.POST("/download/archive/prepare/:id/download-ticket", s.archiveDownloadTicket)'))
  assert.ok(archive.includes('func (s *Server) serveArchiveDownload('))
  assert.ok(archive.includes('loadArchivePreparedManifest('))
})

test('Web native archive handoff keeps server-side progress authoritative', () => {
  for (const token of [
    "/download/archive/prepare/${encodeURIComponent(prepared.transfer_id)}/download-ticket",
    'xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), preparedFilename)',
    "if (network.state === 'running') observedActive = true",
    "if (network.state === 'completed') break",
    "if (network.state === 'failed')",
    "if (network.state === 'cancelled')",
    'Date.now() + 60_000',
    '浏览器未开始归档下载。',
  ]) {
    assert.ok(api.includes(token), 'archive native handoff missing: ' + token)
  }
})
