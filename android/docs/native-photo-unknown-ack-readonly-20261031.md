# Android original backup — exact unknown ACK read-only reconciliation

Date: 2026-10-31. Scope is **Android native Photos MVP plus the strictly
necessary Go Owner upload-receipt lookup**, not optional at-rest encryption,
general UploadSession recovery, Desktop Agent, iOS or CAS changes.

## Wire-level evidence and resume identity

Before the first UploadSession POST, the existing durable Android Photo
intent journal commits `MAY_HAVE_SENT` and the *exact* sanitized destination
filename. The original random intent UUID, stable current Owner/Server/root/
device scope, resource and original SHA/size derive one deterministic,
nonreversible `and_` + 64 lower-hex private resume key. The key does not go
to the URL, logs, WorkData or standalone credential store.

Only incremental Android Photo originals send this key and the already
staged SHA-256 in the existing `XDriveApi.uploadFile` transport. Manual SAF
and manual one-shot Gallery upload continue unchanged. The same Go
UploadSession/chunk/finalize is reused, including CAS instant finalize and
the existing process-wide writer lease.

## Strictly read-only Go recovery

`POST /api/v1/uploads/android-photo-receipt` is a **read-only JSON lookup**
under the existing Owner JWT. It accepts only `and_` keys and the exact
parent, filename, bytes, 8-MiB chunk size, original SHA-256, fail conflict
policy and existing active/finalized session. It looks up at most two rows,
refuses ambiguity and expiry, and never creates, replays, aborts, cleans up,
renews a reservation or mutates any upload.

The ordinary `GET /uploads/:id` is NOT reused for uncertain states because
it may abort expired active sessions. The iOS `ios_` and local Push `lp2_`
namespaces remain isolated.

The Android client treats only `status=finalized` with exact current
Owner Node ID, parent, filename, revision, byte count **and exact SHA-256**
as a verified receipt. `active`, missing, stale, ambiguous, wrong Owner,
invalid response and old rows without a destination name remain blocked;
none permits a new POST. The ledger first records VERIFIED then the
existing SQLite index. Crash after ledger commit is still recoverable
without resending bytes, and verified-only compaction remains unchanged.

## Invocation and limits

After live `/me`, `/nodes/root` and `/devices/self` proof, each explicit
Gallery batch or approved periodic WorkManager batch runs the bounded
read-only check **before any new scanner/upload**. It examines at most 16
uncertain intents per attempt and stops on unresolved sessions; other
Owners' uncertain history is not inspected or cleared.

The existing 17-field encrypted intent schema remains readable. New
18-field rows optionally include the exact sanitized destination. Older
in-flight rows without this field **remain manual-review only**; no guessed
filename, local media URI or resumed unsafe POST is ever performed.

## Tests and merge gate

- Go Owner integration: legitimate/foreign JWT, wrong SHA/size/name/key,
  iOS/Push namespace rejection, active not-finalized status, exact finalized
  Node read, no duplicate session, duplicate-key conflict, expiry without
  cleanup, and private no-store responses.
- Android HTTP MockWebServer: exact POST route/body with no secret in URL,
  active/404 not success, malformed/fake finalized SHA/Node rejected, and
  exact first-instant-finalized UploadSession.
- JVM: durable per-intent key and root revision stability, lost ACK no
  replay, correct finalized read-only recovery and index compaction, wrong
  Owner/session/filename, and old journal behavior.
- Android emulator: new exact filename persisted/reopened under existing
  AES-GCM checkpoint; old 17-field records still parse and stay blocked.

**This branch requires its own exact PR HEAD Go + Android CI and Final Gate;
no tests are claimed green before running.** Installed-device Android 14
grants, actual network loss after Go finalize and 100k/115k photo library
remain **跳过（未验收）**. The lookup is fail-closed even after Go's
UploadSession TTL has expired: it never guesses the former upload result.
