const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shares = fs.readFileSync(path.join(repo, 'internal', 'api', 'shares.go'), 'utf8')
const router = fs.readFileSync(path.join(repo, 'internal', 'api', 'router.go'), 'utf8')
const auth = fs.readFileSync(path.join(repo, 'internal', 'auth', 'public_share_download.go'), 'utf8')
const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')

test('public share native ticket consumes one slot at issuance and remains range/retry compatible', () => {
  for (const token of [
    'public_share_download',
    'xdrive-public-share-download',
    'NodeRevision',
  ]) {
    assert.ok(auth.includes(token), 'public share ticket auth missing: ' + token)
  }

  const issueStart = shares.indexOf('func (s *Server) publicShareDownloadTicket(')
  const streamStart = shares.indexOf('func (s *Server) publicShareDownloadTicketStream(')
  const resolveStart = shares.indexOf('func (s *Server) resolvePublicShare(')
  const issue = shares.slice(issueStart, streamStart)
  const stream = shares.slice(streamStart, resolveStart)

  for (const token of [
    'Clauses(clause.Locking{Strength: "UPDATE"})',
    'shareStatus(current, now) != "active"',
    'Where("id = ? AND download_count = ?", current.ID, current.DownloadCount)',
    'Update("download_count", gorm.Expr("download_count + 1"))',
    'IssuePublicShareDownload(',
  ]) {
    assert.ok(issue.includes(token), 'ticket issuance count contract missing: ' + token)
  }
  assert.equal(stream.includes('Update("download_count"'), false, 'Range/retry GET must not consume another count')
  assert.equal(stream.includes('shareStatus('), false, 'an already-issued ticket must survive max-download exhaustion')
  assert.ok(stream.includes('share.RevokedAt != nil'))
  assert.ok(stream.includes('claims.NodeRevision'))
  assert.ok(router.includes('v1.GET("/public-share-download/:id", s.publicShareDownloadTicketStream)'))
  assert.ok(router.includes('v1.HEAD("/public-share-download/:id", s.publicShareDownloadTicketStream)'))
})

test('Web public share no longer buffers the shared file as a Blob', () => {
  const start = api.indexOf('async downloadPublicShare(')
  const end = api.indexOf('downloadURL(nodeID: number)', start)
  const method = api.slice(start, end)
  assert.ok(method.includes('/api/v1/public/share/download-ticket'))
  assert.ok(method.includes('xDriveStartBrowserDownload('))
  assert.equal(method.includes('response.blob()'), false)
  assert.equal(method.includes('URL.createObjectURL'), false)
})
