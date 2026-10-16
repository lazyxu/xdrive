const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('owning first-directory CAS-independent SQL primitive remains unrouted', () => {
  const impl = read('internal/api/local_push_first_directory_commit.go')
  const goTests = read('internal/api/local_push_first_directory_commit_test.go')
  const router = read('internal/api/router.go')
  const client = read('internal/client/sources.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const desktop = read('desktop/src/main/index.cts')
  const web = read('web/src/App.tsx')

  assert.match(impl, /func \(s \*Server\) commitBoundLocalPushFirstDirectory\(/)
  assert.match(impl, /func localPushFirstDirectoryPathKey\(/)
  assert.match(impl, /sourcepkg\.NormalizeRelativePath\(name\)/)
  assert.match(impl, /meta\.ValidateName\(name\)/)
  assert.match(impl, /s\.checkLocalPushStageScopeTx\(/)
  assert.match(impl, /uploadNameConflictNode\(/)
  assert.match(impl, /meta\.SourceItemStatePending/)
  assert.match(impl, /kind|directory/)
  assert.match(impl, /tx\.Create\(&node\)/)
  assert.match(impl, /tx\.Create\(&item\)/)
  assert.doesNotMatch(impl, /(?:StageVerifiedNativeOriginalBytes|beginSourceRun|finishSourceRun|CommitSourceRun|writeFileVersion|Delete)\(/)

  for (const testName of [
    'TestLocalPushFirstDirectoryPersistsPendingExactIdentityAndReplays',
    'TestLocalPushFirstDirectoryRejectsInvalidNamesAndRemoteOwnership',
    'TestLocalPushFirstDirectoryReplayRefusesEditedOrPromotedItem',
    'TestLocalPushFirstDirectorySourceItemSQLFailureRollsBackNode',
  ]) assert.ok(goTests.includes('func '+testName+'('), 'missing PostgreSQL directory regression '+testName)

  for (const surface of [router, client, agent, desktop, web]) {
    assert.doesNotMatch(surface, /commitBoundLocalPushFirstDirectory|localPushFirstDirectoryPathKey/,
      'first-directory writer must not become Web, Agent IPC, or HTTP execute capability')
  }
})
