# Native iOS sign-in foundation, before replacing the WebView shell

This is a deliberately **unmounted** SwiftUI login/Owner proof module. It
adapts the structure of the historical native #2891 LoginScreen, but does
not import the retired LoginViewModel or KeychainSessionStore. The current
XDriveIOSApp remains unchanged and still presents its transitional PWA
WKWebView. A successfully built IPA with this source does **not** mean
the App has already switched to native Files/Gallery/Photos.

## Real independent native contract

- The native login screen provides a trusted HTTPS Server URL (domain or
  certificate-valid IP), username, password reveal and optional keep-login.
  It uses current AuthService and rejects credential redirects/TLS errors.
- Before reporting success, the native controller authenticates and GETs
  both Server /me and Owner /nodes/root through current trusted
  XDriveNativeOwnerRootVerifier. A login response alone is not Owner proof.
- NEW Keychain service com.lazyxu.xdrive.ios.native-owner-session.v2
  keeps only the verified Owner/Server-instance/Root and rotating refresh
  credential with WhenUnlockedThisDeviceOnly. An access token is memory-only.
  The obsolete com.lazyxu.xdrive.ios.session/xdrive.refresh is still purged
  by IOSRetiredNativeLogin and is NOT restored or migrated.
- A saved session is auto-restored only after refresh rotation and fresh
  Owner/root proof match every saved identity component. On Owner mismatch,
  credentials are not treated as logged in. Every async request uses a
  generation fence to reject stale Server/Owner responses.
- Explicit logout first invalidates native memory, then clears native
  Keychain, then attempts remote logout. Network failure is not shown as
  confirmed server revocation. Failure removing credentials is explicit.
- Password-change-required returns an honest unsupported native-migration
  warning and establishes no Owner session. The native password-change
  page is subsequent work, not a claim that the native client is finished.
- This initial module is NOT authorized to control previously approved
  iOS background PhotoKit grants. Do not attach it to the current running
  PWA backup or replace WKWebView login without a reviewed Owner/Device
  grant handoff and exact native photo/UI integration.

## Validation and next steps

Source contract: desktop/tests/ios-native-owner-login-foundation.cjs.
Full iPhoneOS Swift compilation in ios-unsigned-ipa.yml and affected
Go/CI/Server/Owner regression is required for this exact PR SHA.
Native login has no physical iPhone acceptance; mark that
**跳过（未验收）**, never as a successful installation.

Next: mount native Server/Login behind a tested incremental native app
switch only after Files/Gallery/Settings navigation, native password change,
Owner A→B→A invalidation and PhotoKit backup authorization are verified.
Never delete current iOS encrypted ledgers/UploadSession receipts or
create a second Go/CAS writer.
