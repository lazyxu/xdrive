const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E1a2 native client remains private and cannot be promoted into Desktop/Web control', () => {
  const client = read('internal', 'client', 'local_source_commit_content_preflight.go')
  const tests = read('internal', 'client', 'local_source_commit_content_preflight_test.go')
  assert.match(client, /PreflightLocalQuarantinedPhysicalContentBatch\(/)
  assert.match(client, /localRulesProofHeaders\(req, proof\)/)
  assert.match(client, /commit-intents\/content-preflight/)
  assert.match(client, /got\.CommitSupported == nil \|\| \*got\.CommitSupported/)
  assert.match(client, /got\.Authoritative == nil \|\| \*got\.Authoritative/)
  assert.match(client, /got\.MissingInferenceSafe == nil \|\| \*got\.MissingInferenceSafe/)
  assert.match(tests, /TestOwningAgentQuarantinedContentPreflightTransportFailClosed/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /PreflightLocalQuarantinedPhysicalContentBatch|local-quarantine-content-preflight/)
  }
  assert.doesNotMatch(client, /Update\(|Create\(|Delete\(|BeginSourceRun|UploadChunk|MirrorDeletion/)
})
