const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const agentCloud = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/cloud_files.go'), 'utf8')
const agentIPC = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/desktop_ipc.go'), 'utf8')
const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')

const section = (start, end) => {
  const begin = agentCloud.indexOf(start)
  assert.ok(begin >= 0, 'missing ' + start)
  const finish = agentCloud.indexOf(end, begin + start.length)
  assert.ok(finish > begin, 'missing ' + end)
  return agentCloud.slice(begin, finish)
}

test('Agent folder download binds the root task to a real Go cancellation context', () => {
  const source = section(
    'func (c *agentController) CloudDownloadFolder(',
    'func (c *agentController) CloudDownloadArchive(',
  )
  assert.match(source, /group := c\.transfers\.StartGroup\(transfer\.Spec\{/)
  assert.match(source, /ctx, cancel := context\.WithCancel\(ctx\)/)
  assert.match(source, /group\.BindCancel\(cancel\)/)
  assert.match(source, /scanAgentCloudDownloadFolder\(ctx, root, cli\.ListPage\)/)
  assert.match(source, /downloadAgentCloudFileIntoPath\(ctx, cli, file\.Node\.ID, target, progress\)/)
  assert.match(source, /cancelRemaining\(index\+1, err\)/)
  assert.match(source, /if completed > 0 \{/)
  assert.match(source, /state = transfer\.StatePartial/)
})

test('Cancellation checks the parent context before committing a staged downloaded file', () => {
  const source = section(
    'func downloadAgentCloudFileIntoPath(',
    'func existingAgentCloudDownloadRootNames(',
  )
  const close = source.indexOf('if err := tmp.Close(); err != nil')
  const cancel = source.indexOf('if err := ctx.Err(); err != nil', close)
  const commit = source.indexOf('replaceDownloadedFile(tmpPath, destination)', close)
  assert.ok(close >= 0 && cancel > close && commit > cancel,
    'cancellation must be checked after file sync but before destination promotion')
  assert.match(source.slice(cancel, commit), /os\.Remove\(tmpPath\)/)
})

test('Existing Agent transfer-cancel capability remains ID-owned, never a renderer path', () => {
  assert.match(agentIPC, /"transfer-cancel"/)
  assert.match(agentIPC, /"POST \/v1\/transfers\/cancel"/)
  assert.match(desktop, /task\.cancelable === true/)
  assert.match(desktop, /onCancel=\{\(id\) => \{ void cancelTransfer\(id\) \}\}/)
})
