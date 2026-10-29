# iOS Photos → xDrive cloud Files: foreground backup MVP

**Goal:** make the current iPhone build capable of a real user-triggered
first-and-second pass for ordinary still photos, using **the existing Owner
Files permission and Go UploadSession/CAS**. This is intentionally a small
scope, not the entire native Device Source/Root or background PhotoAsset
synchronization product.

## User journey

1. Open the xDrive native login diagnostics in the iOS app (the normal
   Files/Gallery/Viewer PWA remains the canonical UI), sign in using a
   system-trusted HTTPS Server and tap **验证 Owner 与云端根目录（只读）**.
2. Tap **备份 iOS 相册原件（前台 MVP）**.
3. Explicitly grant iOS Photos Full or Limited read access. Optionally
   enable **允许从 iCloud 下载当前照片原件** (OFF by default).
4. Tap **开始本轮照片备份**. While the app is foregrounded, it scans
   at most **256 recent authorized assets** in lazy pages of 64; it
   uploads at most **20 new ordinary still-image originals** per run.
5. For each still image, stage at most **128 MiB** of the authorized original
   in an app-private protected temporary directory; never upload a
   thumbnail in lieu of the original.
6. Reverify Owner/Server/root, hash the staged file in 8 MiB reads, and
   prepare a sealed Owner/root+local-app-profile ledger intent. The
   destination is an Owner-root **normal cloud file** with a stable
   HMAC-scoped, privacy-preserving suffix and 12 hex bytes of the source
   SHA-256. Multiple IMG_0001 photos do not silently overwrite each
   other or leak raw PhotoKit localIdentifier in filenames.
7. The **existing** journaled Go UploadSession/chunks/finalize transfer
   advances persistent creating/uploading/finalizing checkpoints before
   side effects. Only the true finalized receipt plus current Owner Node
   metadata readback may mark this resource confirmed. Staged original
   bytes are deleted on any exit.
8. On a second user-initiated pass, a matching sealed journal record
   must pass a fresh authenticated Owner Node id/revision/size/hash
   readback before counting the photo as **已核验跳过**. It does
   **not** reupload an already confirmed original.
9. If a server ACK is lost or a prior confirmed file has changed or
   disappeared, stop the current run at **需人工核对**, without
   assuming a missing response equals a failed write. App close,
   background and explicit cancel end this foreground operation; no
   fake background success.
10. The UI shows independent **新增保存、核验跳过、Live 未支持、
    视频未支持、原件不可用、需人工核对** counters, and says
    whether the iOS Photos authorization is Limited.

This is an actual **file backup of original ordinary still photos**. The
files are accessible from the canonical PWA cloud File Explorer. It
is NOT an authoritative Server PhotoAsset/PhotoResource paired backup,
and it does not create an xDrive Device local_folder SourceRun.

## Why a local app profile is acceptable here

The first MVP writes only under the currently **Owner-authenticated cloud
root** through the same Owner JWT/ACL and UploadSession as manual file
upload. It does not use Device/Root Agent headers or claim privileged
local_folder Source permissions. A separate ThisDeviceOnly Keychain
random secret creates a persistent local journal namespace UUID and
HMAC-tagged per-asset filename. This UUID is used **only on-device to
isolate the encrypted intent ledger**, and is never sent as a registered
Server Device ID, used for Source mutation, or claimed as permission.
It remains stable across app launches and separate across Owner/
Server install scopes. Future Server-registered iPhone photo-only Device/
Root backup will use the separate verified API #3071/#3072 and migrate
only after an explicit reviewed compatibility plan; it must not silently
reuse this Owner Files-only profile for privileged Source operations.

## Explicit MVP limits

- No Live Photo still-only fallback: a Live asset is **not backed up**
  until an authoritative paired still+motion Server receipt is available.
- Videos and nonimage assets are not backed up in this first milestone.
- Only the most recent **256** visible assets are examined per button
  press and at most **20** ordinary still originals are newly uploaded
  per press. Run again for the next unconfirmed photos *within this
  range*; older assets and any library larger than the current 1024
  journal record cap need a follow-up sharded manifest and paging UX.
- A source modification creates a new content hash/name; no automatic
  deletion, remote replacement, Merge or mirrored removal. A tampered
  or unreadable ledger fails closed and is not replaced.
- No background upload, Photos change scheduling, multi-device merge,
  photo album membership/metadata mirror, SourceRun, real iPhone
  portability claim, automatic iCloud download or backup of photos
  outside the iOS granted subset.
- User must use the **native login** (not the separate PWA Cookie).
  The iOS App's main File Explorer and Gallery remain the shared
  React/MUI PWA.

## Verification matrix

| Case | Required expected result |
| --- | --- |
| First ordinary HEIC/JPEG, Owner trusted | One verified cloud file/Node receipt |
| Second scan, unchanged original | Re-hash + Owner Node readback → verified skip, no new UploadSession |
| Two distinct photos named IMG_0001 | Distinct keyed destination filenames, no overwrite |
| Live Photo or video | Explicit unsupported count, no half-pair success |
| Limited Photos access | Only selected subset scanned; no claim of total-device coverage |
| Revoke Photos or Owner | Stop, no further writes or made-up success |
| iCloud-only with download OFF | Skip as unavailable, no thumbnail substitute |
| Lost create/finalize ACK | Persistent unresolved intent, never blind write replay |
| Cancel, background, account switch | Cancel current request and remove private staging |
| 100k+ assets | Bounded 64-row scanning; no claim of whole-library coverage |

Required first: exact-HEAD `iOS Native Unsigned IPA` Xcode compile and
all applicable source/security checks. Physical iPhone/SideStore,
trusted LAN HTTPS, iCloud originals, second-pass against real CAS,
crash/ACK-loss, performance and 100k coverage are
**跳过（未验收）** until performed. No unavailable production test is
allowed to become an unrelated source merge gate, but no CI failure
may be mislabeled as a pass.

Next priority after this MVP: add foreground videos; implement
authoritative Live still+motion pairing; replace 1024-entry journal
with safe sharded 100k manifest; support existing Owner File root
selection and verified iOS Device photo-only Source contract; only
then enable user-approved automatic background scheduling.
