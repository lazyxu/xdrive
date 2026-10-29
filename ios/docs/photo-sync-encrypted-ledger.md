# iOS native PhotoKit backup intent ledger — v1 (not yet wired to a Runner)

This is an internal, on-device state machine. There is **no automatic photo sync,
no Device registration, no upload button and no Server mutation in this PR**.
It is deliberately independent of PhotoKit inspection/export #3059/#3062 and
native UploadSession transfer #3061. The user cannot mistake a stored intent for
a Server-confirmed backup.

## Identity and privacy

Every encrypted file is partitioned by **canonical HTTPS origin + PostgreSQL
installation ID + authenticated numeric Owner ID + Owner root node ID +
Server-registered Device ID**. An account name, local IP alone, or an arbitrary
unverified device label is not a sufficient scope. The eventual caller must
first read the current Owner/Root and Device binding from the Server and verify
ACL/version. This API validates formatting and positive IDs; **it does not**
perform the Server verification itself.

Use only the single `XDrivePhotoSyncLedger.shared` actor within the app.
Its key comes from a random 256-bit ThisDeviceOnly, WhenUnlocked Keychain
secret. The journal is AES-256-GCM sealed with the exact scope as additional
authenticated data and written atomically under app-private Application Support
with iOS Complete Data Protection (0600 file / 0700 directory). Each
PhotoKit `localIdentifier` appears only as an HMAC-based opaque fingerprint,
never plaintext in the journal or filename. The resume key is an opaque HMAC,
not a private Photos ID or a token. No credentials, private photo originals or
GPS are persisted in this journal.

Missing keys, invalid GCM authentication, truncated envelopes, changed scope
and incompatible versions **fail closed**. Do not silently delete corrupted
journals and then send the original again. This is an app-level atomic write
and file-sync barrier; a physical power-loss durability claim still requires
real-device fault-injection tests and storage evidence.

## Before and after network effects

`prepare` returns an existing operation for the same exact Owner/resource/
destination/hash or atomically stores a new `prepared` entry. A queue holds at
most **1024** operations; a 100k+ album must page candidates rather than load
the entire library into a single in-memory list.

The future owner-bound Runner must observe the following transitions:

| State | Meaning | Safe next action |
| --- | --- | --- |
| `prepared` | No Server POST has been initiated | Persist `creating` before the first POST |
| `creating` | A create request **may** have reached the Server | Reconcile by stable resume key using a reviewed Owner protocol; no fresh new key |
| `uploading` | Server session ID was recorded after validating its response | Read-only session GET, compare exact chunks, then explicitly send missing parts only |
| `finalizing` | Finalize may already have committed physically | GET session status and obtain final file receipt; never assume ACK loss means failure |
| `needsReconciliation` | Uncertain commit/Owner or session evidence | Manual/automated **read-only** reconciliation first |
| `confirmed` | Server-proven matching node ID/revision/bytes/hash recorded | Display only the particular original-resource commit, not a paired Live Photo or complete album |

`beginCreate` and `beginFinalize` write their state before the corresponding
network mutation. The exact Server session UUID is stored once received.
`confirmReceipt` requires the same known session, destination, size, hash
and positive Server Node+revision. It must be called only after the trusted
authenticated current-Owner Server response has been validated. The Ledger
does not infer PhotoAsset/PhotoResource pairing or mark Live photos complete.

The journal survives an ordinary app restart and Owner switch but must never
be read or resumed under a different scope. Explicit `clearLocalRecords`
removes local proof only; the Server may still contain a finalized file. The
UI must warn that forgetting an unresolved record does not undo the remote
write.

## Missing integration and acceptance

1. Implement a real Server-authenticated native Device/Root registration and
   verify Owner/Root before constructing a scope.
2. Wire PhotoKit resource roles and `PHAssetResourceManager` staged originals
   to exact encrypted intent and the existing Go UploadSession protocol.
3. Add startup/refresh/401/403/revocation and interrupted-create reconciliation
   that uses a stable `resume_key` before any new writes.
4. Verify Owner isolation, unchanged/modified media, double Live resources,
   100k paging, app termination, iOS protection/locked-file errors and
   server-issued session expiry using executable test fixtures.
5. Physical iPhone, SideStore, actual Photos/iCloud and production safety
   acceptance remain **跳过（未验收）**, not blockers for unrelated code/CI.

The encrypted ledger is **necessary but not sufficient** for reliable native
photo backup. No durable Server commit can be inferred from its presence alone.
