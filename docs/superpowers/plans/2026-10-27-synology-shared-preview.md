# Synology shared preview continuation

> **For agentic workers:** Use superpowers:executing-plans. Continue the merged #2823 implementation in a focused follow-up; do not duplicate its download transport.

**Goal:** Make DSM file open and Quick Look share the existing Viewer, navigation and download capability checks, while preserving nonblocking physical acceptance.

**Architecture:** Keep `XDriveFileExplorer` and `XDriveFileQuickLookDialog`. Route `onOpenQuickLook` and double-click through the same DSM adapter state. Use existing Owner range/SHA download and platform limits. No new player, queue, transport or authorization.

**Spec:** User's accepted all-page Desktop/DSM shared UI requirement; root AGENTS.md. Physical DSM read-only ACL, actual first/second incremental, restart/upgrade task and credential persistence are 跳过（未验收） and do not block engineering.

**Tech Stack:** Existing React/MUI and TypeScript; Node runtime controller regression; existing DSM TypeScript/build/SPK CI.

## Global constraints

- Preserve merged #2823 business behavior and 1 B–32 MiB download bounds.
- Keep browser credentials, Owner/revision validation, 256 KiB ranges and full SHA verification unchanged.
- Navigate only current verified loaded files; preserve selected-file sessions; never fetch an entire folder for navigation.
- Preserve Desktop's existing adapter behavior and shared UI implementation.
- Keep honest distinctions between source tests, CI, published SPK and real DSM acceptance.

## Review focus

- Double-click, keyboard and menu must lead to one external shared Quick Look.
- Unsupported or busy downloads must be rejected before revoking a ready save link.
- A legal download must close preview so real progress/cancel/save remain reachable.
- Folder/sort/root/client changes and unmount must retire old preview actions, including identical numeric IDs after account changes.
- Cancellation/retry and old URL expiry must not affect a newer download.

## Tasks

- [x] Reproduce current Quick Look capability/feedback problem with executable controller tests.
- [x] Route DSM preview requests to the shared dialog; wire loaded-file/selection navigation and background-thumbnail suspension.
- [x] Reuse one download-disabled predicate for list, preview and actual handler before side effects.
- [x] Run runtime controller regressions; update the existing DSM workflow to include them and preserve its download tests.
- [x] Update concise AGENTS rules and accurate DSM page/feature status; keep skipped physical acceptance explicit.
- [ ] Review changed source and deliver a focused follow-up PR after #2823 merged during this task; require actual applicable CI and normal protection before merge.

## Execution notes

The shell cannot reach GitHub/npm and no TypeScript/React toolchain is installed locally. Source files are fetched at known GitHub SHAs. Local Node tests execute the production controller prelude with native type stripping and deterministic hook/client fixtures; this is not a real browser or full typecheck. Authoritative DSM CI still runs the ordinary TypeScript/build/SPK pipeline.

- Verified local controller results: 10/10 passing after the three concrete reproductions failed first. Workflow trigger audit: 2 loaded YAML workflows, 0 violations; 12 scope-rule tests passing. Full repository validation remains the CI job.
- Delivery baseline is `master@f6db37c9abd30a366e0d836330a03471c7556559`; the six-file #2823 change is already included. No rewrite or update of that merged PR is needed.
