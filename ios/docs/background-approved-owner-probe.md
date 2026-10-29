# iOS background Owner grant: user-approved locked-screen native proof

## Exact scope of this PR

This is the next milestone after #3164 (revocable Owner/Device/Root grant),
#3166 (restricted Go UploadSession aliases) and #3171 (native-only device
registration/Keychain grant transport). It **does not** implement actual
background original-media uploading yet. It makes a real user-approved
BGProcessingTask capable of independently proving scope without a WebView
session, while preserving a strict no-upload default.

## Source-backed behavior

- One canonical React/MUI Settings section includes a separate **native
  background authorization preparation** control. Other Web/PWA/DSM/Desktop
  installations and old IPA builds cannot use it: the iOS Host must advertise
  \`nativeBackgroundGrant:true\`. A distinct field
  \`nativeBackgroundUpload:false\` prevents false capability reporting.
- A current authenticated short-lived Web token authenticates the *initial*
  setup. The iOS Host then independently verifies the current Server/Owner/root
  and shows an explicit **UIKit** confirmation describing the narrowly scoped
  device enrollment, maximum 14-day revocable grant and changed lock-screen
  Keychain accessibility. The native actor registers or verifies the same
  genuine iPhone and receives two independent credentials. Raw secrets are
  never returned to JavaScript.
- The new **background-only** Keychain service
  \`com.lazyxu.xdrive.ios.photos.bg-approved.v1\` holds one active
  Owner/Server/Root/Device grant (and independent device proof) at a time
  under \`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly\`. This is
  available on a locked phone only **after the first device unlock following
  a reboot**; it never migrates to a different device. The original
  foreground login and native Device identity Keychain entries remain
  protected as before. A different Owner cannot silently replace the
  approved background scope.
- A BGProcessingTask is submitted with
  \`requiresNetworkConnectivity=true\` and a system-controlled earliest
  attempt (1, 6, or 24 hours). This is **not a precise clock**; iOS may defer
  launch and user force-quit can prevent relaunch.
- On a system launch, the native task reads only the explicitly approved
  Keychain record, checks expiry and Owner identity, then makes a
  **redirect-denying, ephemeral, cookie-free** HTTPS GET to
  \`/api/v1/ios/photos/background-grants/proof\`, sending the background
  grant and device proof in separate headers. The current Server must
  reconfirm the exact grant ID, Owner, iPhone ID, Root, server instance,
  expiry and \`upload_authorized\`; it independently checks user account
  SessionVersion, device and grant revocation. A rejected/missing/unreadable
  grant fails closed and does not retry aggressively. BGTask expiration
  cancels the native request.
- An explicit user **disable** first marks the normal native grant as
  revoke-pending, cancels any scheduled BG task, deletes the
  after-first-unlock background credential, then attempts remote revoke.
  Failure to reach the Server is NOT a success receipt; the UI shows the
  remote revocation is still pending and can retry.
- The separate shared UI only displays safe booleans and expiry, never raw
  grant/device secrets, resume keys, asset IDs or media originals.

## Why this is not yet unattended backup

- BGTask currently completes a *read-only grant proof*, NOT a PhotoKit scan
  or UploadSession write. This is deliberate: the encrypted original
  journal's own key still uses a locked-screen Keychain protection class,
  PhotoKit private staging files still use complete data protection, and
  the foreground Swift upload client relies on a short-lived Web Owner token.
  None of those can be silently reused in the background.
- To enable actual locked-screen uploads, a follow-up must implement a
  bounded, BG-owned journal/staging policy; resume existing Owner's
  \`ios_\` HMAC session through **only** the dedicated Go capability
  endpoints; use strict redirect-denying requests for any long-lived
  credentials, or per-file/per-chunk short-lived tickets for Apple's
  background URLSession; handle partial finalize ACKs, expiration,
  interruption, Owner/password/Device revoke and exact Node SHA/revision.
- The user must not be promised a precise 15-minute background cadence.
  Foreground #3147 can offer its own intervals while the App is open;
  this native proof initially schedules 6-hour system-controlled checks
  after explicit approval.

## Validation

The pure Swift \`BGApprovalPolicy.swift\` accepts only approved 60-minute,
6-hour and 24-hour intervals and bounded grant expiry, with a
\`swiftc -swift-version 5\` executable test (PASS locally; exact test is now
in the unsigned IPA CI workflow). Desktop contract tests assert that the
real Host/React bridge does not export secrets, all native requests block
redirects and background probe does NOT run the upload engine.

Before any merge: exact-HEAD iOS IPA/Web TypeScript and security-gated
Server CI must pass. Physical iPhone after-first-unlock/lockscreen,
SideStore, real grant expiry/Owner revocation/network partitions, background
wake timing and 100k files: **跳过（未验收）**.

Apple reference:
https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly
https://developer.apple.com/documentation/backgroundtasks/bgprocessingtaskrequest
