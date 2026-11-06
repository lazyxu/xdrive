# iOS Native Files — Smart Folders / Saved Search parity (2026-11-06)

This follow-up stacks onto the navigation-stability branch for PR #3953. It does **not** mutate that already-tested HEAD. Before landing, merge/validate the dependency first and retarget this branch to master, retaining all required exact-head checks.

## Scope

Native SwiftUI Files only. Reuse the existing authenticated Owner-scoped Server `/api/v1/file-saved-searches` and `/api/v1/search` contracts shared with Web/PWA. No duplicated Server search index, no new CAS writer, no local password/token storage, and no WebKit.

### Features implemented in the development branch

- Browse home now exposes **智能文件夹**. A search result also exposes **保存或管理智能文件夹**.
- Dedicated native management screen lists up to 64 authoritative saved rules, opens a rule as a full-library Server search, and supports creation, rename, replacement using current search conditions, deletion with confirmation, and Up/Down server-persisted ordering.
- Save existing type/date/size/source/tag filters and text query using Server's exact JSON camelCase schema. The optional Web-only availability filter is never invented on native.
- Use Owner-scoped bearer and verified HTTPS Root/Owner before each read/write, reject redirects/cookies/cache, validate IDs, UTF-8 length, duplicate names, filter bounds, 201/200/204 status and readback. No blind retry of an uncertain mutation.
- On exit and account change, cancel outstanding work and clear the saved rule list. Tapping a rule never manufactures locally filtered results.
- Applying a saved rule reuses the Native Files full-library search/Range. When the filter changes, its existing change handler starts the one authoritative load, avoiding a redundant explicit reload.

## Automated coverage

- Pure Swift compiled policy test for empty/keyword-only/structured-only searches, UTF-8 128-byte names, Server JSON decode/encode, source/tag IDs, ID uniqueness, reorder membership, and invalid inputs.
- Node source contract checks for exact Server verbs and status codes, secure transport, result readback, Owner cancellation, UI entry, native Server Range search reuse, CRUD menu actions and no WebKit.
- The iOS unsigned IPA workflow compiles the pure policy and runs source tests before the actual app Xcode build.

## Not yet completed

The iOS app needs genuine iPhone interactive tests for Save → close → reopen → Search → clear → return, Owner logout/change, duplicate names, 100k folder, network failure, VoiceOver and Dynamic Type. These are **跳过（未验收）** until device evidence is captured. Do not claim test-code success is device evidence.

This PR intentionally does not implement the separate cross-window 200+ selection workflow, grouped Server directory presentation, in-place child disclosure, universal Undo/Redo, path navigation or Browse home personalization.
