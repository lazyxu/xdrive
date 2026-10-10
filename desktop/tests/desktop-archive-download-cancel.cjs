const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloud = fs.readFileSync(path.join(__dirname, '../../cmd/xdrive-agent/cloud_files.go'), 'utf8')
const section = (begin, end) => {
  const start = cloud.indexOf(begin)
  assert.ok(start !== -1, 'missing ' + begin)
  const finish = cloud.indexOf(end, start + begin.length)
  assert.ok(finish !== -1, 'missing ' + end)
  return cloud.slice(start, finish)
}

test('Desktop Gallery ZIP download binds HTTP and extraction to one cancellation context', () => {
  const download = section('func (c *agentController) CloudDownloadArchive(', 'type validatedArchiveEntry')
  assert.match(download, /ctx, cancel := context.WithCancel\(ctx\)/)
  assert.match(download, /handle.BindCancel\(cancel\)/)
  assert.match(download, /cli.DownloadArchiveToProgress\(ctx, ids, tmp, progress\)/)
  assert.match(download, /extractDownloadedArchiveContext\(ctx, tmpPath, destination\)/)
  assert.match(download, /finishAgentCloudTransfer\(handle, err\)/)
})

test('Cancelled archive extraction rolls back only newly promoted roots', () => {
  const extract = section('func extractDownloadedArchiveContext(', 'func allocateDownloadedArchiveName(')
  assert.match(extract, /archiveCancellationReader\{ctx: ctx, src: input\}/)
  assert.match(extract, /copyDownloadedArchiveRootContext\(ctx, source, target\)/)
  assert.match(extract, /return rollback\(err\)/)
  assert.doesNotMatch(extract, /os.RemoveAll\(target\)/,
    'failed promotion must not delete another process\'s conflicting destination')
  assert.match(extract, /if err := ctx.Err\(\); err != nil/)
})

test('Archive promotion checks context between recursive copies', () => {
  const copy = section('func copyDownloadedArchiveRootContext(', 'func (c *agentController) CloudSearch(')
  assert.match(copy, /copyDownloadedArchiveRootContext\(\s*ctx,/)
  assert.match(copy, /archiveCancellationReader\{ctx: ctx, src: input\}/)
  assert.match(copy, /if err := ctx.Err\(\); err != nil/)
})
