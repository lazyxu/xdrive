# Device Backup redacted device pagination validation (P0-C1c)

## Gap

A 100-device owner-scoped overview can truthfully advertise further keyset pages. The shared Web/Mobile Web/Desktop viewer already uses `listPage` and rejects stale owner/Server result closures, but formerly accepted a continuation's nested device records without a runtime DTO validation. Its deduplicating merge could silently accept duplicate or malformed records or a false terminal cursor, representing a partial device inventory as complete.

## Narrow remedy

One shared, pure UI-independent validator checks canonical lowercase device UUIDs, unique IDs both within the page and against the current verified overview, bounded page size, basic redacted device/folder/latest-run fields, true pagination flags and the returned cursor before updating React state. The previous verified rows are retained and a retryable continuation error is displayed if validation fails. No original Source, Root path, credentials, raw errors or privileged operation can be loaded or invoked. Keep the existing Server-side owner/Device scope as the authority; renderer validation is defense in depth, not authorization.

Existing per-device Source folder keyset validator and 1000-binding overview limitation are unchanged. A successful 103-device pure-unit fixture and malicious/duplicate continuation fixtures do **not** prove physical browser/WAN performance, authenticated live Server migration, local Push uploads or complete 100k / >=4GiB installed-device acceptance. Native Windows/Linux and authenticated browser E2E remain outstanding. Require the one-work-commit, exact-head full GitHub CI and clean mergeability before Ready/Rebase/merge.

## First exact-head CI correction

The first full P0-C1c head `75d03341c1433bc185e6209c8c7bc6b9eb991a2e` failed the existing P82 mounted-renderer harness because its virtual `require` table did not recognize the new pure validator dependency. This was a stale test dependency allowlist, not a reason to bypass actual continuation validation or undo shared code. The original P82 real rendered first-read assertions, fixed 180px geometry, and separate adversarial continuation tests are retained. The mounted harness now stubs only the pure helper in precisely the same way it previously stubbed the folder page validator. This correction requires its own complete accurate-head CI.
