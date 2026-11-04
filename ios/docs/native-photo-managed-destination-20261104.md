# iOS Photos native managed backup destination — stage 1

Decision: **a destination is mandatory**, configured with **one folder name**.
The text input is initially prefilled from the current iPhone's device name
(or "iPhone" when invalid). The name is a leaf only, not a path. The
Server constructs and owns the final destination:

```
同步文件夹 / 设备备份 / <server-verified device name>_<stable device-id prefix> / <user-entered folder name>
```

Contract introduced by this scoped, stacked development PR:

- Authenticated `GET /api/v1/ios/photos/backup-destination`: requires current
  Owner **and** registered iOS identity proof headers; returns
  `configured=false` and `suggested_name` or verified
  `{source_id,device_id,name,target_node_id,target_path}`.
- Authenticated `PUT /api/v1/ios/photos/backup-destination` with
  `{"name":"..."}`: creates a **paused**, managed `ios_photos` Push
  Source and exact exclusive Node **in one transaction**; retries with the
  same name are idempotent. Another name performs a 5B atomic Source+real
  Node rename; no user-chosen `parent_id`/`target_node_id` is accepted.
- Identity-only iOS credentials are accepted on this *one* dedicated endpoint,
  not by `POST /sources` or Desktop local-folder Agent/Root APIs.
- The already existing Local Push device-group policy provides UUID-disambiguated
  names and rejects unverified folder takeover, overlapping Source trees, and
  mixed-provenance device group adoption.
- All old Owner-root photo files and encrypted upload receipts remain intact.
  This stage does **not** silently reparent, delete or declare them transferred.

**Native UI now staged in this development branch:** iOS Photos displays a
required single-name TextField, only registers a device after an explicit tap,
uses a verified Owner session plus exact registered-device proof for the Server
GET/PUT, and displays only the returned target_path and Node ID. Cancellation
and Owner-switch invalidate pending results. There is no JS/WebView or local
cloud-path construction. The UI does not grant write permission.

**Explicitly NOT completed:** mandatory runtime gating of *all* old
manual/automatic/BG photo uploads, scoped managed UploadSession create/finalize/
receipt admission, changeover of old sealed Owner-root journal records, or
iPhone hardware acceptance. The existing uploader still targets Owner root. A managed Node
rejects generic Files uploads, so **never** substitute this new NodeID into
the existing iOS uploader before the dedicated Go upload authorization and
both foreground/background receipt verifiers are integrated.

Parent: #3757. This branch is stacked on its development HEAD (not merged
into master). Parent #3757 actual Go syntax and outdated Cloud Picker test failures
were repaired in #3757 with 0d1d59e8, then integrated into this child
**development** branch without touching master. The correct new test must
continue requiring server-owned Source/Node creation and no picker.

Acceptance for the next P0 delivery:
1. Explicit device registration, Owner proof and destination name before
   enabling auto/focused/manual/background plans; stale Owner must fail closed.
2. One verified target ID persisted under the current Owner+registered Device;
   no raw target path built locally, no silent Owner-root fallback.
3. Scoped original UploadSession creates/PUTs/finalizes and receipt review
   admitted only for that exact managed Source+Node, including BG grant;
   unknown ACK remains pending with no blind retry.
4. New originals go only to the managed destination; legacy root receipts
   retain their old parent and remain readable/reconcilable.
5. Real iPhone, large-video/Live/iCloud, logout/revoke, duplicate folder name,
   and matching Node-identity acceptance before claiming product MVP.

## Stage 3 — native foreground managed original path (development)

Native manual, scheduled foreground, and focused first-pass windows now use
a read-only verified Owner + registered iOS Device + current Source/Target
lookup **before** reserving an automatic interval or staging a new original.
The same sealed HMAC resume key and ledger are retained, but each new intent
is keyed by the actual `target_node_id`; old Owner-root receipts remain in
the original namespace and can still be reconciled.

The native transport translates only exact canonical UploadSession operations
to `/api/v1/ios/photos/managed/uploads`, with current Owner JWT and enrolled
iPhone token; all writes and Node proof are rechecked by Go against the
current Source/Node/Device. The explicit native TextField must match the
confirmed name before enabling a new UI action; a modified unsaved name is
not silently sent to the old destination. Any missing/unverified target
**fails closed**, not to Owner root.

**Still NOT complete:** iOS `BGProcessingTask` is a separate, previously
Owner-root-scoped grant; its grant, upload, receipt and resume proof must
be rebound to the real Server-managed Source/Target before declaring all
automatic modes 1:1. Until then, native foreground support is a scoped
milestone, not the complete Synology-style automatic backup MVP.

Exact HEAD Go/Postgres, iOS IPA, full CI/Final Gate and real iPhone hardware
acceptance still required, and old roots/journals must not be silently migrated.

## Stage 4 — managed BG grant and destination-bound cursors (2026-11-04)

The native iPhone BG grant now includes the Server-proven `source_id` and
`target_node_id` (nullable when reading **historical** root-only grants).
Issuing a new grant requires the current Owner and independently enrolled iOS
Device **and** its dedicated server-owned `ios_photos` Source/Node. Rotation
rechecks the original pair in the same SQL transaction; renaming the managed
leaf under 5B keeps its NodeID. A removed/rebound Source cannot be renewed.

The dedicated `/api/v1/ios/photos/background-managed/{uploads,receipts}`
group accepts the independently revocable BG grant + separate Device token,
never a generic Owner JWT, Desktop Agent or unscoped SourceRun. The Go
UploadSession/CAS create and Finalize transactions repeat grant expiry,
revocation, Server instance/session generation, Source/Node and device proof.
The old `/ios/photos/background/uploads` root aliases remain **read-only**
for historical GET / resume-lookup / Node receipt; they reject new POST,
chunk PUT and Finalize. Legacy Keychain grants can still be revoked, but are
not counted as valid managed upload authorization. Failed BG grant or Keychain
proofs must never fall back to Owner root.

Automatic, focused and BG PhotoKit position checkpoints now also carry exact
SourceID + TargetNodeID. Old/unknown or changed target identities cause a
safe restart at window **zero**, retaining all confirmed and unresolved
encrypted original receipts. The BG cursor's explicit pending-ACK pause is
not cleared by reconfiguring the target. A focus pass cannot skip previously
processed Windows after a destination migration.

### Still required before calling this the Synology-style MVP
- Exact-HEAD GitHub Go + real PostgreSQL integration and iOS IPA / Final Gate
  must pass, including mandatory Source-target receipt and restart tests.
- Real iPhone (including revoked Photos permission, locked protected data,
  iCloud-only media, large video, atomic Live ZIP and lost finalize ACK) is
  **跳过（未验收）** until physical test evidence exists.
- Time-line/coverage UI must use current managed parent in its read-only
  confirmed-receipt queries; a legacy Owner-root receipt is not current
  managed-target coverage.
- Do not re-encrypt the ordinary local task history or broaden this P0 to
  nonessential privacy enhancements.
