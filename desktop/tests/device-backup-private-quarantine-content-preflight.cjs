const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E1a private quarantined CAS preflight cannot escape Server/Agent authorization', () => {
  const route = read('internal', 'api', 'router.go')
  const content = read('internal', 'api', 'local_source_commit_content_preflight.go')
  const tests = read('internal', 'api', 'local_source_commit_content_preflight_test.go')
  const integration = read('internal', 'api', 'local_source_commit_intents_integration_test.go')
  assert.match(route, /commit-intents\/content-preflight", s\.requireLocalSourceExecutor\(\), s\.preflightLocalQuarantinedContent/)
  assert.match(content, /requireLocalSourceProofTx\(/)
  assert.match(content, /sameLocalQuarantinedEvidence\(/)
  assert.match(content, /checkLocalQuarantinedCloudSnapshot\(/)
  assert.match(content, /verifyPhysicalEvidenceCAS\(/)
  assert.match(content, /CloudBytesVerified:\s*false, ContentVerified:\s*false/)
  assert.match(content, /CommitSupported:\s*false, Authoritative:\s*false, MissingInferenceSafe:\s*false/)
  assert.match(tests, /TestLocalQuarantinedEvidenceMustMatchExactPersistedScope/)
  assert.match(integration, /TestQuarantineLocalSourceCommitIntentsOwningAgentOnlyAndNoCanonicalWrites/)
  assert.match(integration, /checkContent\(ownerJWT, foreign, string\(contentJSON\), http.StatusForbidden\)/)
  assert.match(integration, /putOriginal\("xyz"\)/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /preflightLocalQuarantinedContent|commit-intents\/content-preflight/)
  }
  assert.doesNotMatch(content, /Create\(|Update\(|Delete\(|BeginSourceRun|CommitSourceItem|MirrorDeletion/)
})
