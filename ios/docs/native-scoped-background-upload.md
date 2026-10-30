# iOS native original UploadSession: ONE Swift state machine, TWO scoped auth modes

This follows #3147 (merged foreground PhotoKit still/video/Live originals),
#3164 (revocable Owner/Device/Root BG grant), #3166 (restricted Go
UploadSession/CAS aliases), #3171 (native-only Keychain transport) and #3182
(explicit approved after-first-unlock BG proof).

## Actual code change

The existing \`XDriveNativeUploadSessionTransport\` remains the **only**
Swift implementation of file SHA-256, 8-MiB chunk hashing, durable session
checkpoints, Go UploadSession create, received-part readback,
chunk PUT, finalize ACK uncertainty and verified final Node result.
We added a **second authentication envelope**, not a second uploader:

- **Foreground:** current short-lived Web -> native Owner access JWT and
  the original \`/api/v1/uploads\` endpoints (unchanged default).
- **Restricted iOS background:** only a native-only
  \`XDriveIOSApprovedPhotoBGCredential\` previously authenticated with the
  current Server grant+Device proof. No ordinary bearer, cookie or WebView
  session is present. Every request goes exclusively through
  \`/api/v1/ios/photos/background/uploads\` aliases provided by #3166,
  using the separate \`X-XDrive-IOS-Photo-Grant\` and
  \`X-XDrive-Device-ID/Token\` credentials. Go then enforces exact
  Owner, Root, iOS HMAC resume key, original name, size, TTL and revocation.

The native restricted mode rejects:
- manual \`iosmanual_\` one-off uploads without a sealed encrypted intent;
- any parent other than the approved Owner Root, arbitrary target Node IDs,
  files outside the deterministic \`-xios-<24hex>-<12hex>[.ext]\` namespace,
  oversize originals and invalid/missing 256-bit resume keys;
- arbitrary User paths, preflight, Node lists, deletion, admin, sharing,
  SourceRun and unexpected UploadSession methods/parameters.

Paths are checked by a pure Swift parser (UUID, \`/chunks/N\`, \`/finalize\`)
BEFORE being rewritten to exact Go restricted routes. No pass-through path
with user-selected host, query string or redirect is accepted.

The Swift transport **always uses an ephemeral, cookie-free, system TLS
URLSession with a delegate that unconditionally rejects redirects**.
It does NOT attach the long-lived grant/Device tokens to an Apple
background URLSession file task; that will need short-lived single-task
tickets or equally restrictive redirect control. File uploads can currently
run only within an actively executing BGProcessingTask. The scheduler
#3182 remains intentionally proof-only until its journal/staging/bounded
job/Owner readback integration is complete.

## Why this design

- Go remains the single CAS/postgres/quota/upload engine, and the exact
  Owner-root capability routes remain narrow.
- Swift remains the single native PhotoKit exporter/uploader/journal engine
  rather than embedding a duplicate Go runtime into the IPA.
- The same exact create/finalize ACK uncertainty handling and durable
  \`XDriveNativeUploadCheckpointHooks\` apply in both modes.
- No network write can occur unless a *separate calling Runner* has
  first durably prepared the correct encrypted intent, and Server verifies
  the native grant for each operation.

## Verification

A Foundation-only executable tests correct allowed route translation,
UUID/part-index bounds, and malformed/foreign file names. Included in the
existing macOS unsigned IPA CI without reducing any other checks.
Desktop source contract checks ensure both auth modes share the same
\`uploadInternally\` engine and that a BG grant is never used on general
\`/api/v1/uploads\` or to authorize \`uploadOnce\`.

Exact-HEAD Xcode iPhoneOS build, real Go/PostgreSQL Owner/CAS integration,
route redirect behavior, real ACK-loss and an actual iPhone BGTask file
transfer remain required before merging. Physical acceptance: **跳过（未验收）**.
