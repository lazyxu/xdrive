# iOS PhotoKit bounded original-resource staging

This native-only source adapter is **not** a backup button or an automatic sync
engine. It provides the file bytes needed by a future Owner-bound native
UploadSession call; there is no new upload writer or Server API.

## Explicit input and limits

- The caller supplies one fresh PhotoKit `localIdentifier` **only in memory**.
  Photos permission must be `authorized` or `limited`; items outside the
  allowed subset are rejected, not silently skipped as synced.
- No export occurs automatically at app startup, first sign-in or background
  refresh. An eventual UI must require an explicit user action and must offer
  an opt-in for iCloud network downloads.
- PhotoKit `PHAssetResourceManager.requestData` delivers byte chunks to an
  app-owned private temporary file. The file is written progressively, not as
  a full photo/video in RAM. The request is cancellable by PhotoKit request ID.
- Each resource has a bounded maximum of 1 GiB by default; larger source
  assets fail rather than consume unbounded storage. The caller may provide
  another explicit safe cap up to 4 GiB.
- Temp directories are 0700 and files are 0600 with complete iOS file
  protection. A PhotoKit original filename is **never** used as a disk path.
- Live Photo requires both still and `pairedVideo`/`fullSizePairedVideo`
  resources. If either is unavailable, or if the second byte stream fails,
  all temporary data is deleted and nothing is returned as a complete Live.
- Photos authorization and visibility are rechecked before and after staging.
  Temporary files are removed on any failure or task cancellation.

The staged bytes correspond to the selected PhotoKit advertised full-size
resource. This still does **not** establish whether the source is the original
unedited file or an edited variant, nor whether it is a correct server-side
PhotoAsset/PhotoResource pair. Preserve resource roles and revision identity
when adding durable syncing.

## Caller obligations before actual sync

1. Present a real user-owned photo/album selection and explicit option to
   permit iCloud downloads; do not call staging from rendering or login.
2. Revalidate the current authenticated Server Owner, Device, Root, local
   asset/resource revision and upload destination. Store an Owner-scoped
   resume record before sending bytes.
3. Transfer each staged file through the existing xDrive UploadSession
   protocol and separately commit Live Photo pairing/metadata only after
   both physical resource receipts are verified. Do not equate two independent
   file uploads with an atomic PhotoAsset pairing.
4. Remove each staged private original on completion, cancel, logout,
   account switch, background exit and all failure/unknown outcomes.
5. Test limited permission, mid-export permission revocation, iCloud evicted
   originals, a >1 GiB video, 100k library and Live paired failures on real
   hardware. These physical checks are **跳过（未验收）** until completed.

No automatic sync, retry, PhotoAsset database write or remote deletion exists
in this change.
