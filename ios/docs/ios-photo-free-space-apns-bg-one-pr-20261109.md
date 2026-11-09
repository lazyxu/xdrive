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
