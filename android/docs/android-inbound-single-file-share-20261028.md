# Android inbound single-file system Share intent · P0 native convenience

This is a separate parallel workstream from the BD09 map/Viewer PR #2951.
Implementation will use the existing Owner-scoped SAF/upload session path,
not another uploader, owner permission or write protocol.

Security contract:
- Accept only system ACTION_SEND with one content:// URI and an actual
  FLAG_GRANT_READ_URI_PERMISSION, not file/http schemes or ACTION_SEND_MULTIPLE.
- The received Intent is untrusted metadata, never immediate authority.
  No automatic upload, disk/URI persistence, new storage permission or
  resumable/background claim. Explicit confirmation only once authenticated
  Files/Browse has a verified Owner folder. The Controller freezes the
  selected current folder before accepting any source bytes.
- Query provider DISPLAY_NAME and SIZE on demand. Refuse absent/unknown size
  and invalid Windows-compatible filenames rather than guessing a length,
  loading entire contents into RAM, or replacing unconfirmed uploads.
- Cancel, logout, account/server/folder change and revoked URI grants must
  never start a stale Owner upload. Use only the established single-attempt
  UploadSession/chunks/finalize and uncertainty handling.
- ACTION_SEND onNewIntent and cold entry should be safe and nonpersistent.
  No process-death replay.
- Tests: genuine Android Intent/URI scheme preflight, permission gate, metadata
  size/name filtering, single user-confirm path and no unsolicited network
  mutation. Physical foreign-provider/installed APK remains 跳过（未验收）.

Until this PR's exact HEAD CI is green, source acceptance remains pending.

## 2026-10-28 implementation

In addition to the original SAF OpenDocument button, Android now accepts one
`ACTION_SEND` from an external application through the existing MainActivity.
The Activity is `singleTop` to handle subsequent shares without constructing
a second uploader. No action is taken for `ACTION_SEND_MULTIPLE`, missing
read-grant, untrusted `file://`/https URLs, bad ClipData or text-only extras.

The URI stays only in Activity memory. If login or Files/Browse navigation is
pending, an unobtrusive bottom notice explains the next step; no upload occurs
until a real verified Owner directory is in view and the user clicks
**确认上传**. The app reads only provider DISPLAY_NAME/SIZE metadata first,
asynchronously on IO, rejecting absent/unknown/unsafe values; source bytes are
opened once by the existing `DriveController.acceptFileUpload` closure, after
`prepareFileUpload` locks the Owner parent folder. Folder/account is
revalidated after the provider query and again before creating UploadSession.
An interrupted/ambiguous upload uses the Controller's established conservative
no-auto-replay state. No on-disk URI, permission persistence, credentials, RAM
buffering, WorkManager claim or new write protocol is introduced.

Tests: Android framework ACTION_SEND grant/scheme/ClipData cases; exact
metadata bounds and file names; Owner/Folder preflight. The real foreign
provider and installed-device flow remain **跳过（未验收）**.
