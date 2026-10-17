const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('owning native directory seal stays private, never an executable backup port', () => {
  const agent = read('cmd/xdrive-agent/device_backup_local_first_directory_seal.go')
  const bound = read('cmd/xdrive-agent/device_backup_local_first_directory_bound.go')
  const challenge = read('internal/api/local_push_first_directory_challenge.go')
  const directory = read('internal/api/local_push_first_directory_commit.go')
  const native = read('internal/localpush/first_directory_native_recheck.go')
  assert.match(bound, /func observeLocalBoundFirstDirectoryHeld\(/)
  assert.match(bound, /RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(agent, /sealLocalBoundFirstDirectoryAdvisoryHeld\(/)
  assert.match(agent, /RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(native, /func RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(agent, /func \(c \*agentController\) sealOwnLocalBoundBackupFirstDirectoryNative\(/)
  assert.match(agent, /observeLocalBoundFirstDirectoryHeld\(/)
  assert.match(agent, /SealLocalFirstDirectoryAdvisoryObservation\(/)
  assert.match(agent, /localFolderGrantMu\.TryLock\(\)/)
  assert.match(native, /RecheckLocalFirstDirectoryNative\(/)
  assert.match(native, /openPinnedCurrentFirstDirectory\(/)
  assert.match(native, /currentPinnedFirstDirectoryMatches\(/)
  assert.match(native, /readPinnedDirectoryNativeIdentity\(/)
  assert.match(native, /defer pinned\.Close\(\)/)
  assert.match(challenge, /consumeBoundLocalPushFirstDirectoryChallenge\(/)
  assert.match(challenge, /func \(s \*Server\) consumeBoundLocalPushFirstDirectoryChallengeTx\(/)
  assert.match(directory, /func \(s \*Server\) commitBoundLocalPushFirstDirectoryTx\(/)
  assert.match(directory, /result, txErr = s\.commitBoundLocalPushFirstDirectoryTx\(/)
  assert.match(challenge, /return s\.consumeBoundLocalPushFirstDirectoryChallengeTx\(tx, c, challenge, seal\)/)

  for (const file of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(
      read(file),
      /sealOwnLocalBoundBackupFirstDirectoryNative|sealLocalBoundFirstDirectoryAdvisory|native-first-directory-challenge-seal|consumeBoundLocalPushFirstDirectoryChallengeTx|commitBoundLocalPushFirstDirectoryTx|RecheckLocalFirstDirectoryNativeWithHeldCheckpoint|observeLocalBoundFirstDirectoryHeld|sealLocalBoundFirstDirectoryAdvisoryHeld/,
      'unrouted advisory seal leaked to runtime transport: ' + file,
    )
  }
})
