# G2c2d2b3c2b2c — one durable Stage/Operation slot builder

## Already active
The merged owning Windows/Linux Desktop manual Backup-only first-file <=64 MiB real HTTP Stage→CAS/SQL upload (#2212) remains enabled and one-shot. Agent job monitoring (#2257/#2264) and restart quarantine (#2300/#2304) are already in master. A persisted original Native Writer, Stage, or Operation claim must not appear absent after Agent restart just because two separately copied hash/name algorithms diverged after an upgrade.

## Scoped implementation
The existing original Operation request-key naming logic is factored into an INTERNAL pure `localPushStableClaimSlots`. The actual Stage O_EXCL creator, original Operation O_EXCL + SecretStore identity, and read-only Agent restart-state observer use the SAME stable Server/account/Device/Source slot path builder. Native Writer still uses its actual `localpushwriter.OriginalClaimPath`. The stable original domain-separated SHA256/prefix is unchanged. Session, Root, revision, target and original file do not reset claims; full owning authorization still checks their live identities separately.

The regression compares byte-for-byte V1 historic paths with the pre-refactor algorithm, creator/read equivalence, mutable-scope stability, foreign Source/Device/owner isolation, invalid/noncanonical scope denial and no disk mutation. No original data or raw operation key is exposed.

## Limitations and next code
This fixes restart-status naming drift, NOT a SQL/Native/CAS physical COMMIT or CANCEL. It does not create/retire any claim, rotate keys, permit second-file retry, complete SourceRun or enable scheduler/Web/foreign Desktop writes. Surviving or unreadable evidence remains uncertain. Continue #2204 with authenticated same-operation physical terminal COMMIT/CANCEL and independently replayable held OS Writer/CAS SQL proof; audit retirement before multi-file.

Inaccessible production security acceptance remains **按用户决定跳过（未验收）**, not a source/CI/PR gate. Code-level authorization, native/SQL/CAS correctness and accurate-head cross-platform CI remain mandatory.
