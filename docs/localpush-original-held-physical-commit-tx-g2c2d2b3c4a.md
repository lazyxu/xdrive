# G2c2d2b3c4a — original Operation held physical-COMMIT SQL writer (private)

## Exact existing prerequisites

Merged #2319 validates the original private Writer marker identity after read.
Merged #2327 provides the **UNROUTED** original-Operation precommit callback
retaining the current Owner/Device/Root/Source, original Operation UPDATE,
immutable Stage/SQL outcome, Source-wide empty terminal slot and
`storage.Local.InspectPinnedLocalPushHistoricalCASBeforeCommit` physical pin
within one SQL transaction. Merged #2332 proves the original native Agent
Writer lock can stay held through the existing owning first-file HTTP callback.
None of those changes alone creates a trustworthy Server physical file terminal.

## This scoped increment

- `observeBoundLocalPushPhysicalCommitWithHeldNative` is PRIVATE and **UNROUTED**. It delegates only through #2327's actual Local physical CAS pin and original SQL transaction. There is no public HTTP endpoint, Electron IPC, JS/Renderer, Web or foreign Desktop caller.
- `persistBoundLocalPushOriginalPhysicalCommitTx` validates a private, already-held native witness contract against the existing authenticated device/Root context, original 32-byte request-key digest, Operation UUID/generation/state, immutable Stage binding, canonical SQL committed Node/SourceItem and current CAS contents. The record is constructed solely from SQL authoritative identities, not from a client-supplied Node/size/path. The Source-wide terminal vacancy and conflicting reservation receipt are checked before the physical terminal INSERT; PostgreSQL unique keys are a second defense.
- The helper rejects absent/mismatched native witness identity, missing or corrupt CAS, contradictory reservation terminal, expired/mismatched scope, wrong Operation/Stage/key, and callback failures. PostgreSQL transaction rollback remains fail-closed; after entering the CAS callback, an unknown result stays UNCERTAIN, not cancel-safe.
- Genuine PostgreSQL + physical Local CAS integration fixtures exercise the pinned transaction and fail-closed cases. Their native witness is explicitly **TEST-ONLY SYNTHETIC**: a test-created `originalClaimHeld=true` is not a hardware or production attestation.

## Not enabled; required next step

This is a necessary Server-side terminal *writer primitive*, **not a real production file terminal yet**. The next change must authenticate and correlate evidence generated only within the owning native Agent's still-held actual original `*localpushwriter.Claim` and original open OS fd, bind it to the immutable original Operation, Source revision, current Owner/Device/Root and CAS, and call this private path without allowing caller-supplied booleans/digests to become authority. In particular, the current private witness struct MUST NEVER be decoded from JSON, used as a direct HTTP argument or set to held based only on a token.

Lost-ACK replay currently denies a second INSERT; a durable, authenticated original-terminal readback that can distinguish COMMIT from UNCERTAIN still needs to be wired. Physically verified CANCEL with native writer quiescence, Stage/key/Writer retirement, safe file #2, multi-file Runner, SourceRun, watcher and scheduling are separate later dependencies. The real owning Desktop manual 0–64 MiB first-file Backup-only path remains unchanged. `backup_complete=false` and `retirement_safe=false` remain true product constraints.

Production environment safety acceptance remains **按用户决定跳过（未验收）**, never a development/CI/merge gate; code-level Owner/Device/Root/native/SQL/CAS and non-production fault/security testing remain required.
