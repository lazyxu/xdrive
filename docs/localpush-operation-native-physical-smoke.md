# L03-G0-c2c3b1p — real native original to current-operation CAS/SQL regression

**Dependency:** [#2029](https://github.com/lazyxu/xdrive/pull/2029) provides the single, UNROUTED current-operation-aware physical CAS/SQL first-leaf writer. Prerequisite #2029 passed exact-head GitHub CI attempt 2 (#39096034272: 25 success / 51 conditional skip / 0 failure, final-gate green) and was Rebase-merged as `290bed34865e8b552c7a580b6f55cc102c6fc2ff`. This is a distinct test-only next increment on that accepted master.

## What this test adds

The existing CI-only real native original fixture uses actual regular file bytes, a RootGrant, complete CURRENT inventory, authenticated Go Client → Gin/PostgreSQL temporary Stage PUT, quarantined physical CAS preparation and owner quota. This stage now reserves a keyed current operation (UUID/generation) and calls the actual operation-aware CAS/SQL writer. Assert real bytes in the final content-addressed blob, exactly one physical Stage PUT across exact replay, stable canonical Node/SourceItem receipt, and no successful SourceRun or activated local_folder.

A second real-native fixture aborts the exact operation after the physical Stage and CAS preparation but **before** canonical SQL commit; the same current-operation writer must deny and publish zero ContentBlob, SourceItem, SyncRun or committed quota receipt.

Both tests are PostgreSQL-dependent and actually exercise the existing real native file→HTTP Stage→CAS physical storage, but still invoke an **internal unrouted** writer. Native preflight is not a continuously retained original file handle across remote SQL commit: the check is honest about that gap. Tests do not establish crash-safe physical commit/cancel exclusion, registered production upload, SourceRun, 100k network upload, >=4GiB, Windows installed Desktop, manual start, background scheduler, or key retirement. Preserve original stage <=64MiB and production local_folder execution hard deny.

## Delivery rules

One scoped work commit based on frozen merged `master@290bed34865e8b552c7a580b6f55cc102c6fc2ff`, preserving the original physical-native Go integration-test blob exactly; the stacked candidate was **reconstructed** as ONE work commit after #2029 merged. Demand a **new full accurate-head** GitHub CI (all 76 jobs: PostgreSQL API Race, Linux/Windows, Web/Desktop, Rootless, images/artifacts, single-commit and final-gate) and clean GitHub mergeability before Ready/Rebase. Only then merge and verify branch deletion; proceed to actual native-held Root/original lifetime + durable CAS/SQL commit and abort exclusion. A prior stacked/parent CI is not approval.
