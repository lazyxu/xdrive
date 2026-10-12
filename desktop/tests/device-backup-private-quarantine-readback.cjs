const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E0c quarantine readback is native owning-Agent private and grants no identity authority', () => {
  const api = read('internal', 'api', 'local_source_commit_intent_page.go')
  const client = read('internal', 'client', 'local_source_commit_intent_page.go')
  const route = read('internal', 'api', 'router.go')
  assert.match(route, /"\/sources\/:id\/local-identity\/commit-intents\/page", s\.requireLocalSourceExecutor\(\), s\.readLocalSourceCommitIntentPage/)
  assert.match(api, /requireLocalSourceProofTx\(tx, c, sourceID, "", false\)/)
  assert.match(api, /LocalSourceCommitIntentStateQuarantined/)
  assert.match(api, /Order\("evidence_id ASC"\)\.Limit\(input\.Limit \+ 1\)/)
  assert.match(api, /CommitSupported: false, Authoritative: false, MissingInferenceSafe: false/)
  assert.match(client, /ReadLocalSourceCommitIntentPage\(/)
  assert.match(client, /localRulesProofHeaders\(req, proof\)/)
  assert.match(client, /DisallowUnknownFields\(\)/)
  assert.match(client, /got\.HasMore == nil \|\| got\.NextAfterID == nil/)
  assert.match(client, /got\.CommitSupported == nil/)
  assert.match(client, /got\.Authoritative == nil/)
  assert.match(client, /got\.MissingInferenceSafe == nil/)
  const transportTest = read('internal', 'client', 'local_source_commit_intent_page_test.go')
  const serverTest = read('internal', 'api', 'local_source_commit_intents_integration_test.go')
  assert.match(transportTest, /TestReadLocalSourceCommitIntentPageStrictOwningProofAndNoAuthority/)
  assert.match(serverTest, /readPage\(ownerJWT, foreign/)
  assert.match(serverTest, /readPage\(ownerJWT, copyProof\(\), string\(pageJSON\), http\.StatusForbidden\)/)
  for (const nativeOnly of [api, client]) {
    assert.doesNotMatch(nativeOnly, /BeginSourceRun|UploadChunk|CommitSourceItem|MirrorDeletion/)
  }
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /local-identity\/commit-intents\/page|ReadLocalSourceCommitIntentPage/)
  }
})
