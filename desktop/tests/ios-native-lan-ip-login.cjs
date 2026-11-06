'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const route = read('ios/XDriveIOS/NativeLANLoginRoute.swift')
const model = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const ui = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift')
const auth = read('ios/XDriveIOS/AuthService.swift')
const trust = read('ios/XDriveIOS/NativeLANTrust.swift')
const bootstrap = read('ios/XDriveIOS/NativeLANCertificateBootstrap.swift')

test('iOS offers optional private IPv4 without inventing a parallel login identity', () => {
  assert.match(ui, /native-ios-login-lan-ip/)
  assert.match(ui, /text: \$model\.lanIPText/)
  assert.match(ui, /登录前检测一次内网 HTTPS/)
  assert.match(model, /@Published var lanIPText = ""/)
  assert.match(route, /XDriveIOSLANAuthority\(ip: input/)
  assert.match(trust, /octets\[0\] == 10/)
  assert.match(trust, /octets\[0\] == 172/)
  assert.match(trust, /octets\[0\] == 192/)
  assert.match(route, /url\.host = input/)
  assert.match(route, /return try ServerAddress\.parse\(target\.absoluteString\)/)
  assert.match(auth, /case \.invalidLANIP:/)
})

test('one anonymous no-redirect HTTPS probe selects a fixed origin before credentials', () => {
  assert.match(route, /read\(origin, path: "\/api\/v1\/version"/)
  assert.match(route, /request\.httpMethod = "GET"/)
  assert.match(route, /request\.httpShouldHandleCookies = false/)
  assert.match(route, /config\.httpShouldSetCookies = false/)
  assert.match(route, /config\.urlCache = nil/)
  assert.match(route, /completionHandler\(nil\)/)
  assert.match(route, /URLSession\(.*\n\s*configuration: config,/)
  const anonymousProbe = route.slice(route.indexOf('private static func probeVersion('))
  assert.doesNotMatch(anonymousProbe, /Authorization|accessToken|refreshToken|username|password|SecTrust|challenge|serverTrust|rejectUnauthorized|allowInsecure/)
  assert.doesNotMatch(route, /http:\/\//)
  assert.match(route, /\.cannotConnectToHost, \.timedOut, \.networkConnectionLost/)
  assert.doesNotMatch(route, /\.secureConnectionFailed,\s*\.serverCertificateUntrusted/)
  assert.match(route, /throw AuthFailure\.invalidLANProbe/)
  assert.match(route, /throw AuthFailure\.redirectRefused/)
})

test('every native Server session reuses the scoped TLS delegate', () => {
  const source = path.join(root, 'ios/XDriveIOS')
  let sessions = 0
  for (const name of fs.readdirSync(source).filter(name => name.endsWith('.swift'))) {
    const swift = read(`ios/XDriveIOS/${name}`)
    const delegates = [...swift.matchAll(/:\s*NSObject,\s*URLSession(?:Task|Data|Download|Stream)?Delegate/g)]
    // The private Files Saved Searches client owns a redirect-only task
    // delegate. It must not implement TLS challenge handling, bypass trust,
    // set cookies or introduce a second certificate authority. Keep every
    // other delegate creation forbidden rather than removing this audit.
    if (name === 'NativeLANTrust.swift') {
      assert.equal(delegates.length, 1, name)
    } else if (name === 'NativeFilesSavedSearches.swift') {
      assert.equal(delegates.length, 1, name)
      assert.match(swift, /class XDriveIOSNativeFilesSavedSearchNoRedirect: NSObject, URLSessionTaskDelegate/)
      assert.match(swift, /willPerformHTTPRedirection[\s\S]*?completionHandler\(nil\)/)
      assert.doesNotMatch(swift, /didReceive challenge|serverTrust|SecTrustSetAnchorCertificates|allowInsecure|rejectUnauthorized/)
      assert.match(swift, /ServerAddress\.parse\(owner\.origin\.absoluteString\)/)
      assert.match(swift, /parts\.scheme == "https"/)
      assert.match(swift, /config\.httpShouldSetCookies = false/)
    } else {
      assert.equal(delegates.length, 0, name)
    }
    assert.doesNotMatch(swift, /URLSession\.shared|URLSessionConfiguration\.background\(/, name)
    sessions += [...swift.matchAll(/URLSession\(/g)].length
  }
  assert.ok(sessions >= 30)
})

test('LAN certificate bootstrap authenticates the configured domain without dialing its public IP', () => {
  assert.match(bootstrap, /NWConnection\(host: \.ipv4\(address\)/)
  assert.match(bootstrap, /sec_protocol_options_set_tls_server_name\(options, host\)/)
  assert.match(bootstrap, /SecPolicyCreateSSL\(true, host as CFString\)/)
  assert.match(bootstrap, /SecTrustEvaluateWithError\(evaluation, nil\)/)
  assert.match(bootstrap, /GET \/_xdrive\/desktop\/lan-root\.crt HTTP\/1\.0/)
  assert.doesNotMatch(bootstrap, /SecTrustSetAnchorCertificates|Authorization:|Cookie:|http:\/\//)
  const pairing = route.slice(route.indexOf('static func verifyPairing('), route.indexOf('private static func probeVersion('))
  assert.ok(pairing.indexOf('XDriveIOSLANCertificateBootstrap.fetch') < pairing.indexOf('try await probeVersion'))
  assert.match(pairing, /mode: \.verifyingPairing\(target, der\)/)
})

test('native login reuses chosen HTTPS origin for real login, Owner, refresh and logout', () => {
  const signIn = model.slice(model.indexOf('func signIn() async'), model.indexOf('func signOut() async'))
  assert.match(signIn, /let configuredOrigin = try ServerAddress\.parse\(serverInput\)/)
  assert.match(signIn, /let origin = try await XDriveIOSNativeLANLoginRoute\.selectOrigin/)
  assert.ok(signIn.indexOf('selectOrigin(') < signIn.indexOf('AuthService(origin: origin).login('),
    'anonymous probe must precede the only credential POST')
  assert.match(signIn, /lanIPText == lanInput/)
  assert.match(signIn, /XDriveNativeOwnerRootVerifier\(\s*origin: origin,/)
  assert.match(signIn, /active = Session\(\s*origin: origin/)
  assert.match(signIn, /serverText = configuredOrigin\.absoluteString/)
  assert.match(model, /origin: owner\.origin\.absoluteString/)
  assert.match(model, /AuthService\(origin: snapshot\.origin\)/)
  assert.match(model, /let origin = try ServerAddress\.parse\(saved\.origin\)/)
  assert.match(model, /AuthService\(origin: origin\)\.refresh\(/)
  assert.match(model, /AuthService\(origin: previous\.origin\)\.logout\(/)
  assert.doesNotMatch(signIn, /AuthService\(origin: configuredOrigin\)\.login\(/)
  assert.doesNotMatch(signIn, /login\(.+catch.+login\(/s)
})

test('downstream PhotoKit, Gallery and original uploads use verified Owner origin', () => {
  const gallery = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
  const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
  const upload = read('ios/XDriveIOS/NativeUploadSessionTransport.swift')
  const verifier = read('ios/XDriveIOS/OwnerRootVerifier.swift')
  assert.match(gallery, /ServerAddress\.parse\(owner\.origin\.absoluteString\)/)
  assert.match(cloud, /ServerAddress\.parse\(owner\.origin\.absoluteString\)/)
  assert.match(upload, /ServerAddress\.parse\(origin\.absoluteString\)/)
  assert.match(verifier, /ServerAddress\.parse\(origin\.absoluteString\)/)
  assert.match(read('ios/XDriveIOS/NativeOwnerSessionStore.swift'), /origin: String/)
})
