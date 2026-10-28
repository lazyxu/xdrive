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
