'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(base, file), 'utf8')
const model = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const policy = read('ios/XDriveIOS/NativeOwnerLoginFailurePolicy.swift')
const auth = read('ios/XDriveIOS/AuthService.swift')
const route = read('ios/XDriveIOS/NativeLANLoginRoute.swift')
const flow = read('.github/workflows/ios-unsigned-ipa.yml')

test('exact native login screen now delegates error category and retry to tested policy', () => {
  assert.match(model, /XDriveIOSNativeOwnerLoginFailurePolicy\.message\(for: failure\)/)
  assert.match(model, /XDriveIOSNativeOwnerLoginFailurePolicy\.canRetrySavedSession\(after: failure\)/)
  assert.match(policy, /if failure is AuthFailure \|\| failure is URLError/)
  assert.match(policy, /if let owner = failure as\? XDriveNativeOwnerRootFailure/)
  assert.match(policy, /case \.invalidServerReply:/)
  assert.match(policy, /case \.missingServerIdentity:/)
  assert.match(policy, /case \.serverStatus\(let status\):/)
  assert.match(flow, /ios\/tests\/NativeOwnerLoginFailureChecks\.swift/)
  assert.match(flow, /xdrive-ios-login-failure-policy/)
})

test('password and origin are not replayed, and LAN cert validation is still enforced', () => {
  // A certificate failure is not in the exact network-fallback allowlist.
  assert.match(route, /if let failure = error as\? URLError/)
  assert.match(route, /\.cannotConnectToHost, \.timedOut, \.networkConnectionLost/)
  assert.doesNotMatch(route, /if let failure = error as\? URLError,[\s\S]{0,200}\.serverCertificateUntrusted/)
  assert.match(route, /throw error/)
  assert.match(route, /URLSessionConfiguration\.ephemeral/)
  assert.match(auth, /证书包含该 IP 的 SAN/)
  assert.match(policy, /case \.cannotFindHost, \.dnsLookupFailed, \.cannotConnectToHost/)
  assert.match(policy, /default:\s*return false/)
  assert.doesNotMatch(policy, /refreshToken|accessToken|localizedDescription|print\(/)
})


test('CI native launch harness preserves both known b9 and diagnostic recovery roots', () => {
  const os = require('node:os')
  const { spawnSync } = require('node:child_process')
  const script = path.join(base, 'ios/scripts/prepare-navigation-runtime-smoke.py')
  const known = [
    'XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)',
    'XDriveIOSNativeStartupRoot(interruption: interruption)'
  ]
  for (const entry of [...known, 'UnrecognizedNativeRoot()']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-ios-crash-harness-'))
    try {
      const ios = path.join(dir, 'ios')
      const source = path.join(ios, 'XDriveIOS')
      fs.mkdirSync(source, { recursive: true })
      const app = path.join(source, 'XDriveIOSApp.swift')
      const model = path.join(source, 'NativeOwnerLoginModel.swift')
      fs.writeFileSync(app, 'import SwiftUI\nWindowGroup {\n            ' + entry + '\n}\n')
      fs.writeFileSync(model, '@Published private(set) var owner: XDriveNativeOwnerRoot?\n')
      fs.writeFileSync(path.join(source, 'NativePhotoBackupScreen.swift'),
        'var launchNonce: UUID\n')
      fs.writeFileSync(path.join(ios, 'project.yml'), 'name: xDriveIOS\ntargets:\n')
      const run = spawnSync('python3', [script, dir], { encoding: 'utf8', timeout: 10000 })
      if (known.includes(entry)) {
        assert.equal(run.status, 0, run.stderr)
        const result = fs.readFileSync(app, 'utf8')
        assert.equal(result.split(entry).length - 1, 2,
          'Both normal and fallback startup paths must keep the original root')
        assert.match(result, /if ProcessInfo\.processInfo\.arguments\.contains\("-xdrive-ui-navigation-smoke"\)/)
        assert.match(result, /#else[\s\S]*?#endif/)
        assert.match(fs.readFileSync(model, 'utf8'), /@Published var owner:/)
      } else {
        assert.notEqual(run.status, 0, 'Unknown App root must not be silently instrumented')
        assert.match(run.stderr, /Unexpected iOS App entry/)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})
