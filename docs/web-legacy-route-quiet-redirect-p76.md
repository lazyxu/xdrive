# P76 · Silent legacy Sync Folders redirect, without transient loading page

Date: 2026-10-18. Frozen `master@82c944234a755e62b9ec75675cb4ea616c2bb7dc`.

## Source-audited gap

P58–P74 already stabilized accepted Files and Gallery navigation; the
concurrent P75 separately covers Mobile Files' pre-request false error.
An original legacy-route exception remained in `web/src/App.tsx`.
Opening an older `sync-folders?source=...` URL runs one authenticated
`api.sources()` lookup to identify whether that Source belongs to
Device Backup (Push) or Remote Pull.

The owner-specific lookup starts immediately and its result is protected
by `legacyOwnerRef` / generation / on-cleanup request gating. But if
the legitimate lookup takes longer than 300ms, the route paints
"正在根据旧链接确认所属应用…" via a deferred `XDriveStatePanel`,
then removes the panel as soon as the actual target App replaces
the legacy URL. That panel is a transient interstitial rather than
useful, countable network or media progress; it can cause a visual
transition on otherwise normal navigation.

## Narrow implementation

- Keep the SAME 180px `data-xdrive-legacy-source-quiet-redirect`
  container and `aria-busy` for the whole authorized lookup; never
  mount a progress ring, status caption or separate intermediate page
  merely because 300ms elapsed.
- Preserve `api.sources()`, owner/generation safety, old route
  selection based on original `source.direction`, and replacement
  navigation without an extra Server request or a delay.
- If the source is missing or permission denied, keep the original
  explicit unavailable/permission error, not a blank endless spinner.
- Preserve all original device backup, remote pull, files, gallery,
  upload/download, thumbnail/video/Live Photo and media Viewer flows,
  and the shared 52px fullscreen App Frame.

## Verification

Update `desktop/tests/web-legacy-source-quiet-route.cjs` to assert
absence of the original deferred-loading hook and message, stable
180px and honest `aria-busy`, and retention of source generation
and authenticated success/failure routes. Keep the existing
`web-app-quiet-fallback` source test.

Require ONE scoped commit, wholly NEW accurate-head 76+ job GitHub CI
(Web, Desktop Linux/Windows, PostgreSQL Go API Race, Rootless, artifact,
single-commit and Final Gate) and fresh mergeable_state=clean before
Ready/Rebase. This is a source contract verification, NOT a physical
iOS Safari, Android, PWA, WAN or real 100k layout observation. P75
and unrelated network/A3/perf/race/LocalPush branches remain untouched.
