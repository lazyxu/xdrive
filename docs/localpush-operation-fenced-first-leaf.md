# L03-G0-c2c3b1 — operation-fenced private first-leaf CAS/SQL writer

**Parent:** The accepted #2023 c2c3a SQL precommit fence merged as
`e8c9bebe382974b76d99cbbef32bc12b4015c195` after complete
[76-job exact-head CI #39093873189](https://github.com/lazyxu/xdrive/actions/runs/39093873189):
25 success, 51 conditional skipped, 0 failures, final-gate green.
The former branch was confirmed absent.

## Narrow new work

Introduce only the private `commitBoundLocalPushFirstLeafWithCurrentOperation`
entry which requires the exact 32-byte original Agent request key, latest
operation UUID/generation and existing authenticated owning-device/Root/Source
proof. The caller can neither switch to arbitrary storage nor expose this
entry via the normal Router, Go Client, Agent IPC, Electron or Web.

Within the **one original SQL transaction** and pinned physical
CAS/Stage read window, after the User quota lock and **before** any
Stage/CAS/Node locks, check the c2c3a `validateCurrentLocalPushWriterFenceTx`.
Recheck it again **after canonical private File/Node/SourceItem/QuotaHold
changes, immediately before SQL COMMIT**, on the identical held transaction
and operation UPDATE lock. It rejects unreserved, expired, aborted, terminal,
revoked, wrong-device, wrong Root, stale generation, wrong-key or changed
Owner/Source scope. A denied or elapsed operation rolls back private SQL
changes; no partial successful SourceItem or CAS metadata is published.

The original first-leaf writer and test-only HTTP route remain
**CI-only, no production caller** for their previous regression contract;
only the new private entry carries current-operation authority. Do not
route the legacy entry or reinterpret its PENDING receipt as a backup.
Existing real local-store pinned-hash checks and conservative post-COMMIT
physical drift handling remain unchanged.

## Tests and evidence

Add isolated PostgreSQL + real local CAS byte fixtures for exact current
generation commit/replay, changed key/UUID/generation, expiry, abort,
revocation, foreign Owner/Root, terminal contradiction and canceled
context; verify 0 SourceRun and still-PENDING SourceItem. An inspector-only
test exercises expiry between initial approval and final precommit check,
with no durable SourceItem. The Desktop Node source contract rejects
accidental Renderer/Agent/normal Router exposure.

This is **not** real owning native CURRENT-handle/canonical-File writer
cross-system attestation, durable cancellation, operation completion,
key retirement, SourceRun, watcher, schedule, manual start, bulk
multi-file planner, NAS Push or Mirror deletion. `local_folder` remains
paused / Run hard-denied. Web, Mobile Web, PWA and foreign Desktop remain
observer-only. Stage remains <=64 MiB, physical installed Windows/Linux
100k-file and >=4 GiB tests are NOT claimed.

Next c2c3b2: join the owning Agent's authenticated held original/native
identity witness, current operation and the gated SQL/CAS writer without
inventing a remote control route. Next c2c3c: prove durable physical
commit/cancel exclusion, crash/lost-ACK replay and strict SecretStore
key-retirement safety before any real Local Push Runner activation.

**Delivery gate:** exactly ONE scoped work commit on frozen master;
NEW exact-head full GitHub 76-job CI including Go/PostgreSQL API Race,
Windows/Linux, Web/Desktop, Rootless, artifacts, single-commit and
final-gate; GitHub clean Ready/Rebase then verify branch deletion.
Do not claim local Go/PostgreSQL, GitLab or physical acceptance absent evidence.
