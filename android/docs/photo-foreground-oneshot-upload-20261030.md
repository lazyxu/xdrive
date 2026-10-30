# Android foreground one-original UploadSession integration

Status: stacked **Draft** on original-source preflight PR #3300.
This is neither a released APK nor automatic backup nor Motion Photo playback.

- Adds caller-only foreground DriveController.backupNativePhotoOriginalForeground. No Gallery button/scheduler is connected until native Gallery parent #3292/#3304 is independently validated.
- Requires active Gallery/Owner session, HTTPS, full photo AND video MediaStore grants, exact canonical content URI, genuine bounded original, valid user-provided destination name and no other active transfer.
- Verifies Server installation ID, Owner and current root through existing authenticated /me and /nodes/root, stages one original in disposable private storage and rehashes it before writing.
- Uses only existing XDriveService.uploadFile, Go UploadSession/CAS/finalize, and the shared transfer recovery/checkpoint; conflict policy remains fail.
- Validates exact root id/revision and final Node ACK, never retries an uncertain upload or constructs a synthetic successful cloud/photo state.
- Four JVM regressions exercise the real uploader boundary: one attempt/content, Owner/Root denial, tamper/forged receipt, and lost ACK no replay.

Still required: native explicit consent/selection UI; Android device identity registration; bounded whole-library completed index, durable receipt reconciliation, automatic incremental schedule, Motion Photo pair semantics and real Android permission/restart/large-library validation. No final APK or CI success claimed.
