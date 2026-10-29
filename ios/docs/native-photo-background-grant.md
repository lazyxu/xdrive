# iOS native background Photo grant — Keychain credential lifecycle

This follows [#3164](https://github.com/lazyxu/xdrive/pull/3164)
(Server Owner/Device/Root grant) and
[#3166](https://github.com/lazyxu/xdrive/pull/3166)
(Grant-scoped Go UploadSession/CAS endpoints). It is a native Swift
credential transport — **NOT** a new SwiftUI page, new uploader, or a claim
that locked-screen automatic PhotoKit backup is running.

## One explicit native authorization

1. The user is currently logged in to the canonical React/MUI PWA and has
   independently granted iPhone Photos access. A future Host Adapter command
   shows an **iOS system confirmation** that registering this device and
   granting background original backup will authorize Server writes.
2. Native verifies the current Owner, installation instance and root using
   the short-lived *current* access token. It verifies an existing registered
   iPhone. If the user explicitly approved Device registration, it uses the
   existing `XDriveIOSDeviceEnrollment.enroll`; it never registers a second
   Device after an unknown/lost enrollment ACK.
3. The Device's secret stays in the original native-only
   `com.lazyxu.xdrive.ios.device-identity.v1` Keychain namespace. A separate
   Swift-only proof type can temporarily access that secret to request an
   independent grant; it is non-Codable and has a redacted description.
4. Native POSTs to `/api/v1/ios/photos/background-grants` with BOTH the
   current Owner bearer and real Device ID/secret, through a cookie-free,
   ephemeral, system-TLS session with redirect denial.
5. Native verifies the server's returned Device ID, root ID, UUID, expiry
   and 256-bit canonical opaque grant. The grant is persisted in a distinct
   **WhenUnlockedThisDeviceOnly** Keychain namespace, bound to a SHA-256
   digest of canonical Server origin, installation ID, Owner and root.
6. Safe metadata only (`enabled`, `revokePending`, `expiresAt`) may be
   displayed in the shared React settings; **raw grant and device token
   must never enter WebKit JavaScript, logs, preferences or URLs**.

## Lifecycle and revocation

- `verifyRemote` checks the current Owner/root with real Web auth, then
  sends the grant **and** Device secret to the Server's exact scoped proof
  endpoint via ephemeral, redirect-denying HTTPS. It must never silently
  treat an unavailable/revoked secret as successful authorization.
- `disable` first persists `revokePending=true`, which any subsequent
  background runner must reject; then attempts the current Owner-authenticated
  server-side revoke endpoint. Only after a real 200 acknowledgment does
  the app delete the local grant. A lost ACK/network failure keeps a durable
  local `revokePending` record, never resumes an upload, and can be retried.
- The Owner can revoke a lost iPhone grant from another client via the
  Server's authenticated revoke API. Device revocation and account session
  version changes are additional fail-closed fences.
- Server grant expiry remains 14 days. Swift now provides a separate
  **no-WebView** `verifyNativeBackgroundGrant` read-only Server proof and
  `rotateNativeBackgroundGrant`: these use ONLY a previously stored grant
  plus its independently protected iOS Device identity secret. A valid
  grant is renewed through the Server's atomic rotation endpoint, then
  stored before it can be used by a later task. Expired/revoked grants
  cannot silently renew. Neither method creates an UploadSession.
- `WhenUnlockedThisDeviceOnly` currently prevents reading both secrets
  during a normal locked-screen BGTask. Such a task must fail closed; no
  alternative global Web session/token is substituted.

## Important remaining blockers

**WhenUnlockedThisDeviceOnly is unavailable while the iPhone is locked.**
The current Device identity token has the same restriction. This transport
therefore **does not establish usable locked-screen upload credentials**.
Moving to `AfterFirstUnlockThisDeviceOnly` must require an explicit User
decision, accurate Server revocation and physical security testing.

Native Host Adapter onboarding, BGProcessingTask scheduling, a reconnecting
background URLSession with short-lived per-part tickets/redirect fences,
restart-safe staging, Owner refresh, 1024-entry encrypted journal sharding
and true Live original restore remain independent implementation gaps.

The new Swift file is compile-time included by XcodeGen's entire
`ios/XDriveIOS` source directory. Exact-HEAD unsigned IPA compilation
and actual device/SideStore/login/Keychain tests are still required; real
iPhone/lock-screen behavior is **跳过（未验收）**.
