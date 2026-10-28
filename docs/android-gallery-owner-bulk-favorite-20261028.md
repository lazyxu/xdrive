# Android Gallery Owner selection and reversible bulk favorite · 2026-10-28

## Scope

Real iOS PWA UI reference: `ui/shared/src/mui/MediaGallerySelectionToolbar.tsx`.
Android Compose adds an actual **Select/Done** mode for the current loaded,
authenticated Owner Gallery (Library, filters, Search, manual Album). Up to 200
explicitly tapped verified photo/video nodes may be selected; an unloaded page
or whole search is **never** silently selected.

Selected tiles show an accessible selection state and mark. Selection replaces
Gallery's lower Library/Collections/Search and Year/Month controls with a bounded
selection action strip; it does not alter the underlying Owner media Range,
the existing Viewer, thumbnails, sorting, or CAS writer.

The first safely supported operation is **favorite/unfavorite** through the
already-existing Go/PWA `PATCH /api/v1/media/batch/favorite` with exactly one
Owner Bearer request:
`{"node_ids":[7,8],"favorite":true}`.
Response requires matching `updated` count and `favorite` boolean.
The current immutable selected item identities must still match verified loaded
items at submission. No automatic physical PATCH retry or token-refresh replay.
If response is missing/invalid, freeze writes until read-only Gallery refresh.
Owner or collection scope change clears the private selection; Back exits
selection before navigating Files. All mutated IDs are ultimately rechecked
by the Server's existing authenticated Owner PhotoAsset lookup.

A successful PATCH updates only current in-memory media favorite indicators,
clears selection and restores Gallery dock. `favorite` is represented explicitly
in the Android media row DTO; old fixture responses lacking the field mean
unknown, not false. Selecting a mixed/unknown set offers **收藏**.
Unimplemented PWA bulk actions (album writes, download, delete, tags, collage,
auto movie) remain absent rather than fake controls.

## Verification

New Core MockWebServer: real PATCH path/Bearer/body, returned count + favorite
value, duplicate identity rejection, invalid ACK no replay.
JVM Controller: one logical Owner mutation, Back selection isolation,
unknown ACK freezes and refresh performs GET only.
API35 Compose: tap selection, visual mark, never open Viewer, favorite state
acknowledged only after actual mock service response, return standard Gallery.

Run exact-HEAD `./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`,
`./gradlew --no-daemon :app:connectedDebugAndroidTest` plus actual GitHub
requirements. Source candidate != passed CI/published APK.

Physical Android OEM, production account, iOS 27 screenshot comparison:
**跳过（未验收）** under owner policy; no source security checks are skipped.
