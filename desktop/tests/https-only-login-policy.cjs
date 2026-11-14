'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('Desktop refuses HTTP at UI, Chromium probe and native IPC before credentials', () => {
  const view = read('desktop/src/renderer/App.tsx')
  const probe = read('desktop/src/main/server_probe.cts')
  const main = read('desktop/src/main/index.cts')
  assert.match(view, /httpsOrigin\.protocol !== 'https:'/)
  assert.match(probe, /target\.protocol !== 'https:'/)
  assert.match(main, /loginOrigin\.protocol !== 'https:'/)
  assert.match(main, /if \(!desktopHTTPSLoginOrigin\(profile\.server\)\)/)
  assert.match(main, /loginHistory = disableAutomaticLogin\(loginHistory\)/)
  const part = main.slice(main.indexOf("ipcMain.handle('agent:login'"))
  assert.ok(part.indexOf('loginOrigin.protocol') < part.indexOf('beginPrivateLANAuthentication(server)'))
  assert.ok(part.indexOf('loginOrigin.protocol') < part.indexOf('decryptLoginPassword('))
  assert.ok(part.indexOf('loginOrigin.protocol') < part.indexOf('requireAgentClient().login('))
})

test('Android real native login is HTTPS-only while domain/SNI LAN dial stays intact', () => {
  const ui = read('android/app/src/main/java/com/tfluid/xdrive/AuthScreens.kt')
  const state = read('android/app/src/main/java/com/tfluid/xdrive/DriveController.kt')
  const route = read('android/core/src/main/kotlin/com/tfluid/xdrive/core/ConnectionRoute.kt')
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  assert.match(ui, /login\(server, false, lanIp, username, password, keepLogin, rememberPassword\)/)
  assert.doesNotMatch(ui, /allow-http|允许不安全的 HTTP 连接|advanced by remember|allowHttp by remember/)
  assert.match(state, /ServerAddress\.parse\(serverInput, false\)/)
  assert.match(state, /ServerAddress\.parse\(input, false\)/)
  assert.match(manifest, /android:usesCleartextTraffic="false"/)
  assert.match(route, /hostname != host/)
  assert.match(route, /pinConnection\(address, ip\)/)
  assert.match(route, /ApiFailureReason\.TLS/)
})

test('Web/PWA HTTPS login and session restoration cannot use an HTTP Origin', () => {
  const api = read('web/src/api.ts')
  const web = read('web/src/App.tsx')
  assert.match(api, /xDrive 登录只支持 HTTPS/)
  assert.match(api, /Browser refresh requires HTTPS/)
  assert.match(web, /window\.location\.protocol !== 'https:'/)
  assert.doesNotMatch(web, /XDriveManualConnectionDialog|data-xdrive-manual-connection/)
  assert.match(read('web/package.json'), /test-no-manual-connection\.mjs/)
  assert.doesNotMatch(read('web/package.json'), /test-https-manual-connection\.mjs/)
})

test('CLI and DSM keep distinct but HTTPS-only user login boundaries', () => {
  const cli = read('cmd/xd/main.go')
  const dsm = read('web/src/synology.tsx')
  assert.match(cli, /validateXDHTTPSLoginOrigin/)
  assert.match(cli, /server := fs\.String\("server", ""/)
  assert.match(cli, /u\.Scheme != "https"/)
  assert.match(dsm, /window\.location\.protocol === 'https:'/)
  // The DSM preflight normalizes the address and username once, then verifies
  // the owning Agent before the first credential-bearing POST.
  assert.match(dsm, /const requestedServer = server\.trim\(\)/)
  assert.match(dsm, /const requestedUsername = username\.trim\(\)/)
  assert.match(dsm, /xDriveDSMLoginInputError\(requestedServer, requestedUsername, requestedPassword\)/)
  assert.match(dsm, /xDriveDSMLoginOwnerError\(requestedServer, requestedUsername, info\)/)
  assert.match(dsm, /client\.serverConnection\(controller\.signal\)[\s\S]*client\.loginServer\(requestedServer, requestedUsername, requestedPassword, controller\.signal\)/)
  assert.match(dsm, /label="Server HTTPS 地址"/)
  assert.doesNotMatch(dsm, /ServerAddress\.parse|UserPassword/)
})

test('iOS simplifies route selection without TLS or Owner identity bypass', () => {
  const route = read('ios/XDriveIOS/NativeLANLoginRoute.swift')
  const login = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
  assert.match(route, /let \(bytes, response\) = try await session\.bytes\(for: request\)/)
  assert.match(route, /guard data\.count < maxBytes/)
  assert.match(route, /throw AuthFailure\.invalidLANProbe/)
  assert.match(route, /return origin/)
  // Only the anonymous endpoint-choice path must remain free of custom
  // trust overrides. The separate stage-3 IP probe now intentionally uses a
  // shared, strictly pinned Apple Security challenge callback to diagnose
  // a genuine TLS rejection, so banning "serverTrust" in the whole file
  // would reject a secure implementation rather than detect a bypass.
  const choiceStart = route.indexOf('    static func selectOrigin(origin: URL, lanIP: String) async throws -> URL')
  const choiceEnd = route.indexOf('    /// Reuse the Desktop bootstrap:', choiceStart)
  assert.ok(choiceStart >= 0 && choiceEnd > choiceStart,
    'selectOrigin security boundary remains explicit and testable')
  const anonymousChoice = route.slice(choiceStart, choiceEnd)
  assert.doesNotMatch(anonymousChoice,
    /serverTrust|SecTrust|NSURLAuthenticationMethodServerTrust|allowsInsecureHTTPLoads|allowInsecure/)
  assert.match(anonymousChoice, /\.cannotConnectToHost, \.timedOut, \.networkConnectionLost/)
  assert.doesNotMatch(anonymousChoice, /\.serverCertificateUntrusted|\.secureConnectionFailed/,
    'TLS identity failures must not fall back to credential-bearing DNS login')
  const pinnedTrust = read('ios/XDriveIOS/NativeLANTrust.swift')
  assert.match(route, /override func urlSession\(_ session: URLSession, didReceive challenge:/)
  assert.match(route, /super\.urlSession\(session, didReceive: challenge\)/)
  assert.match(route, /disposition == \.cancelAuthenticationChallenge/)
  assert.match(pinnedTrust, /SecTrustSetAnchorCertificatesOnly\(trust, true\)/)
  assert.match(pinnedTrust, /SecTrustSetNetworkFetchAllowed\(trust, false\)/)
  assert.match(pinnedTrust, /SecPolicyCreateSSL\(true, target\.ip as CFString\)/)
  assert.match(pinnedTrust, /if SecTrustEvaluateWithError\(trust, nil\) \{ return \.trusted \}/)
  // A secondary Basic X.509 probe can only classify a rejected connection,
  // never replace the exact IP SAN + paired CA authentication gate.
  assert.match(pinnedTrust, /SecPolicyCreateSSL\(true, target\.ip as CFString\)/)
  assert.match(pinnedTrust, /SecPolicyCreateBasicX509\(\)/)
  assert.ok(pinnedTrust.indexOf('if SecTrustEvaluateWithError(trust, nil) { return .trusted }') <
    pinnedTrust.indexOf('SecTrustCopyCertificateChain(trust)'))
  assert.doesNotMatch(route + pinnedTrust, /allowsInsecureHTTPLoads|trustAllCertificates|InsecureSkipVerify/)
  assert.match(login, /let origin = try await XDriveIOSNativeLANLoginRoute\.selectOrigin/)
  assert.match(login, /origin: origin,\s*accessToken: accessToken/)
})
