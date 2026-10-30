# Android local Gallery → foreground single-original confirmation

**Draft integration child** of #3319 and #3304. This does not modify either
parent branch, overwrite a photo, schedule background work or claim a release.

An explicitly viewed local photo/video now provides a "备份这一项原件" action.
The Viewer unmounts before showing a separate, Owner-session-scoped consent
dialog. Only the tapped MediaStore ID is inspected; complete Photos+Videos
permission, canonical content URI, exact size/type and provider freshness
are required. The original DISPLAY_NAME is offered only if it meets existing
Server-compatible filename validation; otherwise the user must enter a name.

Confirmation is strictly opt-in and uploads **one** original to the verified
Owner root through the existing DriveController → XDriveService.uploadFile →
Go UploadSession writer. Conflict policy stays fail; no rename overwrite or
synthetic backed-up label, and a lost ACK never automatically retries.
Logout, switching Owner, leaving local Gallery or cancelling the dialog
discards the memory-only selected URI/metadata.

A pure JVM policy test protects Owner/session, Gallery, grant, verified source,
concurrent transfer and filename eligibility. Actual Android MediaStore
permission, foreground acknowledgement, lost-ACK and physical performance
still require exact-head CI/emulator/device acceptance.

Remaining MVP: user-approved whole-library incremental scheduling and durable
device credential lifecycle; this PR implements only the visible **single**
original entrypoint.
