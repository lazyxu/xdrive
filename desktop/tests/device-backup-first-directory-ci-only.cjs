const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('CI-only first-directory HTTP commit is absent from production and Desktop', () => {
  const router = read('internal/api/router.go')
  const handler = read('internal/api/local_push_ci_only_first_directory_commit.go')
  const goTests = read('internal/api/local_push_ci_only_first_directory_commit_test.go')

  assert.match(router, /localPushCIOnlyFirstDirectory\s+bool/)
  assert.match(router,
    /if s\.localPushCIOnlyFirstDirectory \{\s*authed\.POST\("\/sources\/:id\/ci-first-directory-commit",\s*s\.requireLocalSourceExecutor\(\), s\.ciOnlyCommitLocalPushFirstDirectory\)/)
  assert.match(handler, /if !s\.localPushCIOnlyFirstDirectory \{/)
  assert.match(handler, /decoder\.DisallowUnknownFields\(\)/)
  assert.match(handler, /http\.MaxBytesReader\(c\.Writer, c\.Request\.Body, 512\)/)
  assert.match(handler, /s\.commitBoundLocalPushFirstDirectory\(/)
  assert.match(handler, /NativeVerified: false, BackupComplete: false/)
  assert.match(handler, /CommitSupported: false, Authoritative: false/)
  assert.doesNotMatch(handler, /(?:beginSourceRun|finishSourceRun|DeleteSource|CommitSourceRun)\(/)

  for (const testName of [
    'TestLocalFirstDirectoryHTTPAbsentOnProductionRouter',
    'TestLocalFirstDirectoryCIHTTPAtomicPendingAndExactReplay',
    'TestLocalFirstDirectoryCIHTTPUnauthorizedAndMalformedRemainUnwritten',
    'TestLocalFirstDirectoryCIHTTPRevocationAndSourceDriftFailClosed',
  ]) assert.ok(goTests.includes('func '+testName+'('), 'missing real PostgreSQL HTTP regression '+testName)

  for (const file of [
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(read(file),
      /ci-first-directory-commit|ciOnlyCommitLocalPushFirstDirectory|localPushCIOnlyFirstDirectory/,
      'CI-only writer escaped into a production consumer')
  }
})
