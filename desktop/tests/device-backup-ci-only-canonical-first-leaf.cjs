const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('native first-leaf CAS SQL HTTP transport is registered in CI only, never in production', () => {
  const router = read('internal/api/router.go')
  const handler = read('internal/api/local_push_ci_only_first_leaf_commit.go')
  const unit = read('internal/api/local_push_ci_only_first_leaf_commit_test.go')
  const writer = read('internal/api/local_push_first_file_commit.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const renderer = read('desktop/src/main/index.cts')
  const web = read('web/src/App.tsx')
  const client = read('internal/client/local_push_staging.go')

  assert.match(router, /\tlocalPushCIOnlyFirstLeaf\s+bool/)
  assert.match(router, /if s\.localPushCIOnlyFirstLeaf \{/)
  assert.match(router, /ci-first-leaf-commit",\s*\n\s*s\.requireLocalSourceExecutor\(\), s\.ciOnlyCommitLocalPushFirstLeaf\)/)
  assert.match(handler, /if !s\.localPushCIOnlyFirstLeaf \{/)
  assert.match(handler, /http\.StatusNotFound/)
  assert.match(handler, /http\.MaxBytesReader\(c\.Writer, c\.Request\.Body, 512\)/)
  assert.match(handler, /localPushStageProof\(c\)/)
  assert.match(handler, /localPushFirstLeafPathKey\(proof\.RootID, req\.RelativeLeaf\)/)
  assert.match(handler, /s\.commitBoundLocalPushFirstLeaf\(/)
  assert.match(handler, /NativeVerified: false, BackupComplete: false, CommitSupported: false/)
  assert.match(handler, /Authoritative: false, MissingInferenceSafe: false/)
  assert.match(writer, /func \(s \*Server\) commitBoundLocalPushFirstLeaf\(/)

  for (const name of [
    'TestLocalPushPrivateFirstLeafCIOnlyHTTPRouteIsAbsentByDefault',
    'TestLocalPushCIOnlyHTTPPhysicalNativeFirstLeafCommitAndLostReplyReplay',
    'TestLocalPushCIOnlyHTTPFirstLeafRejectsInvalidDeviceAndInput',
    'TestLocalPushCIOnlyHTTPFirstLeafRejectsRevokedOrMissingCAS',
  ]) assert.ok(unit.includes('func '+name+'('), 'missing real owning CAS/SQL test '+name)

  // Production Desktop, Go Agent and Browser never hold a method to enable
  // the hidden route, and no source configuration/env can set this unexported bool.
  for (const surface of [agent, renderer, web, client]) {
    assert.doesNotMatch(surface, /localPushCIOnlyFirstLeaf|ci-first-leaf-commit|ciOnlyCommitLocalPushFirstLeaf/)
  }
  assert.doesNotMatch(router, /(?:os\.Getenv|os\.LookupEnv|viper|config)\([^)]*localPushCIOnlyFirstLeaf/)
})
