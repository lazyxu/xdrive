# Android P0 transfer durability: encrypted recovery ledger (2026-10-28)

Independent stage for native durable transfers, deliberately separate from
Gallery map PR #2951 and system inbound Share PR #2957.

The existing SAF upload/download is foreground-only and the session-scoped
NativeTransferCenter displays only current-process entries. This stage will
implement an Android Keystore-sealed, bounded journal recording only an Owner
identity and operation class, **never** file names, raw source URLs, tokens,
private bytes, SAF URI grants, passwords, or speculative resume offsets.

On process death, a previously-started upload is **RESULT UNCONFIRMED**
until its current Owner checks the actual destination. A partial download is
**INCOMPLETE**, not falsely saved. These records must never be auto-replayed.

A subsequent integration stage will bind this journal to the existing
single-writer UploadSession and approved WorkManager/notification/OS permissions.
Do not claim background retry or pause/resume until that integration is real,
Owner authorization is verified across restarts, and source persistence/ACK
replay has durable evidence.

Technical and Android Keystore tests must be green at exact HEAD before merge.
Real installed-device crash/rotation/permission acceptance remains 跳过（未验收）.
