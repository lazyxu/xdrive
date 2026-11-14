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
  assert.match(route, /URLSession\(configuration: config, delegate: verifier, delegateQueue: nil\)/)
  const anonymousProbe = route.slice(route.indexOf('private static func probeVersion('),
    route.indexOf('private struct XDriveIOSLANVersion'))
  assert.ok(anonymousProbe.length > 100, 'real anonymous probe implementation found')
  assert.doesNotMatch(anonymousProbe,
    /Authorization|accessToken|refreshToken|username|password|rejectUnauthorized|allowInsecure/)
  assert.match(route, /if verifier\.rejectedServerTrust/)
  assert.match(route, /throw XDriveIOSLANPairingFailure\.ipCertificateInvalid/)
  assert.match(route, /let timeout: TimeInterval = pairing \? 8 : 3/)
  assert.match(trust, /SecTrustSetAnchorCertificatesOnly\(trust, true\)/)
  assert.match(trust, /if SecTrustEvaluateWithError\(trust, nil\) \{\s*return XDriveIOSLANTrustInspection\(verdict: \.trusted, setupOSStatus: nil\)/)
  assert.match(trust, /SecTrustCopyCertificateChain\(trust\)/)
  assert.match(trust, /SecPolicyCreateBasicX509\(\)/)
  const strictInspect = trust.slice(trust.indexOf('static func inspectDetailed('))
  assert.ok(strictInspect.indexOf('if SecTrustEvaluateWithError(trust, nil) {') <
    strictInspect.indexOf('SecTrustCopyCertificateChain(trust)'),
  'secondary certificate-chain diagnosis must follow strict IP SAN + paired CA trust refusal')
  assert.doesNotMatch(route, /http:\/\//)
  assert.match(route, /\.cannotConnectToHost, \.timedOut, \.networkConnectionLost/)
  const fallback = route.slice(route.indexOf('static func selectOrigin(\n'),
    route.indexOf('static func verifyPairing('))
  assert.match(fallback, /\.cannotConnectToHost, \.timedOut, \.networkConnectionLost/)
  assert.doesNotMatch(fallback, /\.secureConnectionFailed|\.serverCertificateUntrusted/,
    'IP certificate failures never trigger a credential-bearing DNS fallback')
  assert.match(route, /throw AuthFailure\.invalidLANProbe/)
  assert.match(route, /throw AuthFailure\.redirectRefused/)
})

test('every native Server session reuses the scoped TLS delegate', () => {
  const source = path.join(root, 'ios/XDriveIOS')
  let sessions = 0
  for (const name of fs.readdirSync(source).filter(name => name.endsWith('.swift'))) {
    const swift = read(`ios/XDriveIOS/${name}`)
    const delegates = [...swift.matchAll(/:\s*NSObject,\s*URLSession(?:Task|Data|Download|Stream)?Delegate/g)]
    assert.equal(delegates.length, name === 'NativeLANTrust.swift' ? 1 : 0, name)
    assert.doesNotMatch(swift, /URLSession\.shared|URLSessionConfiguration\.background\(/, name)
    sessions += [...swift.matchAll(/URLSession\(/g)].length
  }
  const savedSearch=read('ios/XDriveIOS/NativeFilesSavedSearches.swift')
  assert.match(savedSearch,/XDriveIOSNativeFilesSavedSearchNoRedirect:\s*XDriveIOSServerTLSDelegate,\s*URLSessionTaskDelegate/)
  assert.match(savedSearch,/willPerformHTTPRedirection[\s\S]*?completionHandler\(nil\)/)
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

test('iOS pairing identifies the real failure stage while preserving strict root/IP identity', () => {
  assert.match(route, /static func pairingProbeFailure\(_ error: Error\)/)
  assert.match(route, /case \.secureConnectionFailed:[\s\S]*?return \.ipTLSHandshakeFailed\(url\.errorCode\)/)
  assert.match(route, /case \.serverCertificateUntrusted, \.serverCertificateHasBadDate/)
  assert.doesNotMatch(route, /case \.secureConnectionFailed, \.serverCertificateUntrusted/,
    'generic transport handshake failures cannot claim confirmed certificate identity denial')
  assert.match(route, /case \.redirectRefused: return \.ipVersionRedirect/)
  assert.match(route, /case \.invalidLANProbe: return \.ipVersionInvalid/)
  assert.match(route, /ipVersionStatus\(http\.statusCode\)/)
  assert.match(route, /guard let der = XDriveIOSLANPairing\.rootDER\(from: pem\)/)
  assert.match(route, /mode: \.verifyingPairing\(target, der\), pairing: true/)
  assert.match(route, /throw pairingProbeFailure\(error\)/)
  assert.match(route, /if verifier\.rejectedServerTrust/)
  assert.match(route, /stateLock\.lock\(\)/)
  assert.match(route, /completionHandler\(nil\)/)
  assert.match(trust, /SecTrustSetPolicies\(trust, SecPolicyCreateSSL\(true, target\.ip as CFString\)\)/)
  assert.match(trust, /SecTrustSetAnchorCertificatesOnly\(trust, true\)/)
  assert.match(trust, /SecTrustSetNetworkFetchAllowed\(trust, false\)/)
  assert.doesNotMatch(route+trust+bootstrap,
    /InsecureSkipVerify|tlsInsecure|allowUntrusted|trustAllHosts/)
})


// A transport-level TLS failure is not a pinned-CA/IP-SAN verdict unless
// Apple Security's actual server-trust challenge has rejected the chain.
test('LAN pairing distinguishes handshake errors from strict pinned trust evidence', () => {
  assert.match(route, /case \.secureConnectionFailed:\s*\/\/ A TLS handshake/)
  assert.match(route, /return \.ipTLSHandshakeFailed\(url\.errorCode\)/)
  assert.match(route, /switch verifier\.trustRejection/)
  assert.match(route, /\.ipIdentityOrServerUsageMismatch:/)
  assert.match(route, /\.chainOrValidityMismatch:/)
  assert.match(trust, /SecPolicyCreateSSL\(true, target\.ip as CFString\)/)
  assert.match(trust, /SecPolicyCreateBasicX509\(\)/)
  assert.match(trust, /Negative-result diagnosis only/)
  assert.match(trust, /if SecTrustEvaluateWithError\(trust, nil\) \{\s*return XDriveIOSLANTrustInspection\(verdict: \.trusted, setupOSStatus: nil\)/)
  assert.match(trust, /SecTrustGetVerifyTime\(trust\)/)
  assert.doesNotMatch(route + trust, /InsecureSkipVerify|trustAllHosts|allowUntrusted/)
})

test('only user-requested pairing emits bounded TLS evidence, never changes trust decision', () => {
  assert.match(route, /if pairing, let evidence = verifier\.pairingEvidence/)
  assert.match(route, /ipCertificateWithoutChallenge\(url\.errorCode\)/)
  assert.match(route, /override func observedPairingEvidence\(/)
  assert.match(trust, /if case \.verifyingPairing = mode/)
  assert.match(trust, /reason: \.challengeIdentity/)
  assert.match(trust, /reason: challenge\.previousFailureCount != 0 \? \.retryChallenge : \.trustObjectMissing/)
  assert.match(trust, /peerLeafDigest\(trust\)/)
  assert.match(trust, /SecCertificateCopyData\(leaf\)/)
  assert.match(trust, /setupOSStatus/)
  assert.match(trust, /SecTrustSetAnchorCertificatesOnly\(trust, true\)/)
  assert.match(trust, /SecTrustSetNetworkFetchAllowed\(trust, false\)/)
  assert.doesNotMatch(trust, /print\(|NSLog\(|debugPrint\(|os_log\(/)
  assert.doesNotMatch(trust, /privateKey|SecKeyCopyExternalRepresentation|Authorization:|Cookie:|Bearer /)
})
