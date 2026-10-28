# Android Files: foreground page preempts obsolete reads (2026-10-28)

## User-facing rule

Android follows the iOS PWA foreground-navigation contract: while an
Owner-scoped directory/page/search GET is loading, switching to a newly
requested folder, section, Gallery, Trash, or a verified file Viewer must not
wait for the prior page. Keep the canonical native Compose surface and
existing Go HTTP APIs; do not implement a second queue or WebView.

## Implementation and safety

- Only explicitly marked read requests set `discardableReadInFlight`.
- `canNavigateFiles()` is shared by Compose and the Controller so enabled UI
  actions have the same security/side-effect gate as actual navigation.
- A new page retires old reads with the existing transport cancellation and
  generation fencing. A non-cooperative old response cannot overwrite the
  new page, stale rows, or the active Viewer.
- In-flight mutations, uncertain batch writes, target selection, and SAF
  uploads/downloads never opt in; navigating must not silently abort them
  or trigger another POST/PATCH/DELETE.
- PDF/audio Viewer opening retires an obsolete read without creating another
  media transport. Read-only owner data stays session-scoped.

## Regression matrix

New JVM tests exercise Files page → Gallery; page → Trash; page → another
folder; page → PDF Viewer, each with deliberately late noncooperative page
reply, plus in-flight Owner mutation refusing Gallery/Trash/section/search/
folder/refresh navigation. Existing native API35 Compose tests remain required.

Source change alone does not prove accurate-HEAD CI or pixel-level 1:1.
Required checks: Android JVM/Core, Lint, Debug APK, API35 instrumentation and
repository protection gates. Physical/OEM runtime, production Server/CA,
and iOS PWA screenshot comparisons: **跳过（未验收）**.

## Gallery SAF transfer follow-up

Gallery → Files, album Back, query/sort/filter/date jumps and explicit refresh
must not invalidate an actively streaming SAF export. The existing download
status retains its explicit cancel action; this is a safe **blocking gate**
while Android still has only foreground single-file transfer, not a claim
that background resume is implemented. The same guard drives Compose enabled
state and Controller entry points; real Owner writes/uncertain ACK remain
protected. Two JVM tests cover an active Gallery export and album Back.

## Exact-HEAD CI fix: reliable SAF and uncertain batch recovery

The previous native CI exposed four legacy test assumptions. Foreground
SAF bytes are not discardable GETs: navigation and Gallery refresh/date
jump defer while the stream remains active, and only an explicit Cancel
discards the incomplete output. Tests now assert that the Owner source,
partial-byte count, and request count remain unchanged until either the
user cancels or the transport finishes. Android system Back is captured
at Files root while SAF transfer is running, avoiding an implicit Activity
exit with a volatile document stream.

A failed atomic batch trash may already be committed. Normal navigation
stays frozen, but `refresh()` and `retry()` may always execute an
authenticated **first-page GET** to reconcile the uncertain result.
A second DELETE is forbidden; a failed reconciliation GET retains the
write-fenced state until a successful read. Additional JVM tests verify
the complete failure/retry/recovery sequence.
