'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const workflow = read('.github/workflows/ios-offline-owner-autopop-diagnostic.yml')
const watcher = read('ios/scripts/monitor-native-autopop.py')
const source = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')

test('native diagnostic requires the exact current PR candidate, never frozen #4128', () => {
  assert.match(workflow, /source:\s*\[candidate, published-b9\]/)
  assert.match(workflow, /continue-on-error:\s*\$\{\{ matrix\.source != 'candidate' \}\}/)
  assert.match(workflow, /source_sha="\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}"/)
  assert.match(workflow, /git cat-file -e "\$source_sha\^\{commit\}"/)
  assert.match(workflow, /test "\$\(git rev-parse "\$source_sha\^\{commit\}"\)" = "\$source_sha"/)
  assert.doesNotMatch(workflow, /source:\s*\[published-b9, fix-4128\]/)
})

test('native candidate runs real no-Session Cloud and Trash Back tests', () => {
  for (const method of [
    'testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList',
    'testRecentlyDeletedNoSessionDoesNotMountDestructiveRows',
  ]) {
    assert.match(workflow, new RegExp('-only-testing:xDriveIOSNavigationUITests/XDriveIOSFilesSessionRecoveryUITests/' + method))
    assert.match(source, new RegExp('func ' + method + '\\('))
  }
  assert.match(workflow, /test -f "\$work\/ios\/UITests\/XDriveIOSFilesSessionRecoveryUITests\.swift"/)
  assert.match(workflow, /grep -q 'XDriveIOSNativeFilesNoSessionChild'/)
})

test('real candidate is not patched by historical synthetic AutoPop fixture', () => {
  assert.match(workflow, /if \[\[ "\$\{\{ matrix\.source \}\}" == "candidate" \]\]; then[\s\S]*?grep -q 'XDriveIOSNativeFilesNoSessionChild'[\s\S]*?else\s+python3 "\$GITHUB_WORKSPACE\/ios\/scripts\/prepare-native-autopop-smoke\.py"/)
  assert.match(workflow, /source_sha="\$published_sha"/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSOfflineAutoPopUITests/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSFilesSessionRecoveryUITests/)
})

test('external watchdog captures failures in both actual candidate routes', () => {
  for (const method of [
    'testNativeAutoPopReturnsHomeWithoutXCUISwipe',
    'testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList',
    'testRecentlyDeletedNoSessionDoesNotMountDestructiveRows',
  ]) {
    assert.ok(watcher.includes('"' + method + '"'), 'missing watched test: ' + method)
  }
  assert.match(watcher, /nonlocal target_started, target_finished, seen_capture/)
  assert.match(watcher, /seen_capture = False[\s\S]*?elif " passed \(" in line/)
  assert.match(watcher, /collect_app_trace\(opts\.sim, out \/ "diagnostics"\)/)
})
