# Android Gallery 批量标签 · iOS PWA parity · 2026-10-28

## Scope and API

Stacked on [PR #2868](https://github.com/lazyxu/xdrive/pull/2868). The same current-Owner, 1–200 **actually loaded/selected** verified Gallery media rows now support a second real operation: **添加标签**. Selection review, query-wide selection, permanent delete, batch export, and manual album writes are deliberately not offered as non-functional controls.

The existing Go/PWA API is `POST /api/v1/media/batch/tags` with `{"node_ids":[7,8],"tags":["Family","旅行"]}`. It is authenticated with the same pinned Owner Bearer client, no second writer, and no physical media content transfer.

Android parses a comma-separated tag draft and validates: nonempty, max 32 unique names, 64 Unicode scalars per name, no control characters; whitespace is collapsed, duplicates (case-insensitive) coalesced, and names canonically sorted for matching the existing Go response. Server `normalizeMediaTags` and current-Owner PhotoAsset membership remain authoritative. A response must contain exactly the selected item count and the canonical tag list. A missing, malformed or unknown ACK never triggers automatic POST replay.

The previously introduced Favorite and Tags actions now reuse one Controller metadata mutation gate: select an immutable current row snapshot, issue **one authenticated mutation** without token refresh replay, verify ACK before clearing selection, and conservatively freeze both actions on uncertain outcome until read-only Gallery GET. Navigation/Owner/logout cannot reuse the previous selection. Existing Live Photo, 4-sort Gallery, thumbnails, SAF and floating PWA dock are unchanged.

Native Compose selection toolbar adds an explicit Tags action and bounded AlertDialog; stale/empty/invalid input disables commit. The actual panel is displayed in the Gallery's floating lower chrome; it never creates a fake command.

## Tests / evidence

- Core MockWebServer: exact Owner POST/Bearer/JSON; correct 2-item response; partial or wrong ACK fail closed; duplicate nodes rejected; no silent retry.
- Kotlin unit: validates draft normalisation and size bounds; Controller one mutation, initial frozen selection, successful clearing, lost ACK freezes and GET-only recovery.
- API35 Compose: Gallery → Select → tile → Tags input → one actual service POST → bottom dock restored; no unrelated thumbnail assumptions.
- Exact-head Kotlin/Core/JVM, Lint, APK, API35 and actual required GitHub Final Gate must pass before merge. While PR targets #2868's branch, its source is a **candidate**, not validated by a master-targeted CI workflow.
- Production credentials, physical OEM and iOS 27 pixel screenshot acceptance: **跳过（未验收）**; none is a source/CI security bypass.

After #2868 merges, retarget this stacked PR to current master and reconcile only genuinely changed affected source, then run required actual-head checks.
