# Android native photo backup: encrypted intent / uncertain ACK foundation

Date: 2026-10-30. Independent **Android-only** development stage.

## Why this is separate from existing Android SAF transfers

The Android Compose application already has foreground SAF -> Go
UploadSession/CAS with an encrypted recovery marker for manual document
uploads. That marker deliberately records only interrupted manual uploads.
It is **not** an automatic Photos inventory, a durable photo sync queue or
a Server-original receipt index. We preserve it unchanged.

This branch adds **new, isolated metadata-only native Photo backup intent
contracts and tests**. It does **not** start a second uploader or authorize
WorkManager, Android MediaStore background access, media writes or Server
CAS operation.

## Model and integrity barriers

- `NativePhotoBackupOwner` requires a canonical HTTPS origin, a nonempty
  real Server installation identity from authenticated `/me`, positive
  Owner ID, username, authenticated Root Node ID + revision, and a distinct
  verified device identity. These values must be obtained by a future native
  Owner verifier; the current Android login username alone is not proof.
- `assetKey` and `versionKey` must be keyed SHA-256 digests computed by
  a future **native** inventory stage. No raw MediaStore ID, URI, path,
  album title or local thumbnail is stored.
- `plan` admits only a staged resource with exact original SHA-256 and
  byte count. For the same Owner/resource/version a different hash or size
  is a safety failure, not silently overwritten metadata.
- `beginAttempt` requires a freshly authorized, re-hashed exact source.
  It commits `MAY_HAVE_SENT` to Android Keystore AES-GCM storage before
  allowing a single existing Go UploadSession call. The phase after a
  crash is **unconfirmed**; it is never automatically replayable.
- `markUnknownAck` preserves uncertainty following cancellation, timeout
  or lost create/finalize ACK. Only `acknowledgeVerified` can transition
  to `VERIFIED`, and only with a real current-Owner Go finalize or exact
  authorized GET matching resource SHA-256, byte count, Node ID/revision.
  The pure state machine cannot itself verify the network source of a
  caller-supplied receipt; that must be enforced at transport integration.
- Full journal unreadability, Android Keystore loss, invalid/tampered
  ciphertext, duplicate source keys, Owner mismatch or invalid transitions
  fail closed. Encrypted SharedPreferences changes use synchronous
  `commit()`, not `apply()`.
- A strict **128-intent cap** avoids unbounded local metadata and never
  drops potentially unconfirmed work. Verified entries remain until a
  separately validated long-term dedup index is available.

## Not yet implemented — never claim automatic backup works

1. Native `/me` and `/nodes/root` Owner verifier with device registration
   proof, including A -> B -> A and server-instance replacement.
2. Android MediaStore/Photo Picker original exporter and HMAC fingerprint
   under Full/Limited/Selected Photo permissions, including Motion paired
   resources, revision detection and private bounded staging.
3. Approved global writer exclusion shared with manual SAF, consent
   control, exact Go UploadSession integration, read-only recovery lookup,
   unconfirmed response handling and 100k+ long-term dedup.
4. WorkManager/foreground notification/OS background policies, power
   management, logout/server-switch safety and real on-device
   scheduled incremental proof. No force-stop/background promise.
5. Actual Android instrumentation, MediaStore 100k/115k, provider denial,
   lost ACK, crash and upgrade acceptance: **跳过（未验收）**.

## Testing and merge gate

- `./gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`
- Emulator/physical: `./gradlew --no-daemon :app:connectedDebugAndroidTest`
  including `AndroidPhotoBackupIntentStoreTest`.
- JVM `NativePhotoBackupLedgerTest` covers no-replay, failure to durably
  checkpoint, precise resource/Owner match, duplicate version, strict
  capacity and corrupt/unreadable journal.
- Must pass applicable PR exact-HEAD CI/Final Gate before master merge.
  Preserve independently running green Android navigation PR #3292.
