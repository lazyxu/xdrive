# Native iOS Photos: Free Up Space / APNs / locked-screen recovery (single PR)

Target branch: `feat/ios-photos-free-space-apns-bg-recovery-20261109`.
Existing baseline: #4104 and #4126 are merged. This is **not** a declaration
that the new three capabilities are complete.

## Current implementation in this branch
- Pure `PhotoBackupResiliencePolicy` rejects unexpected/alerting APNs payloads;
  an APNs wake is not a backup receipt or an upload authorization.
- `PhotoBackupRemoteHintDelegate` passes a specifically-shaped silent hint to
  the existing `BackgroundPhotoTask` recovery gate. It requests **one future**
  BGProcessing window only after re-reading the exact Owner/Source/Target grant,
  Full Photos scope, original protected-data availability, approved automatic
  plan, current stop generation, no pending UploadSession receipt, no full-history
  recovery and no existing pending BG task. Remote hints are throttled at the
  native Owner scope; no writer is launched by the callback.
- The Free Up Space policy requires a durable Server retention guarantee over
  *all* original resources, including Live still+motion, before an iPhone original
  may be deleted. No existing historical ACK/Node proof can grant that guarantee.

## Explicitly not complete / still blocking shipping
1. **Free Up Space:** a Server-backed retention hold/lease whose validity survives
   concurrent Owner Node deletion, version replacement, trash/restore and CAS GC;
   authenticated per-original SHA / full Live-pair proof, foreground item-by-item
   irreversible-action confirmation, bounded batch and receipt; original deletion
   stays disabled while any check or hold is absent. On iCloud Photos, Apple
   deletions affect every synchronised device.
2. **APNs delivery:** Apple-signed `aps-environment` entitlement/provisioning,
   Owner+Device+Source+Target scoped token registration/rotation/revocation,
   private encrypted Server token store, authenticated ES256 APNs provider,
   periodic bounded scheduling and rate limits, invalid-token cleanup,
   integration tests and physical signed-device acceptance. Adding the delegate
   or `remote-notification` background mode does not itself deliver pushes.
3. **Locked-screen background operation:** iOS can refuse/delay/terminate
   BGProcessing and throttle silent pushes; `FileProtection.complete`
   originals and `WhenUnlockedThisDeviceOnly` journal remain intentionally
   inaccessible while locked. Never lower security to claim a continuous
   locked-screen upload. The safe product contract is *eventual foreground /
   system-admitted recovery*, Focused Backup and explicit blocked diagnostics.

## Test and merge rules
- Exact HEAD must pass macOS Swift policy tests, unsigned IPA, Node source
  contracts, full CI and Final Gate. Do not merge this draft as a completed
  three-feature delivery until the Server hold and token sender exist and the
  destructive feature has independent proof.
- Physical iPhone, APNs signing and locked-original acceptance: 跳过（未验收）.
- Preserve one existing UploadSession/CAS/Node writer. Unknown ACK, Owner change,
  revoke and protected data failures fail closed.


## APNs Server + native integration (next implementation stage)

The continuation adds an encrypted **grant-owned** APNs token channel with
`PUT/DELETE /api/v1/ios/photos/background-managed/apns-token`; both routes
require the current independent native Device secret and revocable managed
Photo grant. The Server rechecks Owner session, Device, Source and Target in
the mutation transaction and encrypts the opaque device token with a versioned
AES-GCM Source credential keyring, never plaintext or a generic JWT.
Registration of the same token preserves its existing hint rate limit.
Grant rotation invalidates its previous token automatically.

An **optional** server wake worker sends only `content-available:1` without
PhotoKit identifiers, Node references, credentials or user-facing content;
APNs requests use TLS+HTTP/2, ES256 provider JWT, the app topic, background
push type and priority 5. Every candidate is rechecked against the current
Owner/Device/Source/Target; a per-grant atomic claim allows at most one hint
per two hours across competing server instances. Apple token revocation
clears only a matching token digest and never deletes an uploaded original.
The OS may delay, throttle or discard the hint.

**Deployment prerequisites (no secrets in Git):**
- Signed iOS app provisioning with `aps-environment` and `remote-notification`.
- Server operator supplies `XD_IOS_PHOTO_APNS_TEAM_ID` and
  `XD_IOS_PHOTO_APNS_KEY_ID` (Apple 10-character identifiers) and
  `XD_IOS_PHOTO_APNS_PRIVATE_KEY_FILE` (secured local Apple .p8 PKCS8 path).
- Configure the versioned `XD_CONNECTOR_SECRET_*` keyring to encrypt the
  stored token. Incomplete key/entitlement configuration MUST disable APNs
  rather than storing plaintext, faking a wake or blocking foreground backup.
- The App requests a token only after the existing exact Owner/Device
  background grant has been explicitly enabled and verified. A late callback
  rechecks the captured Owner and stop generation; wrong Owner/expired grants
  cannot register. Token registration is NOT a receipt and cannot upload.
- Unsigned IPA, real APNs provider credentials and physical signed iPhone
  validation: **跳过（未验收）**. A successful CI build alone is not delivery.

**Remaining high-risk gap:** no protected Server retention hold that survives
Node delete/trash/version rewrite and CAS garbage collection. Therefore
`PHAssetChangeRequest.deleteAssets` is still deliberately absent. The
Free Up Space check is a fail-closed *policy only*, not permission to delete
iPhone originals. Do not declare this feature complete or merge a Draft based
solely on the new APNs tests.
