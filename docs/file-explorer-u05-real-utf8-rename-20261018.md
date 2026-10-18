# U05 · real UTF-8 rename boundary, 409 and owner isolation (2026-10-18)

## Current stage and fixed parent
- Prior Files F02/F03/F04, U02 [#2032](https://github.com/lazyxu/xdrive/pull/2032), U03 [#2038](https://github.com/lazyxu/xdrive/pull/2038) and U06/U09 [#2036](https://github.com/lazyxu/xdrive/pull/2036) are merged with full accurate-head CI/Final Gates. The independently merged P65 verified-empty geometry [#2041](https://github.com/lazyxu/xdrive/pull/2041) is included in baseline `master@4256c79cfda68439b870e517b48f24983c8d25e5` and untouched.
- Exactly ONE U05 work commit, three test/doc files only. No production security policy, Server handler/REST, shared UI component, 52px App Frame, virtualizer or 900px breakpoint changes. Preserve unrelated Gallery/Admin/LocalPush/performance/race branches.

## Real API checks and limits
- The existing isolated real Gin/PostgreSQL FileExplorer lifecycle fixture now exercises Owner PATCH with immutable If-Match against an original root-owned folder, checks 255 UTF-8 bytes (85 Chinese characters) actually persisted as the new name, rejects 256 bytes with HTTP 400 without changing Node/revision, rejects same-parent occupied sibling with HTTP 409, and rejects stale If-Match with HTTP 409 while preserving the accepted 255-byte name and new Revision.
- A foreign user attempting to rename that Node sees HTTP 404, the Server's intentional non-disclosure policy (not a fake 403). Browser original 403→409 cases use separate controlled test fixtures, and should not be confused with this authentic Owner DB verification.
- A new Desktop Node test executes the actual shared TypeScript FileNameDialog validation for 255/256-byte Chinese and emoji, independent 128-byte saved Search, and source guards for error focus/unsent draft. No native software-keyboard focus claim.

## Delivery / evidence constraints
- Require wholly NEW exact-head 76-job CI, genuine Go PostgreSQL API Race, Desktop runtime tests, Windows/Web, Rootless and Final Gate, plus current GitHub clean mergeability before Ready/Rebase. If red, diagnose and rebuild a single scoped work commit on this frozen parent with fresh checks.
- Native iOS27 Safari/Android installed, full screen reader, real 100k file render throughput and S5 seven-platform physical release matrix still NOT RUN / NO-GO. No fake physical results.

## Initial exact-head formatting failure and one-commit rebuild (2026-10-18)

- First scoped work HEAD `9eeb6022511e08dc7f8f4b96dafafb9c9b9fb634` CI [#39101794230](https://github.com/lazyxu/xdrive/actions/runs/39101794230) is RED: Go/Linux `Check formatting` failed because Go source has exactly one redundant blank line before `assertRealAuthenticatedPendingNavigationAbort`; `gofmt -d` removes only that line. This is a test-file formatting defect, not evidence of a Server permission/rename failure.
- Keep the original live Gin/PostgreSQL test assertions and Desktop executable shared TypeScript validator **byte-identical**. On the SAME frozen parent `4256c79cfda68439b870e517b48f24983c8d25e5`, reconstruct EXACTLY ONE U05 scoped work commit with only that one blank line removed and this diagnostic note added; force-with-lease ONLY this U05 ref. Do not merge the old red head or reuse its CI.
- Demand NEW full exact-head 76-job CI including real API/PostgreSQL Race, Desktop/Windows/Web, Rootless/artifacts/Final Gate and current clean GitHub mergeability. Hardware/OS S5 remains NOT RUN / NO-GO.
