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
