# iOS: explicit one-still PhotoKit original → Owner file upload

This increment uses components already present on `master`:

- A native login with short-lived in-memory Bearer, Server-installation /
  numeric Owner / cloud-root verification, and a separate PWA Cookie session.
- Read-only PhotoKit metadata, original-resource type inspection, and a
  bounded user-requested original exporter with complete file protection.
- The existing ordinary Go UploadSession/chunk/finalize/CAS transport.

It adds **only** an explicit, foreground, one-image-at-a-time action in the
native diagnostic Photos sheet. It is **not an automatic camera roll backup**.

## User journey

1. In the native account diagnostic screen, log in and press **验证 Owner
   与云端根目录（只读）**. Without that identity, the Photos panel only
   displays its local inventory and has no upload action.
2. Open **系统相册识别与单张照片手动上传**. The panel does not prompt
   for Photos permission until the user requests local inspection.
3. Under one **ordinary non-Live still image** (not a video), tap
   **手动保存这张普通照片到云端**. The user may first opt in to fetching
   an iCloud-evicted original. By default no iCloud original download
   is permitted.
4. Recheck the selected PhotoKit resource in the current Full/Limited
   grant and the exact authenticated Server Owner + root.
5. Stage at most 128 MiB of that still original under private complete
   iOS file protection; never turn its originalFilename into a local
   path. Revalidate Photos permissions and Owner identity after export.
6. Call the **same** ordinary UploadSession/8 MiB chunk/finalize API
   used by native Files manual upload. Only show Server-confirmed file
   Node/revision after the correct authenticated final receipt.
7. Always discard the app-private original on all exits. Cancellation
   leaves a conservative unknown-commit warning when the Server may
   have persisted data after a lost ACK.

## Explicit exclusions and safety

- **Live Photo and video:** this action refuses them *before* any original
  export. Uploading only a still frame is not a valid paired Live backup.
- This stores a **regular cloud file**, not an authoritative PhotoAsset /
  PhotoResource pair, Device backup record or SourceRun checkpoint.
- No automatic scanning, mirror deletion, background scheduling,
  original EXIF/GPS-to-Server metadata API, photo ID persistence,
  per-asset sync ledger, native/PWA session fusion or automatic retry.
- The older manual `iosmanual_` one-shot upload key applies: if the
  create/finalize ACK is lost, no safe automatic replay is attempted.
  The separate encrypted Owner/Device ledger + HMAC resume-key protocol
  is for the later trusted incremental runner and must not be falsely
  claimed here.
- An unchanged filename may already exist in the Owner root. The Server's
  existing fail-only conflict policy stays authoritative; the app does
  **not** silently overwrite or rename the cloud target.
- Real iPhone Photos Full/Limited changes, iCloud original byte
  downloads, certificate trust, Server 409/503/ACK-loss, cancellation,
  and 128MiB boundary remain **跳过（未验收）** until physically
  exercised. This never waives source security and CI checks.

## Remaining path to true first automatic Photos backup

A registered, Server-verified, photo-only iOS Device/Root and stable
resource revision must be bound before the first Server write. The
encrypted journal must be prepared with the original resource's digest
and resume key, and the Owner runner must reconcile uncertain ACK after
process death. A Live Photo must require both real resource receipts
and a single authoritative PhotoAsset pair commit. Then implement the
bounded changed-asset scan and user-controlled foreground incremental
queue; iOS background execution is a separate capability.
