# Native iOS PhotoKit snapshot scan: bounded first-pass candidates

This deliberately supplies only the **local read-only scan side** of a
future incremental PhotoKit backup, not an automatic source, a persistence
checkpoint, a new Server writer, or a verified second sync.

The native PhotoKit diagnostics view offers an explicit
**预览全库有界扫描（每批最多 64 项）** action after Full or Limited
Photos permission is already granted. It opens a separate, cancellable
preview. It never prompts for new Photos access or begins a backup.

## Memory, privacy and consistency

- `XDrivePhotoKitBoundedSnapshotScanner` retains one lazy
  `PHFetchResult<PHAsset>`, not a Swift array of 100k+ photos.
- The scan returns at most **64** metadata candidates per explicit
  Next action; the UI retains only the most recent page. It reads
  transient PhotoKit local identifiers, kind, Live flag, creation and
  modification dates in memory only. No original bytes, GPS, thumbnail,
  cloud data, network access or permanent photo identifier are read.
- The PhotoKit change observer is registered **before** the initial
  fetch; even an unrelated library change invalidates the scan.
  The same Full/Limited permission and change generation are checked
  both before and after each page, before cursor advancement.
- A cancelled page is never advanced, and the old snapshot is
  discarded on a permission change, app background or preview dismissal.
  If a photo is inserted/deleted/edited, restart the scan rather than
  interpreting an old index as an asset identity.
- Limited Photos permission only exposes the user-authorized subset,
  never a reliable count of all Photos on the device. Exact 100k latency
  and iCloud consistency still require real device evidence.
- PhotoKit may deliver notification asynchronously. A bound local
  snapshot is therefore **not** an authoritative server checkpoint:
  every original must still be re-resolved, content-hashed, Owner
  verified and checked against the encrypted intent ledger before
  a real upload.

## Remaining backup functionality

1. A genuinely registered, unrevoked iOS Device + photo-only Root
   permission, not a Desktop local_folder Agent token.
2. A source scan/diff index with durable Owner/Device scope,
   revision evidence and bounded modified/removed-asset handling.
   No Mirror delete on first pass or changed permission.
3. PhotoKit original-byte export only on user-approved work, paired
   Live still/motion with trusted server resource identities.
4. Stable sealed journal and existing UploadSession writer, plus exact
   read-only HMAC ACK-loss reconciliation and Server physical receipts.
5. Reliable restart and second no-change scan on a real iPhone with
   100k test media, Wi-Fi/cellular switches, revoked Photos/Owner
   permission and memory-pressure sampling.

This PR touches only iOS PhotoKit scan/preview files and one explicit
navigation button in the existing native diagnostics panel. Existing
PWA Files/Gallery/Viewer, user/manual photo upload, Server, Android,
Desktop and CI workflow code remain untouched. Physical iPhone,
iCloud and 100k acceptance remain **跳过（未验收）**.
