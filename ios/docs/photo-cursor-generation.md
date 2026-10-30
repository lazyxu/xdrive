# iOS PhotoKit durable automatic-scan cursor: generation fence

This feature was consolidated into one validation branch with **both**
foreground and native BGProcessingTask PhotoKit generation fences.
The previous immutable #3234 commit is retained as a merge parent rather
than rewriting its already-executed Places-only CI result. The shared
React/MUI Photos Settings and Go UploadSession/CAS Owner receipt code remain
unchanged.

## Why an ordinary integer offset is unsafe

The native foreground auto scheduler persists a 256-asset window index.
PHFetchResult sorts by creation date; after the app has closed, a deletion,
insert, metadata change or alteration of Full/Limited Photos access may shift
those positions. Continuing at the old index can skip an asset without ever
attempting its authenticated original upload. The existing PHChange observer
only protects a *currently live* scan.

## V1-compatible fail-closed generation fence

- Keep the current per-Server/Owner/Root UserDefaults state key. New optional
  `libraryChangeEpoch` and `libraryAuthorizationRaw` fields decode old
  JSON without migration; an old nonzero cursor with no epoch resets to zero.
- The foreground store and the independently Owner/grant-scoped
  BGProcessingTask window store share **one** native
  `XDriveIOSPhotoKitLibraryEpoch` helper. BG reservation happens only
  after the approved Device/Root grant is re-proved to the Server and
  local protected data is readable; the persistent PhotoKit token is
  checked before reusing any background scan offset.
- On a *due* foreground or system background tick, read Apple's iOS 16+
  `PHPhotoLibrary.currentChangeToken` and record an NSSecureCoding archive
  **inside that Owner's local schedule state**, never on Web or Server.
  Confirm Photos read authorization before and after the native PhotoKit read.
- Compare the saved and current `PHPersistentChangeToken` objects with
  `isEqual` after secure unarchiving. Comparing serialized archive bytes
  would be unreliable, as encoding formats may vary. Change of token,
  missing/corrupt previous token or Full/Limited authorization scope resets
  the positional scan to window zero before the next PhotoKit fetch.
- After an actual foreground **or background** run, compare the
  *pre-run saved token* with the new library token **again**. If PhotoKit changed during the run, discard only the
  positional checkpoint and restart next interval from window zero. Existing
  verified Owner Nodes and unknown-ACK encrypted intents are not deleted.
- State mutation, epoch and next-due time are persisted atomically as one
  JSON value per Owner. No raw PhotoKit asset IDs, GPS, filenames, PWA bearer
  or Device Grant are recorded.
- A token archive/decode failure never authorizes reuse of the prior cursor.

## Tests, boundaries and scope

The Swift Foundation-only generation policy test covers old missing tokens,
unchanged scope, limited/full permission changes, invalid offset and 100k
synthetic window indices. Node contracts check shared secure token coding,
foreground and BG reservation and their post-run fences, explicitly
avoiding plaintext PhotoKit asset IDs, Owner bearers or Device grant secrets. The iOS unsigned IPA
workflow compiles/runs the pure test and checks the full app with iPhoneOS SDK.

This prevents **stale-index reuse when PhotoKit's persistent token reports a
change**; it is not a keyset pagination implementation, complete change-log
replay or proof of 100k incremental throughput. Frequent library mutations
can conservatively restart the sweep repeatedly; long-lived stable cursor
with true insertion/update/delete enumeration remains further work.
Real iPhone/SideStore, iCloud, lock-screen, 100k end-to-end acceptance:
**跳过（未验收）** and do not confuse it with GitHub CI checks.

Apple reference: https://developer.apple.com/documentation/photos/phphotolibrary/currentchangetoken
