# iOS sealed-intent → existing UploadSession: first integration increment

This increment joins the **previously merged** encrypted Owner/Device photo
intent journal to the normal Go UploadSession single-file writer. It is
**not yet mounted by the app UI** and must not be called before the separate
iOS device enrollment, PhotoKit Source/Root authorization, and permission
contracts have been reviewed.

## One-way state transition

For one explicitly staged local PhotoKit original and an exact current
Owner/Server/Root, `XDriveIOSJournaledOriginalUpload.uploadPrepared`:

1. Rejects an unverified/mismatched scope and performs a fresh authenticated
   /me + /nodes/root read. It is limited to the current Owner cloud root.
2. Reloads the on-device sealed ledger and requires the exact existing
   HMAC fingerprint, resource role, filename, byte length, SHA-256 and
   stable `ios_` resume key, **state=prepared** and no prior session ID.
3. Rehashes the actual staged original and checks the expected size/whole
   SHA-256 before allowing a network write.
4. Calls `ledger.beginCreate` (durable state transition) BEFORE
   `POST /api/v1/uploads`. A lost create ACK therefore cannot cause a
   process restart to silently resubmit an original as new work.
5. Checks the Server session response, then calls
   `ledger.recordSession` BEFORE the first `PUT /chunks/{index}`.
6. Compares each 8 MiB original chunk with its expected SHA-256, reuses
   Server-reported chunks only after exact verification, and records
   `ledger.beginFinalize` before `POST /finalize`. An instant
   owner-CAS reuse also passes through this checkpoint.
7. Requires a verified Server file/Node/revision receipt, then persists
   `ledger.confirmReceipt` before returning success to a caller.

If a request, journal write or Server receipt fails, the code never
replays the write automatically. A journal state which might have
submitted a POST or PUT becomes `needsReconciliation`; only a
never-submitted `prepared` state remains safe to retry after source
revalidation. Such records require the read-only Owner/HMAC recovery
work in #3075/#3076 and must be checked under the same verified Owner
before any further write.

The old `uploadOnce` function for foreground manually selected Files
remains unchanged in behavior and continues to generate its own
one-shot `iosmanual_` key. Its lack of post-crash recovery is disclosed
in the manual uploader UI; the new journal mode never substitutes
its key or marks manual uploads as PhotoKit backup.

## Still absent

- A Server-verified iOS Device/Root photo-source capability, per-resource
  PhotoAsset/PhotoResource identity and authoritative Live still+motion pair
  commit. `/me` and `/nodes/root` are necessary but not sufficient.
- User consent for Photos/iCloud original export, iOS app-owned staging
  lifetime, a durable candidate queue, cross-restart Source scan, automatic
  scheduling or background uploads.
- End-to-end Server ACK-loss/expired-session/revocation tests that
  exercise the full native runner and read-only recovery path.

This is deliberately an **internal integration boundary**, not a claim
that a PhotoKit image is backed up after either native login or merely
being found in the local album.

Exact-head iOS Xcode device compilation and required CI are needed before
merging. Real iPhone, iCloud and production environment acceptance are
**跳过（未验收）** until observed; source security assertions cannot be
weakened on that basis.
