# iOS Photos backup: read-only recovery of an uncertain original

An app termination or network ACK loss may leave the encrypted
Owner/installation-scoped photo backup ledger in `creating`,
`uploading`, `finalizing` or `needsReconciliation`. Those states must
**not** be interpreted as permission to issue a second create POST.

`XDriveIOSPhotoBackupUncertainReceiptRecovery.reconcile(operationID:)`
adds an internal, user-invoked recovery primitive:

1. Revalidate exact HTTPS Server origin, persistent installation ID,
   numeric Owner, cloud root and local journal namespace, then read the
   original protected ledger entry.
2. Persist `needsReconciliation` for any incomplete write-stage state.
   Do not act on an already `prepared` or `confirmed` entry.
3. Query the current authenticated Owner's **exact existing**
   UploadSession through #3075's HMAC `/api/v1/uploads/resume-lookup`
   and the merged read-only native response verifier (#3076).
4. A 404, 409 or 410 remains **unconfirmed**; no automatic new upload
   key, no silent delete and no CAS write. An active Session's chunk
   list is never treated as a byte-level completion proof.
5. If a Server session is found, persist its UUID through the existing
   `XDrivePhotoSyncLedger.recordObservedSession` actor method
   (merged #3090), **keeping the status needsReconciliation**.
6. Only a finalized exact Session ID/expected file digest together with
   an independently authenticated `GET /nodes/:id` matching Parent,
   file type/name, size, revision and full SHA-256 can transition the
   original ledger entry to `confirmed`.

The raw PhotoKit localIdentifier, source GPS, native access token,
download bytes and iOS Keychain credential are never written to logs,
URLs, Web/PWA JavaScript or Server metadata. This component does not
run any UploadSession PUT/chunks/finalize or schedule work.

## Remaining MVP wiring

This helper is new and **does not automatically run on app startup or
background**. The user-visible foreground backup MVP #3097 currently
stops and reports an uncertain file, not a false success. Once the
Server #3075 read-only route passes its Go security checks and merges,
the foreground backup UI can call this helper on the selected pending
record, refresh the visible counters, and permit another authorized
scan only after genuine file receipts exist. A 404 must never
automatically reset the sealed key.

A true Device SourceRun/PhotoAsset and Live still/motion pair are
separate future capabilities, not represented by a single file
receipt. Real iPhone, Server ACK-loss/revocation, CAS physical read,
iCloud 128 MiB boundary and restart/second-scan acceptance are
**跳过（未验收）** until measured. Source and owner security checks
remain mandatory.
