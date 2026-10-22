# G2c2d2b3c4f — pin original Stage hint during real first-file COMMIT

The owning Agent previously pinned the original Stage recovery-hint descriptor through
`Reconcile` (#2367), but its **real** original first-file `Commit` still
retained only the original media file descriptor and same live OS Writer Claim
through authenticated HTTP CAS/SQL. During that network window a replaced or
rewritten private Stage hint could escape a pinned-descriptor comparison.

This increment uses `localpushstage.WithHeldLocalOriginalRecoveryHint` as the
**outermost** owning-Agent `Commit` window. Before the HTTP callback it
compares the exact original Source, revision, Stage UUID, current snapshot,
path key, content SHA, size and relative file path. While its original Stage
hint descriptor remains open, the existing native original fd is held and
post-hashed, and the original live Writer Claim remains locked across the
same authenticated `CommitLocalPushFirstLeafWithOperation` request.
Afterward the existing pinned hint callback rechecks the same inode, private
parent path, permissions, mtime, bytes and bound Root. A lost HTTP reply,
in-place edit, identical-content inode/path replacement, cancellation or
post-hash failure remains uncertain. Never retry or mint a new Stage/key.

Source-level Go regression exercises the actual first-file production call
chain, successful original persisted Stage, missing/corrupt/wrong Stage, wrong
device, revoked Root, cancellation, in-place changes and same-content file
replacement. No public API, renderer or Web mutation, Server terminal INSERT,
Native Witness deserialization or schema changes.

**This does not supply independent remote OS kernel-lock attestation or make a
Server physical file-terminal decision.** Existing Agent-local HMAC is still
correlation only. Real Agent→Server trusted proof, production physical-COMMIT,
quiesced CANCEL, lost-ACK/process replay, Stage/Key/Writer retirement, file #2,
SourceRun and scheduler are subsequent reviewed work. Keep `backup_complete=false`
and `retirement_safe=false`. Inaccessible production safety acceptance remains
**按用户决定跳过（未验收）**; code-level Owner/Device/Root/native/SQL/CAS tests,
Windows/Linux builds and exact-head full CI/Final Gate are mandatory.
