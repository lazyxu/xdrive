# P0-C1e — strict redacted device continuation fields

## Security gap
The shared Web/Mobile Web/Desktop device continuation validator already checks
canonical device UUIDs, duplicate rows, Source IDs and cursors, but it accepts
unexpected JSON properties inside a device, folder and embedded latest-run object.
These extra fields may be private local paths, raw SyncRun errors, Root identifiers,
credentials or Source ignore rules from an incompatible Server/Agent.

## Scoped correction
For continuation pages only, reject unknown keys at the top level and on each
device, folder and latest-run record using the existing owner-redacted DTO.
Require valid ISO timestamp fields and nonnegative safe integer run counters.
Never normalize or store an offending response: existing UI retains its last
verified device page and retry action. No additional network requests or any
write privilege are introduced. Existing Server owner authorization, authenticated
Agent read IPC, Source/Root boundaries, device/Source keyset paging and account
change epoch guards remain unchanged.

The initial `source.list()` overview is **not** covered by this helper; it
requires a separate backward-compatible runtime gate and mounted first-read
fixture update after the active P0-C1d run-page PR has landed. This scoped
extension does not enable local Push Runner/SourceRun/auto scheduling/cancel,
physical origin upload, NAS Push or Mirror delete.

## Verification
The original 103-device continuation and source-contract tests remain. New
adversarial tests accept a complete redacted embedded latest-run and reject
unknown owner/local-path/Root/error/ignore-rule fields, malformed timestamps
and unsafe counters. Entire exact-head PR CI including PostgreSQL Go API Race,
Linux/Windows Web/Desktop, Rootless, artifacts, single-work commit and Final
Gate must pass; device/browser E2E and installed 100k/≥4GiB remain NO-GO.
